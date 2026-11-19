export type User = {
  id: string
  name: string
  role: "colaborador" | "rrhh"
  department?: string
  position?: string
}

export type ChatMessage = {
  role: "user" | "assistant"
  content: string
  citations?: Array<{ documento: string; seccion: string | null; enlace: string | null }>
  sourceLabel?: string
  showSources?: boolean
  escalated?: boolean
}

export type DashboardData = {
  solicitudes_pendientes: Array<Record<string, unknown>>
  uso_chat: { consultas: number; latencia_promedio: number; resueltas: number }
  reporte_reciente: { id?: string; fecha?: string; resumen_texto?: string; datos_json?: Record<string, unknown> } | null
}
