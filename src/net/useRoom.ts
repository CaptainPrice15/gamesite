import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { RealtimeChannel } from '@supabase/supabase-js'
import type { NetHooks } from '../core/types'
import { useProfile } from '../lib/auth'
import { supabase } from '../lib/supabase'
import { backoffDelay } from './backoff'
import { flattenPresence, pickOpponent, type PresenceMember } from './presence'

export type RoomPhase = 'idle' | 'connecting' | 'lobby' | 'error'

export interface RoomHandle {
  phase: RoomPhase
  code: string | null
  matchId: string | null
  role: 'p1' | 'p2' | null
  error: string | null
  attempt: number
  myReady: boolean
  bothReady: boolean
  started: boolean
  opponent: PresenceMember | null
  opponentPresent: boolean
  hooks: NetHooks
  create(gameId: string): void
  join(code: string): void
  joinMatch(matchId: string, code: string, role: 'p1' | 'p2'): void
  setReady(ready: boolean): void
  startMatch(): void
  leave(): void
}

type RoomAction =
  | { kind: 'create'; gameId: string }
  | { kind: 'join'; code: string }
  | { kind: 'match'; matchId: string; code: string; role: 'p1' | 'p2' }

const MAX_RETRIES = 5

function isTerminal(status: string): boolean {
  return status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED'
}

