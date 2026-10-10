import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import type { GameModule } from '../core/types'
import { useProfile } from '../lib/auth'
import { reportMatch, type ReportOutcome } from '../lib/report'
import { supabase } from '../lib/supabase'
import { formatDelta } from '../shared/elo'
import { resolveWinnerUuid, toWinnerSide } from '../shared/match'
import { useQueue, type QueueMode } from '../net/useQueue'
import { useRoom } from '../net/useRoom'
import { useTttNet } from '../net/useTttNet'
import { GameHost } from './GameHost'
import { Lobby } from './Lobby'
import { ModeSelect } from './ModeSelect'
import { QueueSearch } from './QueueSearch'

interface FriendMatchProps {
  game: GameModule
  initialCode?: string | null
  onExit(): void
}

type Stage = 'menu' | 'queue' | 'lobby' | 'match'

export function FriendMatch({ game, initialCode, onExit }: FriendMatchProps): ReactNode {
  const { session, profile, refresh } = useProfile()
  const room = useRoom()
  const queue = useQueue()
  const [stage, setStage] = useState<Stage>(initialCode ? 'lobby' : 'menu')
  const [queueVariant, setQueueVariant] = useState<QueueMode | null>(null)
  const [searchMode, setSearchMode] = useState<QueueMode>('ranked')
  const [resultNote, setResultNote] = useState<string | null>(null)
  const [tttId, setTttId] = useState<string | null>(null)
  const [tttError, setTttError] = useState<string | null>(null)
  const [tttStarting, setTttStarting] = useState(false)
  const net = useTttNet(tttId)
  const joinedRef = useRef(false)
  const tttAttemptRef = useRef(false)
  const autoStartedRef = useRef(false)
  const opponentUidRef = useRef('')

  const { join, create, leave } = room

  const backToMenu = useCallback(() => {
    leave()
    queue.reset()
    setQueueVariant(null)
    setResultNote(null)
    setTttId(null)
    setTttError(null)
    setTttStarting(false)
    tttAttemptRef.current = false
    autoStartedRef.current = false
    opponentUidRef.current = ''
    setStage('menu')
  }, [leave, queue])

  useEffect(() => {
    if (!initialCode || joinedRef.current) return
    joinedRef.current = true
    setStage('lobby')
    join(initialCode)
  }, [initialCode, join])

  useEffect(() => {
    if (queue.phase !== 'matched' || !queue.match) return
    const matched = queue.match
    autoStartedRef.current = false
    opponentUidRef.current = matched.opponent
    setQueueVariant(matched.mode)
    setStage('lobby')
    room.joinMatch(matched.matchId, matched.code, matched.role)
    queue.reset()
  }, [queue, room])

  useEffect(() => {
    if (room.opponent?.uid) opponentUidRef.current = room.opponent.uid
  }, [room.opponent?.uid])

  const matchStarted = room.started && room.role !== null

  useEffect(() => {
    if (matchStarted && stage === 'lobby') setStage('match')
  }, [matchStarted, stage])

  useEffect(() => {
    if (stage !== 'lobby' || queueVariant === null) return
    if (!room.opponentPresent || room.started || autoStartedRef.current) return
    autoStartedRef.current = true
    room.startMatch()
  }, [stage, queueVariant, room])

  useEffect(() => {
    if (!matchStarted || game.id !== 'ttt' || tttId || tttAttemptRef.current) return
    const client = supabase
    if (!client || !room.matchId) {
      setTttError('Could not reach the match server.')
      return
    }
    tttAttemptRef.current = true
    setTttStarting(true)
    let alive = true
    void Promise.resolve(client.rpc('ttt_create', { p_match_id: room.matchId }))
      .then(({ data, error }) => {
        if (!alive) return
        setTttStarting(false)
        if (error) {
          setTttError(error.message)
          return
        }
        const id = (data as { game_id?: unknown } | null)?.game_id
        if (typeof id === 'string' && id !== '') setTttId(id)
        else setTttError('Could not start the match.')
      })
      .catch(() => {
        if (!alive) return
        setTttStarting(false)
        setTttError('Could not reach the match server.')
      })
    return () => {
      alive = false
    }
  }, [matchStarted, game.id, tttId, room.matchId])

  const handleReport = useCallback(
    (outcome: ReportOutcome) => {
      if (!outcome.ok) return
      if (outcome.elo) {
        setResultNote(
          `Rating ${outcome.elo.before} → ${outcome.elo.after} (${formatDelta(outcome.elo.delta)})`,
        )
      } else if (outcome.status === 'void' && queueVariant === 'ranked') {
        setResultNote('Match voided — no rating change')
      }
      if (outcome.elo) void refresh()
    },
    [queueVariant, refresh],
  )

  const onGameOver = useCallback(
    (result: { score: number; meta?: Record<string, unknown> }) => {
      const matchId = room.matchId
      const role = room.role
      const myUid = session?.user.id ?? ''
      if (!matchId || !role || myUid === '') return
      const side = toWinnerSide(result.meta?.winner)
      const opponent = opponentUidRef.current
      if (side !== null && opponent === '') return
      const winner = resolveWinnerUuid(result.meta?.winner, role, myUid, opponent)
      void reportMatch({ matchId, winner, score: result.score }).then(handleReport)
    },
    [handleReport, room.matchId, room.role, session?.user.id],
  )

  if (stage === 'menu') {
    return (
      <ModeSelect
        game={game}
        busy={room.phase === 'connecting'}
        onCreate={() => {
          setStage('lobby')
          create(game.id)
        }}
        onJoin={(code) => {
          setStage('lobby')
          join(code)
        }}
        onLocal={onExit}
        onQueue={(mode) => {
          setSearchMode(mode)
          setStage('queue')
          queue.search(game.id, mode)
        }}
      />
    )
  }

  if (stage === 'queue') {
    return (
      <QueueSearch
        game={game}
        mode={searchMode}
        phase={queue.phase}
        elapsedSec={queue.elapsedSec}
        cooldownSec={queue.cooldownSec}
        error={queue.error}
        rating={profile?.elo ?? null}
        onCancel={backToMenu}
      />
    )
  }

  if (stage === 'lobby') {
    return (
      <Lobby
        game={game}
        code={room.code}
        role={room.role}
        phase={room.phase}
        attempt={room.attempt}
        error={room.error}
        myReady={room.myReady}
        bothReady={room.bothReady}
        started={room.started}
        opponent={room.opponent}
        opponentPresent={room.opponentPresent}
        variant={queueVariant ? 'queue' : 'friend'}
        queueMode={queueVariant ?? 'ranked'}
        onToggleReady={() => room.setReady(!room.myReady)}
        onStart={() => room.startMatch()}
        onLeave={backToMenu}
      />
    )
  }

  if (room.phase === 'error') {
    return (
      <div className="page narrow friend-page">
        <h1>{game.title}</h1>
        <div className="friend-error" role="alert">
          <p>{room.error ?? 'Connection lost.'}</p>
          <button className="btn" onClick={backToMenu}>
            Back to menu
          </button>
        </div>
      </div>
    )
  }

  if (game.id === 'ttt') {
    if (tttError) {
      return (
        <div className="page narrow friend-page">
          <h1>{game.title}</h1>
          <div className="friend-error" role="alert">
            <p>{tttError}</p>
            <button className="btn" onClick={backToMenu}>
              Back to menu
            </button>
          </div>
        </div>
      )
    }
    if (net.phase !== 'ready' || !net.initial) {
      return (
        <div className="page narrow friend-page">
          <h1>{game.title}</h1>
          <p className="muted">
            {net.phase === 'error'
              ? 'Could not connect to the match — check your connection.'
              : tttStarting || tttId
                ? 'Connecting players…'
                : 'Starting match…'}
          </p>
          <button className="btn ghost" onClick={backToMenu}>
            Cancel
          </button>
        </div>
      )
    }
  }

  const onlineSetup =
    game.id === 'ttt'
      ? { role: room.role ?? ('p1' as const), hooks: net.hooks, initial: net.initial }
      : { role: room.role ?? ('p1' as const), hooks: room.hooks }

  return (
    <div className="friend-stage">
      <GameHost
        game={game}
        onExit={backToMenu}
        online={onlineSetup}
        connection={{ opponentPresent: room.opponentPresent }}
        resultNote={resultNote}
        onGameOver={onGameOver}
      />
    </div>
  )
}
