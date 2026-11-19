import { createContext, useContext, useEffect, useState } from "react"
import type { ReactNode } from "react"
import { api } from "../api"
import type { User } from "../types"

type AuthContextValue = {
  token: string
  user: User | null
  isLoading: boolean
  login: (role: User["role"]) => Promise<User>
  loginWithCode: (code: string) => Promise<User>
  logout: () => void
}

const AuthContext = createContext<AuthContextValue | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [token, setToken] = useState(() => localStorage.getItem("rrhh-token") ?? "")
  const [user, setUser] = useState<User | null>(null)
  const [isLoading, setIsLoading] = useState(() => Boolean(localStorage.getItem("rrhh-token")))

  useEffect(() => {
    if (!token) return

    let cancelled = false
    api<User>("/api/me", token)
      .then((profile) => {
        if (!cancelled) setUser(profile)
      })
      .catch(() => {
        if (cancelled) return
        localStorage.removeItem("rrhh-token")
        setToken("")
        setUser(null)
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [token])

  async function login(role: User["role"]) {
    const result = await api<{ token: string; user: User }>(`/api/auth/demo/${role}`, undefined, {
      method: "POST",
    })
    localStorage.setItem("rrhh-token", result.token)
    setToken(result.token)
    setUser(result.user)
    return result.user
  }

  async function loginWithCode(code: string) {
    const result = await api<{ token: string; user: User }>("/api/auth/employee-code", undefined, {
      method: "POST",
      body: JSON.stringify({ code }),
    })
    localStorage.setItem("rrhh-token", result.token)
    setToken(result.token)
    setUser(result.user)
    return result.user
  }

  function logout() {
    localStorage.removeItem("rrhh-token")
    setToken("")
    setUser(null)
  }

  return (
    <AuthContext.Provider value={{ token, user, isLoading, login, loginWithCode, logout }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const context = useContext(AuthContext)
  if (!context) throw new Error("useAuth debe usarse dentro de AuthProvider")
  return context
}
