import { Navigate } from "react-router-dom"
import type { ReactNode } from "react"
import { useAuth } from "../auth/AuthContext"
import type { User } from "../types"

export function RequireRole({
  role,
  children,
}: {
  role: User["role"]
  children: ReactNode
}) {
  const { user } = useAuth()
  return user?.role === role ? children : <Navigate to="/chat" replace />
}
