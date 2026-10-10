import { useCallback, useEffect, useRef, useState } from 'react'
import type { RealtimeChannel } from '@supabase/supabase-js'
import { useProfile } from '../lib/auth'
import { supabase } from '../lib/supabase'

export type QueueMode = 'ranked' | 'casual'
export type QueuePhase = 'idle' | 'searching' | 'matched' | 'cooldown' | 'error'

export interface QueuedMatch {
  matchId: string
  code: string
  role: 'p1' | 'p2'
  opponent: string
  mode: QueueMode
  gameId: string
}

export interface QueueHandle {
  phase: QueuePhase
  elapsedSec: number
  cooldownSec: number
  error: string | null
  match: QueuedMatch | null
  search(gameId: string, mode: QueueMode): void
  cancel(): void
  reset(): void
}

export type EnqueueResult =
  | { kind: 'matched'; matchId: string; code: string; opponent: string }
  | { kind: 'waiting' }
  | { kind: 'cooldown'; seconds: number }
  | { kind: 'invalid' }

const POLL_MS = 4000
const MAX_POLL_ERRORS = 3

export function parseEnqueueResult(value: unknown): EnqueueResult {
  if (typeof value !== 'object' || value === null) return { kind: 'invalid' }
  const data = value as Record<string, unknown>
  if (data.matched === true) {
    const matchId = data.match_id
    const code = data.room_code
    const opponent = data.opponent
    if (typeof matchId !== 'string' || matchId === '') return { kind: 'invalid' }
    if (typeof code !== 'string' || code === '') return { kind: 'invalid' }
    return {
      kind: 'matched',
      matchId,
      code,
      opponent: typeof opponent === 'string' ? opponent : '',
    }
  }
  if (data.matched === false) {
    const cooldown = data.cooldown_sec
    if (typeof cooldown === 'number' && Number.isFinite(cooldown) && cooldown > 0) {
      return { kind: 'cooldown', seconds: Math.ceil(cooldown) }
    }
    return { kind: 'waiting' }
  }
  return { kind: 'invalid' }
}

