import { Navigate, Outlet } from "react-router-dom"
import { useAuth } from "../auth/AuthContext"

export function RequireAuth() {
  const { user, isLoading } = useAuth()

  if (isLoading) return <main className="login-shell">Cargando...</main>
  if (!user) return <Navigate to="/login" replace />
  return <Outlet />
}
