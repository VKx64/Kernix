import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { api, ApiError, unwrap } from '../lib/api'
import type { ApiEnvelope, User } from '../types/api'

type AuthStatus = 'loading' | 'authenticated' | 'guest'

interface AuthContextValue {
  user: User | null
  status: AuthStatus
  login: (login: string, password: string, remember?: boolean) => Promise<void>
  logout: () => Promise<void>
  refresh: () => Promise<User | null>
}

const AuthContext = createContext<AuthContextValue | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [status, setStatus] = useState<AuthStatus>('loading')

  const refresh = useCallback(async () => {
    try {
      const response = await api.get<ApiEnvelope<User> | User>('/api/user')
      const next = unwrap(response)
      setUser(next)
      setStatus('authenticated')
      return next
    } catch (error) {
      if (!(error instanceof ApiError) || error.status !== 401) console.warn('Could not load the signed-in user.', error)
      setUser(null)
      setStatus('guest')
      return null
    }
  }, [])

  useEffect(() => { void refresh() }, [refresh])

  useEffect(() => {
    const unauthorized = () => {
      setUser(null)
      setStatus('guest')
    }
    window.addEventListener('auth:unauthorized', unauthorized)
    return () => window.removeEventListener('auth:unauthorized', unauthorized)
  }, [])

  const login = useCallback(async (identity: string, password: string, remember = false) => {
    await api.csrf()
    await api.post('/login', { login: identity, password, remember })
    const next = await refresh()
    if (!next) throw new ApiError('Signed in, but the user profile could not be loaded.', 500)
  }, [refresh])

  const logout = useCallback(async () => {
    try {
      await api.post('/logout')
    } finally {
      setUser(null)
      setStatus('guest')
    }
  }, [])

  const value = useMemo(() => ({ user, status, login, logout, refresh }), [user, status, login, logout, refresh])
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const value = useContext(AuthContext)
  if (!value) throw new Error('useAuth must be used inside AuthProvider')
  return value
}