export function useRoom(): RoomHandle {
  const { session, profile, ready } = useProfile()
  const [phase, setPhase] = useState<RoomPhase>('idle')
  const [code, setCode] = useState<string | null>(null)
  const [matchId, setMatchId] = useState<string | null>(null)
  const [role, setRole] = useState<'p1' | 'p2' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [attempt, setAttempt] = useState(0)
  const [myReady, setMyReady] = useState(false)
  const [myStarted, setMyStarted] = useState(false)
  const [members, setMembers] = useState<PresenceMember[]>([])

  const channelRef = useRef<RealtimeChannel | null>(null)
  const joinedRef = useRef(false)
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const attemptRef = useRef(0)
  const pendingRef = useRef<RoomAction | null>(null)
  const sessionRef = useRef(session)
  const subsRef = useRef(new Set<(msg: { type: string; data: unknown }) => void>())
  const payloadRef = useRef({ uid: '', name: '', ready: false, started: false })
  const stateRef = useRef({ phase: 'idle' as RoomPhase, code: null as string | null })
  const connectRef = useRef<
    ((channelCode: string, channelRole: 'p1' | 'p2') => Promise<void>) | null
  >(null)
  stateRef.current = { phase, code }

  sessionRef.current = session

  const teardown = useCallback(() => {
    if (retryTimerRef.current !== null) {
      clearTimeout(retryTimerRef.current)
      retryTimerRef.current = null
    }
    joinedRef.current = false
    const channel = channelRef.current
    channelRef.current = null
    if (channel) {
      void supabase?.removeChannel(channel)
    }
  }, [])

  const reset = useCallback(() => {
    teardown()
    pendingRef.current = null
    attemptRef.current = 0
    setPhase('idle')
    setCode(null)
    setMatchId(null)
    setRole(null)
    setError(null)
    setAttempt(0)
    setMyReady(false)
    setMyStarted(false)
    setMembers([])
  }, [teardown])

  const scheduleRetry = useCallback((channelCode: string, channelRole: 'p1' | 'p2') => {
    if (retryTimerRef.current !== null || stateRef.current.phase === 'idle') return
    const current = attemptRef.current
    if (current >= MAX_RETRIES) {
      setPhase('error')
      setError('Connection lost — try rejoining the room.')
      return
    }
    attemptRef.current = current + 1
    setAttempt(current + 1)
    const delay = backoffDelay(current)
    retryTimerRef.current = setTimeout(() => {
      retryTimerRef.current = null
      if (stateRef.current.phase === 'idle') return
      void connectRef.current?.(channelCode, channelRole)
    }, delay)
  }, [])

  const connect = useCallback(
    async (channelCode: string, channelRole: 'p1' | 'p2'): Promise<void> => {
      const client = supabase
      if (!client) {
        setPhase('error')
        setError('Online play needs a connection — play locally instead.')
        return
      }
      teardown()
      setCode(channelCode)
      setRole(channelRole)
      setPhase('connecting')
      setError(null)

      try {
        await client.realtime.setAuth()
      } catch {
        setError('Realtime auth failed — retrying.')
      }

      const channel = client.channel(`room:${channelCode}`, { config: { private: true } })
      channelRef.current = channel

      channel.on('presence', { event: 'sync' }, () => {
        if (channelRef.current !== channel) return
        setMembers(flattenPresence(channel.presenceState()))
      })

      channel.on('broadcast', { event: '*' }, (payload) => {
        if (channelRef.current !== channel) return
        const message = { type: payload.event, data: payload.payload }
        for (const cb of subsRef.current) cb(message)
      })

      channel.subscribe((status) => {
        if (channelRef.current !== channel) return
        if (status === 'SUBSCRIBED') {
          joinedRef.current = true
          attemptRef.current = 0
          setAttempt(0)
          setPhase((prev) => (prev === 'error' ? prev : 'lobby'))
          void channel.track({ ...payloadRef.current })
        } else if (isTerminal(status)) {
          joinedRef.current = false
          scheduleRetry(channelCode, channelRole)
        }
      })
    },
    [scheduleRetry, teardown],
  )

  connectRef.current = connect

  const run = useCallback(
    async (action: RoomAction): Promise<void> => {
      const client = supabase
      if (!client) {
        setPhase('error')
        setError('Online play needs a connection — play locally instead.')
        return
      }
      if (!sessionRef.current) {
        pendingRef.current = action
        setPhase('connecting')
        return
      }
      pendingRef.current = null
      setPhase('connecting')
      setError(null)
      attemptRef.current = 0
      setAttempt(0)
      setMyReady(false)
      setMyStarted(false)
      setMembers([])

      try {
        if (action.kind === 'match') {
          setMatchId(action.matchId)
          setMyReady(true)
          payloadRef.current = {
            uid: sessionRef.current?.user.id ?? '',
            name: profile?.display_name ?? 'Player',
            ready: true,
            started: false,
          }
          await connect(action.code, action.role)
          return
        }
        const result =
          action.kind === 'create'
            ? await client.rpc('create_room', { p_game_id: action.gameId, p_mode: 'friend' })
            : await client.rpc('join_room', { p_room_code: action.code })
        if (result.error) {
          setPhase('error')
          setError(result.error.message)
          return
        }
        const data = (result.data ?? {}) as Record<string, unknown>
        const roomCode =
          typeof data.room_code === 'string'
            ? data.room_code
            : action.kind === 'join'
              ? action.code
              : ''
        const nextRole: 'p1' | 'p2' =
          action.kind === 'create' || data.already_joined === true || data.opponent == null
            ? 'p1'
            : 'p2'
        const nextMatch = typeof data.match_id === 'string' ? data.match_id : null
        setMatchId(nextMatch)
        payloadRef.current = {
          uid: sessionRef.current?.user.id ?? '',
          name: profile?.display_name ?? 'Player',
          ready: false,
          started: false,
        }
        await connect(roomCode, nextRole)
      } catch {
        setPhase('error')
        setError('Could not reach the server — check your connection.')
      }
    },
    [connect, profile?.display_name],
  )

  const create = useCallback(
    (gameId: string) => {
      void run({ kind: 'create', gameId })
    },
    [run],
  )

  const join = useCallback(
    (roomCode: string) => {
      void run({ kind: 'join', code: roomCode })
    },
    [run],
  )

  const joinMatch = useCallback(
    (matchId: string, code: string, role: 'p1' | 'p2') => {
      void run({ kind: 'match', matchId, code, role })
    },
    [run],
  )

  useEffect(() => {
    if (ready && pendingRef.current && session) {
      const action = pendingRef.current
      pendingRef.current = null
      void run(action)
    }
  }, [ready, session, run])

  useEffect(() => teardown, [teardown])

  const setReady = useCallback((next: boolean) => {
    setMyReady(next)
    payloadRef.current = { ...payloadRef.current, ready: next }
    const channel = channelRef.current
    if (channel && joinedRef.current) void channel.track({ ...payloadRef.current })
  }, [])

  const startMatch = useCallback(() => {
    if (stateRef.current.phase === 'idle') return
    setMyStarted(true)
    payloadRef.current = { ...payloadRef.current, started: true }
    const channel = channelRef.current
    if (channel && joinedRef.current) void channel.track({ ...payloadRef.current })
  }, [])

  const opponent = useMemo(() => {
    const myUid = session?.user.id ?? ''
    return myUid ? pickOpponent(members, myUid) : null
  }, [members, session?.user.id])

  const hooks = useMemo<NetHooks>(
    () => ({
      emit: (type, data) => {
        const channel = channelRef.current
        if (!channel || !joinedRef.current) return
        void channel.send({
          type: 'broadcast',
          event: type,
          payload: (data ?? {}) as Record<string, unknown>,
        })
      },
      subscribe: (cb) => {
        subsRef.current.add(cb)
        return () => {
          subsRef.current.delete(cb)
        }
      },
    }),
    [],
  )

  const bothReady = myReady && opponent?.ready === true
  const started = myStarted || opponent?.started === true

  return {
    phase,
    code,
    matchId,
    role,
    error,
    attempt,
    myReady,
    bothReady,
    started,
    opponent,
    opponentPresent: opponent !== null,
    hooks,
    create,
    join,
    joinMatch,
    setReady,
    startMatch,
    leave: reset,
  }
}
