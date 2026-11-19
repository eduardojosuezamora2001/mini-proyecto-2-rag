import { useState } from "react"
import type { FormEvent } from "react"
import { ArrowRight, BarChart3, Clock3, ShieldCheck } from "lucide-react"
import { Link, Navigate, useNavigate } from "react-router-dom"
import { useAuth } from "../auth/AuthContext"
import type { User } from "../types"

const demoAccounts = [
  { code: "10001", name: "Colaborador Demo 01", department: "Tecnología" },
  { code: "10002", name: "Colaborador Demo 02", department: "Ventas" },
  { code: "10003", name: "Colaborador Demo 03", department: "Finanzas" },
  { code: "10004", name: "Colaborador Demo 04", department: "RRHH" },
  { code: "10005", name: "Colaborador Demo 05", department: "Operaciones" },
]

export function LoginPage() {
  const { user, isLoading, login, loginWithCode } = useAuth()
  const navigate = useNavigate()
  const [code, setCode] = useState("")
  const [error, setError] = useState("")

  if (isLoading) return <main className="login-shell">Cargando...</main>
  if (user) return <Navigate to={user.role === "rrhh" ? "/dashboard" : "/attendance"} replace />

  function destination(role: User["role"]) {
    navigate(role === "rrhh" ? "/dashboard" : "/attendance", { replace: true })
  }

  async function handleLogin(role: User["role"]) {
    setError("")
    try {
      const signedInUser = await login(role)
      destination(signedInUser.role)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No fue posible iniciar sesión")
    }
  }

  async function handleCodeLogin(value: string) {
    setError("")
    try {
      const signedInUser = await loginWithCode(value)
      destination(signedInUser.role)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No fue posible iniciar sesión")
    }
  }

  function submitCode(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (code.length !== 5) {
      setError("Ingresa los cinco dígitos de tu código.")
      return
    }
    void handleCodeLogin(code)
  }

  return (
    <main className="login-shell">
      <section className="login-card attendance-login-card">
        <div className="brand-mark"><ShieldCheck size={26} /></div>
        <h1>Tu jornada, <span>al día</span></h1>
        <p className="login-copy">Ingresa al portal para consultar tu historial y revisar las políticas de RRHH.</p>
        <Link className="login-kiosk-link" to="/asistencia">
          ¿Vas a marcar entrada o salida? Abre el terminal de asistencia.
        </Link>
        {error && <div className="error-banner">{error}</div>}
        <form className="employee-code-form" onSubmit={submitCode}>
          <label htmlFor="employee-code">Código de trabajador</label>
          <div className="employee-code-control">
            <input
              id="employee-code"
              type="text"
              inputMode="numeric"
              autoComplete="username"
              pattern="[0-9]{5}"
              maxLength={5}
              value={code}
              onChange={(event) => setCode(event.target.value.replace(/\D/g, "").slice(0, 5))}
              placeholder="00000"
              aria-describedby="employee-code-help"
              required
            />
            <button type="submit" className="employee-code-submit" disabled={code.length !== 5}>
              Ingresar <ArrowRight size={16} />
            </button>
          </div>
          <small id="employee-code-help">Usa el código de cinco dígitos asignado por RRHH.</small>
        </form>

        <div className="demo-account-list">
          <div className="demo-account-heading">
            <h2>Cuentas de prueba</h2>
            <span>Selecciona una para ingresar</span>
          </div>
          {demoAccounts.map((account) => (
            <button key={account.code} className="demo-account" onClick={() => void handleCodeLogin(account.code)}>
              <span className="demo-account-icon"><Clock3 size={17} /></span>
              <span className="demo-account-copy">
                <strong>{account.name}</strong>
                <small>{account.department} · código {account.code}</small>
              </span>
              <ArrowRight size={16} />
            </button>
          ))}
        </div>

        <div className="login-hr">
          <span>¿Administras el portal?</span>
          <button onClick={() => void handleLogin("rrhh")}>
            <BarChart3 size={16} /> Acceso de demostración RRHH
          </button>
        </div>
        <p className="login-demo-note">Los códigos mostrados son datos simulados para pruebas; no representan credenciales de producción.</p>
      </section>
    </main>
  )
}