export function useQueue(): QueueHandle {
  const { session, ready } = useProfile()
  const [phase, setPhase] = useState<QueuePhase>('idle')
  const [elapsedSec, setElapsedSec] = useState(0)
  const [cooldownSec, setCooldownSec] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [match, setMatch] = useState<QueuedMatch | null>(null)

  const channelRef = useRef<RealtimeChannel | null>(null)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const cooldownRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const activeRef = useRef(false)
  const resolvedRef = useRef(false)
  const errorCountRef = useRef(0)
  const searchRef = useRef<{ gameId: string; mode: QueueMode } | null>(null)
  const pendingRef = useRef<{ gameId: string; mode: QueueMode } | null>(null)
  const sessionRef = useRef(session)
  const uidRef = useRef('')
  const phaseRef = useRef<QueuePhase>('idle')

  sessionRef.current = session
  phaseRef.current = phase

  const stopTimers = useCallback(() => {
    if (pollRef.current !== null) {
      clearInterval(pollRef.current)
      pollRef.current = null
    }
    if (tickRef.current !== null) {
      clearInterval(tickRef.current)
      tickRef.current = null
    }
    if (cooldownRef.current !== null) {
      clearTimeout(cooldownRef.current)
      cooldownRef.current = null
    }
    const channel = channelRef.current
    channelRef.current = null
    if (channel) void supabase?.removeChannel(channel)
  }, [])

  const reset = useCallback(() => {
    stopTimers()
    activeRef.current = false
    resolvedRef.current = false
    errorCountRef.current = 0
    searchRef.current = null
    pendingRef.current = null
    setPhase('idle')
    setElapsedSec(0)
    setCooldownSec(0)
    setError(null)
    setMatch(null)
  }, [stopTimers])

  const resolveMatch = useCallback(
    async (matchId: string, code: string): Promise<void> => {
      const client = supabase
      const uid = uidRef.current
      if (!client || !uid || resolvedRef.current) return
      resolvedRef.current = true
      stopTimers()
      activeRef.current = false
      try {
        const { data, error: fetchError } = await client
          .from('matches')
          .select('p1, p2, mode, game_id')
          .eq('id', matchId)
          .maybeSingle()
        if (fetchError || !data) {
          setPhase('error')
          setError('Could not load your match — try again.')
          return
        }
        const row = data as { p1: string; p2: string | null; mode: string; game_id: string }
        if (row.p1 !== uid && row.p2 !== uid) {
          setPhase('error')
          setError('This match no longer includes your account.')
          return
        }
        const opponent = row.p1 === uid ? row.p2 : row.p1
        if (!opponent) {
          setPhase('error')
          setError('Could not find your opponent — try again.')
          return
        }
        setMatch({
          matchId,
          code,
          role: row.p1 === uid ? 'p1' : 'p2',
          opponent,
          mode: row.mode === 'casual' ? 'casual' : 'ranked',
          gameId: row.game_id,
        })
        setPhase('matched')
      } catch {
        setPhase('error')
        setError('Could not reach the match server — try again.')
      }
    },
    [stopTimers],
  )

  const enqueueOnce = useCallback(async (): Promise<void> => {
    const client = supabase
    const search = searchRef.current
    if (!client || !search || resolvedRef.current || !activeRef.current) return
    try {
      const { data, error: rpcError } = await client.rpc('enqueue', {
        p_game_id: search.gameId,
        p_mode: search.mode,
      })
      if (!activeRef.current || resolvedRef.current) return
      if (rpcError) {
        errorCountRef.current += 1
        if (errorCountRef.current >= MAX_POLL_ERRORS) {
          activeRef.current = false
          stopTimers()
          setPhase('error')
          setError('Matchmaking is unreachable — check your connection.')
        }
        return
      }
      errorCountRef.current = 0
      const result = parseEnqueueResult(data)
      if (result.kind === 'matched') {
        await resolveMatch(result.matchId, result.code)
      } else if (result.kind === 'cooldown') {
        activeRef.current = false
        stopTimers()
        setCooldownSec(result.seconds)
        setPhase('cooldown')
        cooldownRef.current = setTimeout(() => {
          cooldownRef.current = null
          if (phaseRef.current === 'cooldown') setPhase('idle')
        }, result.seconds * 1000)
      }
    } catch {
      if (!activeRef.current || resolvedRef.current) return
      errorCountRef.current += 1
      if (errorCountRef.current >= MAX_POLL_ERRORS) {
        activeRef.current = false
        stopTimers()
        setPhase('error')
        setError('Matchmaking is unreachable — check your connection.')
      }
    }
  }, [resolveMatch, stopTimers])

  const connectUserChannel = useCallback(
    async (uid: string): Promise<void> => {
      const client = supabase
      if (!client) return
      try {
        await client.realtime.setAuth()
      } catch {
        return
      }
      const channel = client.channel(`user:${uid}`, { config: { private: true } })
      channelRef.current = channel
      channel.on('broadcast', { event: 'matched' }, (payload) => {
        if (!activeRef.current || resolvedRef.current) return
        const body = payload.payload as Record<string, unknown> | null
        const search = searchRef.current
        if (!body || !search) return
        if (body.game_id !== search.gameId) return
        const matchId = typeof body.match_id === 'string' ? body.match_id : ''
        const code = typeof body.room_code === 'string' ? body.room_code : ''
        if (matchId === '' || code === '') return
        void resolveMatch(matchId, code)
      })
      channel.subscribe()
    },
    [resolveMatch],
  )

  const begin = useCallback(
    async (gameId: string, mode: QueueMode): Promise<void> => {
      const client = supabase
      const uid = sessionRef.current?.user.id ?? ''
      if (!client) {
        setPhase('error')
        setError('Online play needs a connection — play locally instead.')
        return
      }
      stopTimers()
      activeRef.current = true
      resolvedRef.current = false
      errorCountRef.current = 0
      uidRef.current = uid
      searchRef.current = { gameId, mode }
      setMatch(null)
      setError(null)
      setCooldownSec(0)
      setElapsedSec(0)
      setPhase('searching')

      await connectUserChannel(uid)
      if (!activeRef.current) return
      void enqueueOnce()
      pollRef.current = setInterval(() => void enqueueOnce(), POLL_MS)
      const startedAt = Date.now()
      tickRef.current = setInterval(() => {
        setElapsedSec(Math.floor((Date.now() - startedAt) / 1000))
      }, 1000)
    },
    [connectUserChannel, enqueueOnce, stopTimers],
  )

  const search = useCallback(
    (gameId: string, mode: QueueMode) => {
      if (!sessionRef.current) {
        pendingRef.current = { gameId, mode }
        setPhase('searching')
        setElapsedSec(0)
        setError(null)
        return
      }
      void begin(gameId, mode)
    },
    [begin],
  )

  useEffect(() => {
    if (ready && pendingRef.current && session) {
      const next = pendingRef.current
      pendingRef.current = null
      void begin(next.gameId, next.mode)
    }
  }, [ready, session, begin])

  const cancel = useCallback(() => {
    const wasActive = activeRef.current
    reset()
    if (wasActive) void supabase?.rpc('dequeue')
  }, [reset])

  useEffect(() => {
    return () => {
      const shouldDequeue = activeRef.current
      stopTimers()
      activeRef.current = false
      if (shouldDequeue) void supabase?.rpc('dequeue')
    }
  }, [stopTimers])

  return {
    phase,
    elapsedSec,
    cooldownSec,
    error,
    match,
    search,
    cancel,
    reset,
  }
}
