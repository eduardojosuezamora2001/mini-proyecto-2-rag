import { useEffect, useState } from "react"
import { Bell, CalendarDays } from "lucide-react"
import { useAuth } from "../auth/AuthContext"
import { api } from "../api"

type AttendanceMark = {
  id: string
  fecha: string
  hora_entrada: string
  hora_salida: string | null
  hora_entrada_local?: string
  hora_salida_local?: string | null
  hora_entrada_programada: string
  hora_salida_programada: string
  salida_dia_siguiente: boolean
  salida_anticipada: boolean
}

type AttendanceNotification = {
  id: string
  titulo: string
  mensaje: string
  creada_en: string
  leida_en: string | null
}

type AttendanceData = {
  schedule: {
    dia_semana: number
    hora_entrada: string
    hora_salida: string
    salida_dia_siguiente: boolean
  } | null
  today: AttendanceMark | null
  active: AttendanceMark | null
  history: AttendanceMark[]
  notifications: AttendanceNotification[]
}

function formatTime(value: string | null | undefined) {
  if (!value) return "Sin registrar"
  const timeOnly = value.match(/^(\d{2}:\d{2})/)
  if (timeOnly) return timeOnly[1]
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return "Sin registrar"
  return new Intl.DateTimeFormat("es-CR", {
    timeZone: "America/Costa_Rica",
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  }).format(date)
}

function formatDate(value: string) {
  const date = new Date(`${value.slice(0, 10)}T12:00:00-06:00`)
  return Number.isNaN(date.getTime())
    ? value
    : new Intl.DateTimeFormat("es-CR", {
        timeZone: "America/Costa_Rica",
        day: "2-digit",
        month: "short",
        year: "numeric",
      }).format(date)
}

