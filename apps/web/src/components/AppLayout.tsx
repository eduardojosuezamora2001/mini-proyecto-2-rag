import { BarChart3, CalendarDays, FileText, MessageSquare, ShieldCheck } from "lucide-react"
import { NavLink, Outlet, useNavigate } from "react-router-dom"
import { useAuth } from "../auth/AuthContext"
import { ChatProvider } from "../chat/ChatContext"

export function AppLayout() {
  const { user, logout } = useAuth()
  const navigate = useNavigate()

  if (!user) return null

  function handleLogout() {
    logout()
    navigate("/login", { replace: true })
  }

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark small"><ShieldCheck size={20} /></div>
          <div><strong>RRHH</strong><span>conecta</span></div>
        </div>
        <nav>
          {user.role === "colaborador" && (
            <NavLink to="/attendance" className={({ isActive }) => isActive ? "active" : ""}>
              <CalendarDays size={18} />Historial
            </NavLink>
          )}
          <NavLink to="/chat" className={({ isActive }) => isActive ? "active" : ""}>
            <MessageSquare size={18} />Chat
          </NavLink>
          {user.role === "rrhh" && (
            <NavLink to="/dashboard" className={({ isActive }) => isActive ? "active" : ""}>
              <BarChart3 size={18} />Dashboard
            </NavLink>
          )}
          {user.role === "rrhh" && (
            <NavLink to="/documents" className={({ isActive }) => isActive ? "active" : ""}>
              <FileText size={18} />Documentos
            </NavLink>
          )}
        </nav>
        <div className="profile">
          <div className="avatar">{user.name.split(" ").map((part) => part[0]).slice(0, 2).join("")}</div>
          <div><strong>{user.name}</strong><span>{user.role === "rrhh" ? "Recursos Humanos" : "Colaborador"}</span></div>
          <button onClick={handleLogout} aria-label="Cerrar sesión">×</button>
        </div>
      </aside>
      <ChatProvider>
        <Outlet />
      </ChatProvider>
    </main>
  )
}
