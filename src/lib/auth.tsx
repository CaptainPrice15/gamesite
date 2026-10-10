/* eslint-disable react-refresh/only-export-components */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from './supabase'

export interface Profile {
  user_id: string
  display_name: string
  elo: number
  is_anonymous: boolean
  created_at: string
}

interface ProfileContextValue {
  session: Session | null
  profile: Profile | null
  ready: boolean
  error: string | null
  refresh: () => Promise<void>
  signInAnonymously: () => Promise<void>
  updateDisplayName: (name: string) => Promise<string | null>
}

const ProfileContext = createContext<ProfileContextValue | null>(null)

function toProfile(value: unknown): Profile | null {
  if (typeof value !== 'object' || value === null) return null
  const row = value as Partial<Profile>
  if (typeof row.user_id !== 'string' || typeof row.display_name !== 'string') return null
  return row as Profile
}

export function ProfileProvider({ children }: { children: ReactNode }): ReactNode {
  const [session, setSession] = useState<Session | null>(null)
  const [profile, setProfile] = useState<Profile | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [ready, setReady] = useState(() => supabase === null)

  const applyProfile = useCallback(async (): Promise<void> => {
    const client = supabase
    if (!client) return
    const { data, error: rpcError } = await client.rpc('ensure_profile')
    if (rpcError) {
      setError(rpcError.message)
      return
    }
    const next = toProfile(data)
    if (!next) {
      setError('profile unavailable')
      return
    }
    setProfile(next)
    setError(null)
  }, [])

  const refresh = useCallback(async (): Promise<void> => {
    const client = supabase
    if (!client) return
    try {
      const { data: current, error: sessionError } = await client.auth.getSession()
      if (sessionError) {
        setError(sessionError.message)
        return
      }
      setSession(current.session)
      if (!current.session) {
        setProfile(null)
        return
      }
      await applyProfile()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'connection failed')
    }
  }, [applyProfile])

  const signInAnonymously = useCallback(async (): Promise<void> => {
    const client = supabase
    if (!client) return
    try {
      const { data, error: signInError } = await client.auth.signInAnonymously()
      if (signInError) {
        setError(signInError.message)
        return
      }
      setSession(data.session)
      if (data.session) await applyProfile()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'connection failed')
    }
  }, [applyProfile])

  const updateDisplayName = useCallback(async (name: string): Promise<string | null> => {
    const client = supabase
    if (!client) return 'offline'
    try {
      const { data, error: rpcError } = await client.rpc('ensure_profile', {
        p_display_name: name,
      })
      if (rpcError) return rpcError.message
      const next = toProfile(data)
      if (!next) return 'unexpected profile response'
      setProfile(next)
      setError(null)
      return null
    } catch (cause) {
      return cause instanceof Error ? cause.message : 'connection failed'
    }
  }, [])

  useEffect(() => {
    const client = supabase
    if (!client) return
    let alive = true

    const boot = async (): Promise<void> => {
      try {
        const { data: current, error: sessionError } = await client.auth.getSession()
        if (!alive) return
        if (sessionError) setError(sessionError.message)

        let active = current.session
        if (!active) {
          const { data: anon, error: anonError } = await client.auth.signInAnonymously()
          if (!alive) return
          if (anonError) {
            setError(anonError.message)
          } else {
            active = anon.session
            setError(null)
          }
        }

        if (!alive) return
        setSession(active)
        if (active) {
          const { data, error: rpcError } = await client.rpc('ensure_profile')
          if (!alive) return
          if (rpcError) setError(rpcError.message)
          else {
            const next = toProfile(data)
            if (next) {
              setProfile(next)
              setError(null)
            } else {
              setError('profile unavailable')
            }
          }
        }
      } catch (cause) {
        if (alive) setError(cause instanceof Error ? cause.message : 'connection failed')
      } finally {
        if (alive) setReady(true)
      }
    }

    void boot()
    return () => {
      alive = false
    }
  }, [])

  const value = useMemo<ProfileContextValue>(
    () => ({
      session,
      profile,
      ready,
      error,
      refresh,
      signInAnonymously,
      updateDisplayName,
    }),
    [session, profile, ready, error, refresh, signInAnonymously, updateDisplayName],
  )

  return <ProfileContext.Provider value={value}>{children}</ProfileContext.Provider>
}

export function useProfile(): ProfileContextValue {
  const context = useContext(ProfileContext)
  if (!context) throw new Error('useProfile must be used inside ProfileProvider')
  return context
}
