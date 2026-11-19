import { useEffect, useMemo, useState } from "react"
import { CalendarDays, RefreshCw } from "lucide-react"
import { useAuth } from "../auth/AuthContext"
import { api } from "../api"
import type { DashboardData } from "../types"

type DailyReport = {
  id: string
  fecha: string
  datos_json: Record<string, unknown>
  resumen_texto: string
  generado_por: string
}

type TrendPoint = { fecha: string; marcas: number | string; salidas_anticipadas: number | string }
type Topic = { topic: string; count: number | string }

function toRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

function toNumber(value: unknown) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

function formatReportDate(value: string) {
  const date = new Date(`${value.slice(0, 10)}T12:00:00-06:00`)
  return Number.isNaN(date.getTime())
    ? value
    : new Intl.DateTimeFormat("es-CR", { timeZone: "America/Costa_Rica", dateStyle: "medium" }).format(date)
}

function AttendanceTrendChart({ points }: { points: TrendPoint[] }) {
  const width = 720
  const height = 190
  const padding = { top: 14, right: 12, bottom: 27, left: 30 }
  const maxValue = Math.max(1, ...points.map((point) => toNumber(point.marcas)))
  const chartWidth = width - padding.left - padding.right
  const chartHeight = height - padding.top - padding.bottom
  const scaleValues = [...new Set([0, Math.round(maxValue / 2), maxValue])]
  const line = (key: keyof Pick<TrendPoint, "marcas" | "salidas_anticipadas">) =>
    points.map((point, index) => {
      const x = padding.left + (points.length <= 1 ? chartWidth / 2 : (index / (points.length - 1)) * chartWidth)
      const y = padding.top + chartHeight - (toNumber(point[key]) / maxValue) * chartHeight
      return `${index === 0 ? "M" : "L"} ${x.toFixed(1)} ${y.toFixed(1)}`
    }).join(" ")
  const visibleDateIndices = points.length > 2
    ? [...new Set([0, Math.floor((points.length - 1) / 2), points.length - 1])]
    : points.map((_, index) => index)
  const dateX = (index: number) => padding.left + (points.length <= 1 ? chartWidth / 2 : (index / (points.length - 1)) * chartWidth)

  return (
    <figure className="attendance-trend-chart">
      <div className="chart-legend">
        <span><i className="chart-legend-mark attendance-mark" /> Marcas</span>
        <span><i className="chart-legend-mark early-mark" /> Salidas anticipadas</span>
      </div>
      {points.length ? (
        <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Marcas y salidas anticipadas de los últimos 30 días">
          {scaleValues.map((value) => {
            const y = padding.top + chartHeight - (value / maxValue) * chartHeight
            return (
              <g key={value}>
                <line x1={padding.left} x2={width - padding.right} y1={y} y2={y} className="attendance-chart-grid" />
                <text x={padding.left - 8} y={y + 4} textAnchor="end">{value}</text>
              </g>
            )
          })}
          <path d={line("marcas")} className="attendance-chart-line" />
          <path d={line("salidas_anticipadas")} className="attendance-chart-line early" />
          {visibleDateIndices.map((pointIndex, index) => (
            <text key={`${points[pointIndex].fecha}-${index}`} x={dateX(pointIndex)} y={height - 5} textAnchor={index === 0 ? "start" : index === visibleDateIndices.length - 1 ? "end" : "middle"}>
              {String(points[pointIndex].fecha).slice(5, 10)}
            </text>
          ))}
        </svg>
      ) : (
        <p className="dashboard-empty-chart">El reporte no contiene datos de asistencia para este periodo.</p>
      )}
      <figcaption>La escala vertical representa cantidad de marcas por día. Los días sin registros se muestran en cero.</figcaption>
    </figure>
  )
}