function formatDateTime(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return "Fecha desconocida"
  return new Intl.DateTimeFormat("es-CR", {
    timeZone: "America/Costa_Rica",
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date)
}

function scheduledEnd(mark: AttendanceMark) {
  return `${formatTime(mark.hora_salida_programada)}${mark.salida_dia_siguiente ? " (día siguiente)" : ""}`
}

function currentStatus(data: AttendanceData | null) {
  if (data?.active) return "Jornada en curso"
  if (data?.today?.hora_salida) return "Jornada finalizada"
  if (data?.today) return "Entrada registrada"
  return "Sin marca de entrada"
}

export function AttendancePage() {
  const { token, user } = useAuth()
  const [data, setData] = useState<AttendanceData | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState("")

  useEffect(() => {
    let active = true
    api<AttendanceData>("/api/attendance/me", token)
      .then((result) => {
        if (active) setData(result)
      })
      .catch((cause) => {
        if (active) setError(cause instanceof Error ? cause.message : "No se pudo cargar tu asistencia.")
      })
      .finally(() => {
        if (active) setIsLoading(false)
      })
    return () => {
      active = false
    }
  }, [token])

  const expectedEnd = data?.active
    ? scheduledEnd(data.active)
    : data?.schedule
      ? `${formatTime(data.schedule.hora_salida)}${data.schedule.salida_dia_siguiente ? " (día siguiente)" : ""}`
      : "Sin horario"

  return (
    <section className="attendance-shell">
      <header className="attendance-header">
        <div>
          <h1>Mi historial de asistencia</h1>
          <p>{user?.name} · {new Intl.DateTimeFormat("es-CR", { dateStyle: "full", timeZone: "America/Costa_Rica" }).format(new Date())}</p>
        </div>
      </header>

      {error && <div className="attendance-feedback error" role="alert">{error}</div>}

      <div className="attendance-metrics" aria-busy={isLoading}>
        <article>
          <span>Estado de hoy</span>
          <strong>{isLoading ? "Cargando…" : error ? "No disponible" : currentStatus(data)}</strong>
          <small>{data?.today ? formatDate(data.today.fecha) : isLoading ? "Cargando jornada…" : "Registro del día"}</small>
        </article>
        <article>
          <span>Entrada registrada</span>
          <strong>{isLoading ? "Cargando…" : error ? "No disponible" : formatTime(data?.today?.hora_entrada_local)}</strong>
          <small>Horario: {isLoading ? "Cargando…" : error ? "No disponible" : formatTime(data?.active?.hora_entrada_programada ?? data?.schedule?.hora_entrada)}</small>
        </article>
        <article>
          <span>Salida programada</span>
          <strong>{isLoading ? "Cargando…" : error ? "No disponible" : expectedEnd}</strong>
          <small>Según el horario asignado</small>
        </article>
        <article>
          <span>Días con marca</span>
          <strong>{isLoading ? "Cargando…" : error ? "No disponible" : data?.history.length ?? 0}</strong>
          <small>Últimos 30 días</small>
        </article>
      </div>

      <div className="attendance-main-grid">
        <section className="attendance-action-panel attendance-readonly-panel">
          <h2>Jornada de hoy</h2>
          <p>
            {isLoading
              ? "Cargando el estado de tu jornada."
              : error
                ? "No se pudo cargar el estado de hoy. Intenta actualizar la página."
                : data?.schedule
                  ? `Horario asignado: ${formatTime(data.schedule.hora_entrada)} a ${expectedEnd}. Las marcas se realizan en el terminal de asistencia.`
                  : "No tienes un horario programado para hoy. Contacta a RRHH si crees que esto es incorrecto."}
          </p>
          {data?.today?.salida_anticipada && (
            <div className="attendance-early-note">
              <Bell size={16} /> Tu salida quedó registrada antes del horario programado.
            </div>
          )}
        </section>

        <section className="attendance-notifications-panel">
          <div className="attendance-section-heading">
            <div><h2>Avisos de asistencia</h2><p>Notificaciones guardadas en tu cuenta</p></div>
            <Bell size={18} />
          </div>
          {isLoading ? (
            <div className="attendance-empty-notifications">Cargando notificaciones…</div>
          ) : error ? (
            <div className="attendance-empty-notifications">No se pudieron cargar las notificaciones.</div>
          ) : data?.notifications.length ? (
            <ul className="attendance-notification-list">
              {data.notifications.slice(0, 5).map((notification) => (
                <li key={notification.id}>
                  <span className="attendance-notification-mark"><Bell size={15} /></span>
                  <div>
                    <strong>{notification.titulo}</strong>
                    <p>{notification.mensaje}</p>
                    <time>{formatDateTime(notification.creada_en)}</time>
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <div className="attendance-empty-notifications">
              <span>No tienes avisos de asistencia recientes.</span>
            </div>
          )}
        </section>
      </div>

      <section className="attendance-history-panel">
        <div className="attendance-section-heading">
          <div><h2>Historial de jornadas</h2><p>Entradas y salidas de los últimos 30 días</p></div>
          <CalendarDays size={19} />
        </div>
        <div className="attendance-table-wrap">
          <table>
            <thead>
              <tr><th>Fecha</th><th>Entrada</th><th>Salida programada</th><th>Salida registrada</th><th>Estado</th></tr>
            </thead>
            <tbody>
              {data?.history.map((mark) => (
                <tr key={mark.id}>
                  <td>{formatDate(mark.fecha)}</td>
                  <td>{formatTime(mark.hora_entrada_local)}</td>
                  <td>{scheduledEnd(mark)}</td>
                  <td>{formatTime(mark.hora_salida_local)}</td>
                  <td>
                    <span className={`attendance-status${mark.salida_anticipada ? " early" : ""}`}>
                      {mark.salida_anticipada ? "Salida anterior" : mark.hora_salida ? "Completa" : "En curso"}
                    </span>
                  </td>
                </tr>
              ))}
              {!isLoading && error && <tr key="history-error"><td colSpan={5} className="attendance-table-empty">No se pudo cargar el historial.</td></tr>}
              {!isLoading && !error && data?.history.length === 0 && (
                <tr key="history-empty"><td colSpan={5} className="attendance-table-empty">Aún no hay marcas en los últimos 30 días.</td></tr>
              )}
              {isLoading && <tr key="history-loading"><td colSpan={5} className="attendance-table-empty">Cargando historial…</td></tr>}
            </tbody>
          </table>
        </div>
      </section>
    </section>
  )
}
