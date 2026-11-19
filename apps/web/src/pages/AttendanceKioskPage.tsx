import { useRef, useState } from "react"
import type { FormEvent } from "react"
import { ArrowRight, Clock3, ShieldCheck } from "lucide-react"
import { Link } from "react-router-dom"
import { api } from "../api"

type KioskResult = {
  action: "check-in" | "check-out"
  mark: {
    hora_entrada?: string
    hora_salida?: string
  }
  notification?: { titulo: string; mensaje: string } | null
}

function formatTime(value: string | undefined) {
  if (!value) return "hora no disponible"
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return "hora no disponible"
  return new Intl.DateTimeFormat("es-CR", {
    timeZone: "America/Costa_Rica",
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  }).format(date)
}

export function AttendanceKioskPage() {
  const [code, setCode] = useState("")
  const [result, setResult] = useState<KioskResult | null>(null)
  const [error, setError] = useState("")
  const [isSubmitting, setIsSubmitting] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  async function submitCode(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError("")
    setResult(null)
    setIsSubmitting(true)
    try {
      const attendance = await api<KioskResult>("/api/attendance/kiosk", undefined, {
        method: "POST",
        body: JSON.stringify({ code }),
      })
      setResult(attendance)
      setCode("")
      inputRef.current?.focus()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No se pudo registrar la asistencia.")
    } finally {
      setIsSubmitting(false)
    }
  }

  const isCheckIn = result?.action === "check-in"
  const recordedTime = result
    ? formatTime(isCheckIn ? result.mark.hora_entrada : result.mark.hora_salida)
    : ""

  return (
    <main className="attendance-kiosk-shell">
      <header className="attendance-kiosk-topbar">
        <Link className="attendance-kiosk-brand" to="/asistencia" aria-label="RRHH Conecta, asistencia">
          <span className="attendance-kiosk-mark"><ShieldCheck size={20} /></span>
          <span><strong>RRHH</strong><small>conecta</small></span>
        </Link>
        <Link className="attendance-kiosk-portal-link" to="/login">Ingresar al portal</Link>
      </header>

      <div className="attendance-kiosk-content">
        <section className="attendance-kiosk-intro">
          <Clock3 size={22} aria-hidden="true" />
          <h1>Registra tu jornada</h1>
          <p>El mismo código registra tu entrada y tu salida, sin iniciar sesión en tu perfil.</p>
          <ol>
            <li><strong>Entrada</strong><span>Ingresa el código al comenzar tu jornada.</span></li>
            <li><strong>Salida</strong><span>Vuelve a ingresarlo al terminar; la hora queda registrada por el servidor.</span></li>
          </ol>
        </section>

        <section className="attendance-kiosk-panel">
          {error && <div className="attendance-kiosk-feedback error" role="alert">{error}</div>}
          {result && (
            <div className={`attendance-kiosk-feedback ${result.notification ? "warning" : "success"}`} role={result.notification ? "alert" : "status"}>
              <strong>{isCheckIn ? "Entrada registrada" : "Salida registrada"}</strong>
              <span>{recordedTime}</span>
              {result.notification && <p>{result.notification.mensaje}</p>}
            </div>
          )}

          <form className="attendance-kiosk-form" onSubmit={submitCode}>
            <label htmlFor="attendance-worker-code">Código de trabajador</label>
            <div className="attendance-kiosk-input-row">
              <input
                ref={inputRef}
                id="attendance-worker-code"
                type="text"
                inputMode="numeric"
                autoComplete="off"
                pattern="[0-9]{5}"
                maxLength={5}
                value={code}
                onChange={(event) => setCode(event.target.value.replace(/\D/g, "").slice(0, 5))}
                placeholder="00000"
                aria-describedby="attendance-kiosk-help"
                required
              />
              <button type="submit" disabled={code.length !== 5 || isSubmitting}>
                {isSubmitting ? "Registrando…" : "Marcar asistencia"}
                {!isSubmitting && <ArrowRight size={16} />}
              </button>
            </div>
            <small id="attendance-kiosk-help">Al ingresar el código, el sistema registra la entrada o cierra la jornada abierta.</small>
          </form>
        </section>
      </div>

      <footer className="attendance-kiosk-footer">
        Hora oficial de registro: servidor del portal · Zona horaria de Costa Rica
      </footer>
    </main>
  )
}
