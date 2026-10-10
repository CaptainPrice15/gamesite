import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { RealtimeChannel } from '@supabase/supabase-js'
import type { NetHooks } from '../core/types'
import { useProfile } from '../lib/auth'
import { supabase } from '../lib/supabase'

export type TttPhase = 'idle' | 'connecting' | 'ready' | 'error'

export interface TttRow {
  id: string
  updated_at: string
  board: number[]
  turn: 1 | 2 | null
  winner: 1 | 2 | null
  finished: boolean
}

function sideOf(value: unknown, p1: string, p2: string): 1 | 2 | null | false {
  if (value === null || value === '') return null
  if (typeof value !== 'string') return false
  if (value === p1) return 1
  if (value === p2) return 2
  return false
}

export function parseTttRow(raw: unknown): TttRow | null {
  if (typeof raw !== 'object' || raw === null) return null
  const r = raw as Record<string, unknown>
  if (typeof r.id !== 'string' || r.id === '') return null
  if (typeof r.updated_at !== 'string' || r.updated_at === '') return null
  if (!Array.isArray(r.board) || r.board.length !== 9) return null
  const board: number[] = []
  for (const cell of r.board) {
    if (cell !== 0 && cell !== 1 && cell !== 2) return null
    board.push(cell)
  }
  const status = r.status
  if (status !== 'waiting' && status !== 'active' && status !== 'finished') return null
  if (typeof r.p1 !== 'string' || r.p1 === '') return null
  if (typeof r.p2 !== 'string' || r.p2 === '') return null
  const turn = sideOf(r.turn, r.p1, r.p2)
  const winner = sideOf(r.winner, r.p1, r.p2)
  if (turn === false || winner === false) return null
  return {
    id: r.id,
    updated_at: r.updated_at,
    board,
    turn,
    winner,
    finished: status === 'finished',
  }
}

export function isNewerRow(next: TttRow, prev: TttRow | null): boolean {
  if (!prev) return true
  if (next.id !== prev.id) return true
  const a = Date.parse(next.updated_at)
  const b = Date.parse(prev.updated_at)
  if (Number.isNaN(a) || Number.isNaN(b)) return next.updated_at !== prev.updated_at
  return a > b
}

export interface TttNet {
  phase: TttPhase
  initial: TttRow | null
  hooks: NetHooks
}

const SYNC_DEBOUNCE_MS = 220

export function useTttNet(gameId: string | null): TttNet {
  const { session } = useProfile()
  const uid = session?.user.id ?? ''
  const [phase, setPhase] = useState<TttPhase>('idle')
  const [initial, setInitial] = useState<TttRow | null>(null)

  const channelRef = useRef<RealtimeChannel | null>(null)
  const lastRef = useRef<TttRow | null>(null)
  const busyRef = useRef(false)
  const syncTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const subsRef = useRef(new Set<(msg: { type: string; data: unknown }) => void>())

  const publish = useCallback((row: TttRow) => {
    for (const cb of subsRef.current) cb({ type: 'state', data: row })
  }, [])

  const apply = useCallback(
    (row: TttRow | null): boolean => {
      if (!row || row.id !== gameId) return false
      if (!isNewerRow(row, lastRef.current)) return false
      lastRef.current = row
      setInitial((prev) => prev ?? row)
      publish(row)
      return true
    },
    [gameId, publish],
  )

  const syncNow = useCallback(async (): Promise<void> => {
    const client = supabase
    if (!client || !gameId || busyRef.current) return
    busyRef.current = true
    try {
      const { data, error } = await client.from('ttt_games').select('*').eq('id', gameId).single()
      if (!error) apply(parseTttRow(data))
    } catch {
      apply(null)
    } finally {
      busyRef.current = false
    }
  }, [gameId, apply])

  const scheduleSync = useCallback(() => {
    if (syncTimerRef.current !== null) return
    syncTimerRef.current = setTimeout(() => {
      syncTimerRef.current = null
      void syncNow()
    }, SYNC_DEBOUNCE_MS)
  }, [syncNow])

  const move = useCallback(
    async (cell: number): Promise<void> => {
      const client = supabase
      if (!client || !gameId) return
      if (!Number.isInteger(cell) || cell < 0 || cell > 8) return
      const { error } = await client.rpc('ttt_move', { p_game_id: gameId, p_cell: cell })
      if (error) return
      const channel = channelRef.current
      if (channel) void channel.send({ type: 'broadcast', event: 'sync', payload: {} })
      await syncNow()
    },
    [gameId, syncNow],
  )

  useEffect(() => {
    const client = supabase
    if (!gameId || !client || !uid) {
      setPhase(gameId && !client && uid ? 'error' : 'idle')
      return
    }
    let alive = true
    setPhase('connecting')
    setInitial(null)
    lastRef.current = null

    const boot = async (): Promise<void> => {
      try {
        await client.realtime.setAuth()
      } catch {
        if (alive) setPhase('error')
        return
      }
      if (!alive) return

      const channel = client.channel(`topic:${gameId}`, { config: { private: true } })
      channelRef.current = channel

      channel.on('broadcast', { event: '*' }, () => {
        if (channelRef.current === channel) scheduleSync()
      })

      channel.subscribe((status) => {
        if (!alive || channelRef.current !== channel) return
        if (status === 'SUBSCRIBED') {
          setPhase('ready')
          void syncNow()
        } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          setPhase('error')
        }
      })
    }

    void boot()

    return () => {
      alive = false
      if (syncTimerRef.current !== null) {
        clearTimeout(syncTimerRef.current)
        syncTimerRef.current = null
      }
      const channel = channelRef.current
      channelRef.current = null
      if (channel) void client.removeChannel(channel)
    }
  }, [gameId, uid, scheduleSync, syncNow])

  const hooks = useMemo<NetHooks>(
    () => ({
      emit: (type, data) => {
        if (type !== 'move') return
        const cell = (data as { cell?: unknown } | null)?.cell
        if (typeof cell !== 'number') return
        void move(cell)
      },
      subscribe: (cb) => {
        subsRef.current.add(cb)
        const last = lastRef.current
        if (last && last.id === gameId) cb({ type: 'state', data: last })
        return () => {
          subsRef.current.delete(cb)
        }
      },
    }),
    [gameId, move],
  )

  return { phase, initial, hooks }
}
