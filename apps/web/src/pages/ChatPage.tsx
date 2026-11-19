import { useEffect, useRef } from "react"
import type { FormEvent } from "react"
import { BookOpen, Bot, Search } from "lucide-react"
import { useChat } from "../chat/ChatContext"

function safeSourceLink(value: string | null) {
  if (!value) return null
  try {
    const url = new URL(value)
    return url.protocol === "https:" ? url.href : null
  } catch {
    return null
  }
}

export function ChatPage() {
  const { messages, message, setMessage, loading, error, sendMessage } = useChat()
  const chatEnd = useRef<HTMLDivElement>(null)

  useEffect(() => {
    chatEnd.current?.scrollIntoView({ behavior: "smooth" })
  }, [messages])

  function handleSubmit(event: FormEvent) {
    event.preventDefault()
    void sendMessage(message)
  }

  return (
    <section className="chat-shell">
      <header className="chat-header">
        <div>
          <p className="eyebrow">ASISTENTE DE RRHH</p>
          <h1>¿En qué puedo ayudarte?</h1>
        </div>
        <div className="status"><span />Conectado</div>
      </header>
      <div className="messages">
        {messages.map((item, index) => (
          <article key={index} className={`message ${item.role}`}>
            {item.role === "assistant" && <div className="bot-avatar"><Bot size={17} /></div>}
            <div className="bubble">
              <p>{item.content}</p>
              {item.showSources && (
                <div className="citations">
                  <span><BookOpen size={13} />Fuentes</span>
                  {item.citations?.map((citation, citationIndex) => {
                    const label = `[${citationIndex + 1}] ${citation.documento}${citation.seccion ? ` · ${citation.seccion}` : ""}`
                    const href = safeSourceLink(citation.enlace)
                    return href ? (
                      <a key={`${citation.documento}-${citationIndex}`} href={href} target="_blank" rel="noreferrer">
                        {label}
                      </a>
                    ) : (
                      <span className="citation-source" key={`${citation.documento}-${citationIndex}`}>{label}</span>
                    )
                  })}
                  {item.sourceLabel && <small className="citation-source-label">{item.sourceLabel}</small>}
                  {!item.citations?.length && !item.sourceLabel && (
                    <small className="citation-source-label">No se encontraron fuentes disponibles.</small>
                  )}
                </div>
              )}
              {item.escalated && <div className="escalate">Esta consulta puede derivarse a RRHH.</div>}
            </div>
          </article>
        ))}
        {loading && <article className="message assistant"><div className="bot-avatar"><Bot size={17} /></div><div className="bubble typing"><i /><i /><i /></div></article>}
        <div ref={chatEnd} />
      </div>
      {error && <div className="chat-error">{error}</div>}
      <form className="composer" onSubmit={handleSubmit}>
        <Search size={18} />
        <input value={message} onChange={(event) => setMessage(event.target.value)} placeholder="Escribe tu pregunta sobre RRHH..." />
        <button type="submit" disabled={loading || !message.trim()}>{loading ? "..." : "Enviar"}</button>
      </form>
    </section>
  )
}
