import { createContext, useContext, useState } from "react"
import type { ReactNode } from "react"
import { api } from "../api"
import { useAuth } from "../auth/AuthContext"
import type { ChatMessage } from "../types"

type ChatContextValue = {
  messages: ChatMessage[]
  message: string
  setMessage: (value: string) => void
  loading: boolean
  error: string
  sendMessage: (question: string) => Promise<void>
}

const ChatContext = createContext<ChatContextValue | null>(null)

export function ChatProvider({ children }: { children: ReactNode }) {
  const { token } = useAuth()
  const [messages, setMessages] = useState<ChatMessage[]>([
    { role: "assistant", content: "Hola. Pregunta por vacaciones, permisos, beneficios o tus solicitudes." },
  ])
  const [message, setMessage] = useState("")
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")

  async function sendMessage(question: string) {
    const trimmedQuestion = question.trim()
    if (!trimmedQuestion || loading) return

    setMessage("")
    setError("")
    setMessages((current) => [...current, { role: "user", content: trimmedQuestion }])
    setLoading(true)
    try {
      const result = await api<{
        answer: string
        citations: ChatMessage["citations"]
        source_label: string
        escalated: boolean
      }>("/api/chat", token, {
        method: "POST",
        body: JSON.stringify({ message: trimmedQuestion }),
      })
      setMessages((current) => [
        ...current,
        {
          role: "assistant",
          content: result.answer,
          citations: result.citations,
          sourceLabel: result.source_label,
          showSources: true,
          escalated: result.escalated,
        },
      ])
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No fue posible responder")
    } finally {
      setLoading(false)
    }
  }

  return (
    <ChatContext.Provider value={{ messages, message, setMessage, loading, error, sendMessage }}>
      {children}
    </ChatContext.Provider>
  )
}

export function useChat() {
  const context = useContext(ChatContext)
  if (!context) throw new Error("useChat debe usarse dentro de ChatProvider")
  return context
}