export function DashboardPage() {
  const { token } = useAuth()
  const [dashboard, setDashboard] = useState<DashboardData | null>(null)
  const [reports, setReports] = useState<DailyReport[]>([])
  const [selectedReportId, setSelectedReportId] = useState("")
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState("")

  useEffect(() => {
    Promise.all([
      api<DashboardData>("/api/dashboard", token),
      api<DailyReport[]>("/api/reports", token),
    ])
      .then(([dashboardResult, reportResult]) => {
        setDashboard(dashboardResult)
        setReports(reportResult)
        setSelectedReportId(reportResult[0]?.id ?? "")
      })
      .catch((cause) => setError(cause instanceof Error ? cause.message : "No fue posible cargar el dashboard"))
      .finally(() => setIsLoading(false))
  }, [token])

  async function generateReport() {
    setError("")
    try {
      await api("/api/reports/generate", token, { method: "POST" })
      const [dashboardResult, reportResult] = await Promise.all([
        api<DashboardData>("/api/dashboard", token),
        api<DailyReport[]>("/api/reports", token),
      ])
      setDashboard(dashboardResult)
      setReports(reportResult)
      setSelectedReportId(reportResult[0]?.id ?? "")
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Error")
    }
  }

  const selectedReport = useMemo(
    () => reports.find((report) => report.id === selectedReportId) ?? reports[0] ?? null,
    [reports, selectedReportId],
  )
  const reportData = toRecord(selectedReport?.datos_json ?? dashboard?.reporte_reciente?.datos_json)
  const attendance = toRecord(reportData.asistencia_hoy)
  const hasAttendanceData = Object.keys(attendance).length > 0
  const attendanceValue = (key: string) => {
    if (isLoading) return "Cargando…"
    if (error) return "No disponible"
    return hasAttendanceData ? toNumber(attendance[key]) : "Sin reporte"
  }
  const trend = Array.isArray(reportData.tendencia_asistencia_30_dias)
    ? reportData.tendencia_asistencia_30_dias as TrendPoint[]
    : []
  const topics = Array.isArray(reportData.top_5_temas) ? reportData.top_5_temas as Topic[] : []
  const maxTopicCount = Math.max(1, ...topics.map((topic) => toNumber(topic.count)))

  return (
    <section className="dashboard-shell">
      <header className="dashboard-header">
        <div><h1>Asistencia y resumen diario</h1><p>Marcas y reportes agregados del equipo · Costa Rica</p></div>
        <button onClick={generateReport} disabled={isLoading}>
          <RefreshCw size={15} /> Generar reporte
        </button>
      </header>
      {error && <div className="error-banner">{error}</div>}
      <div className="metrics">
        <article><span>Colaboradores con marca</span><strong>{attendanceValue("colaboradores")}</strong><small>{formatReportDate(selectedReport?.fecha ?? "") || "Reporte más reciente"}</small></article>
        <article><span>Jornadas completas</span><strong>{attendanceValue("jornadas_completas")}</strong><small>Entrada y salida registradas</small></article>
        <article><span>Salidas anticipadas</span><strong>{attendanceValue("salidas_anticipadas")}</strong><small>Notificación guardada en la cuenta</small></article>
        <article><span>Salidas pendientes</span><strong>{attendanceValue("sin_marca_salida")}</strong><small>Jornadas todavía abiertas</small></article>
      </div>
      <div className="dashboard-grid">
        <article className="panel executive">
          <div className="dashboard-panel-heading">
            <div><h2>Resumen ejecutivo</h2><p>{selectedReport ? `Reporte del ${formatReportDate(selectedReport.fecha)}` : "Sin reportes todavía"}</p></div>
            <CalendarDays size={17} />
          </div>
          <p>{selectedReport?.resumen_texto ?? dashboard?.reporte_reciente?.resumen_texto ?? "Genera el reporte diario para crear el resumen ejecutivo."}</p>
          <label className="report-history-select">
            <span>Consultar otro día</span>
            <select
              value={selectedReport?.id ?? ""}
              onChange={(event) => setSelectedReportId(event.target.value)}
              disabled={reports.length === 0}
            >
              {reports.length === 0 && <option value="">Sin reportes guardados</option>}
              {reports.map((report) => (
                <option key={report.id} value={report.id}>{formatReportDate(report.fecha)}</option>
              ))}
            </select>
          </label>
        </article>
        <article className="panel">
          <h2>Solicitudes pendientes</h2>
          <div className="table-wrap">
            <table>
              <thead><tr><th>Colaborador</th><th>Tipo</th><th>Inicio</th><th>Estado</th></tr></thead>
              <tbody>
                {dashboard?.solicitudes_pendientes.map((row, index) => (
                  <tr key={index}><td>{String(row.nombre)}</td><td>{String(row.tipo)}</td><td>{String(row.fecha_inicio).slice(0, 10)}</td><td><b>{String(row.estado)}</b></td></tr>
                ))}
                {dashboard?.solicitudes_pendientes.length === 0 && (
                  <tr><td colSpan={4} className="dashboard-table-empty">No hay solicitudes pendientes.</td></tr>
                )}
                {!dashboard && (
                  <tr><td colSpan={4} className="dashboard-table-empty">
                    {isLoading ? "Cargando solicitudes…" : "No se pudieron cargar las solicitudes."}
                  </td></tr>
                )}
              </tbody>
            </table>
          </div>
        </article>
      </div>
      <div className="dashboard-grid dashboard-chart-grid">
        <article className="panel">
          <h2>Asistencia de los últimos 30 días</h2>
          <AttendanceTrendChart points={trend} />
        </article>
        <article className="panel">
          <h2>Temas más consultados</h2>
          {topics.length ? (
            <ol className="dashboard-topic-list">
              {topics.map((topic, index) => {
                const count = toNumber(topic.count)
                return (
                  <li key={`${topic.topic}-${index}`}>
                    <div><span>{topic.topic.replaceAll("_", " ")}</span><strong>{count}</strong></div>
                    <span className="dashboard-topic-track"><i style={{ width: `${(count / maxTopicCount) * 100}%` }} /></span>
                  </li>
                )
              })}
            </ol>
          ) : (
            <p className="dashboard-empty-chart">El reporte no contiene consultas clasificadas.</p>
          )}
        </article>
      </div>
    </section>
  )
}
