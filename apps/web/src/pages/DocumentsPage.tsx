import { useEffect, useRef, useState } from "react"
import { FileText, RefreshCw, Search, Trash2, Upload } from "lucide-react"
import { useAuth } from "../auth/AuthContext"
import { api } from "../api"

type DriveDocument = {
  id: string
  name: string
  mimeType: string
  modifiedTime: string | null
  webViewLink: string | null
  size: string | null
}

type DriveDocumentDetail = DriveDocument & { content: string }

const acceptedFormats = ".pdf,.docx,.md,.txt,.csv,.xls,.xlsx"

function formatType(mimeType: string, name: string) {
  const extension = name.includes(".") ? name.split(".").pop()?.toUpperCase() : undefined
  if (extension) return extension
  if (mimeType === "application/vnd.google-apps.document") return "Google Docs"
  if (mimeType === "application/vnd.google-apps.spreadsheet") return "Google Sheets"
  return "Documento"
}

function formatDate(value: string | null) {
  if (!value) return "Fecha desconocida"
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? "Fecha desconocida" : date.toLocaleDateString("es")
}

function formatSize(value: string | null) {
  const bytes = Number(value)
  if (!Number.isFinite(bytes) || bytes <= 0) return ""
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export function DocumentsPage() {
  const { token } = useAuth()
  const fileInput = useRef<HTMLInputElement>(null)
  const [documents, setDocuments] = useState<DriveDocument[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [preview, setPreview] = useState<DriveDocumentDetail | null>(null)
  const [previewError, setPreviewError] = useState<{ id: string; message: string } | null>(null)
  const [search, setSearch] = useState("")
  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [isUploading, setIsUploading] = useState(false)
  const [isSyncing, setIsSyncing] = useState(false)
  const [isDeleting, setIsDeleting] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [feedback, setFeedback] = useState<{ kind: "success" | "error"; text: string } | null>(null)

  useEffect(() => {
    let active = true
    api<DriveDocument[]>("/api/drive/documents", token)
      .then((result) => {
        if (!active) return
        setDocuments(result)
        setSelectedId(result[0]?.id ?? null)
      })
      .catch((cause) => {
        if (active) {
          setFeedback({
            kind: "error",
            text: cause instanceof Error ? cause.message : "No se pudieron cargar los documentos.",
          })
        }
      })
      .finally(() => {
        if (active) setIsLoading(false)
      })

    return () => {
      active = false
    }
  }, [token])

  useEffect(() => {
    if (!selectedId) return
    let active = true
    api<DriveDocumentDetail>(`/api/drive/documents/${encodeURIComponent(selectedId)}`, token)
      .then((result) => {
        if (active) {
          setPreview(result)
          setPreviewError(null)
        }
      })
      .catch((cause) => {
        if (active) {
          setPreviewError({
            id: selectedId,
            message: cause instanceof Error ? cause.message : "No se pudo leer el documento.",
          })
        }
      })

    return () => {
      active = false
    }
  }, [selectedId, token])

  async function refreshDocuments() {
    setIsRefreshing(true)
    setFeedback(null)
    try {
      const result = await api<DriveDocument[]>("/api/drive/documents", token)
      setDocuments(result)
      setSelectedId((current) =>
        current && result.some((document) => document.id === current) ? current : result[0]?.id ?? null,
      )
      return true
    } catch (cause) {
      setFeedback({
        kind: "error",
        text: cause instanceof Error ? cause.message : "No se pudieron actualizar los documentos.",
      })
      return false
    } finally {
      setIsRefreshing(false)
    }
  }

  async function synchronizeDrive() {
    setIsSyncing(true)
    setFeedback(null)
    try {
      const result = await api<{ indexed: number; updated: number }>("/api/ingest/sync", token, {
        method: "POST",
      })
      if (await refreshDocuments()) {
        setFeedback({
          kind: "success",
          text: `Drive sincronizado. ${result.indexed} documentos indexados; ${result.updated} fragmentos actualizados.`,
        })
      }
    } catch (cause) {
      setFeedback({
        kind: "error",
        text: cause instanceof Error ? cause.message : "No se pudo sincronizar Drive.",
      })
    } finally {
      setIsSyncing(false)
    }
  }

  async function uploadDocument() {
    if (!selectedFile) return
    setIsUploading(true)
    setFeedback(null)
    const query = new URLSearchParams({ name: selectedFile.name })
    try {
      const created = await api<DriveDocument>(`/api/drive/documents?${query}`, token, {
        method: "POST",
        headers: { "Content-Type": "application/octet-stream" },
        body: selectedFile,
      })
      setDocuments((current) => [...current, created].sort((a, b) => a.name.localeCompare(b.name)))
      setSelectedId(created.id)
      setSelectedFile(null)
      if (fileInput.current) fileInput.current.value = ""

      setIsSyncing(true)
      try {
        await api("/api/ingest/sync", token, { method: "POST" })
        setFeedback({ kind: "success", text: `${created.name} se subió e indexó correctamente.` })
      } catch (cause) {
        setFeedback({
          kind: "error",
          text: `${created.name} se subió a Drive, pero no se pudo indexar: ${
            cause instanceof Error ? cause.message : "error de sincronización"
          }`,
        })
      } finally {
        setIsSyncing(false)
      }
    } catch (cause) {
      setFeedback({
        kind: "error",
        text: cause instanceof Error ? cause.message : "No se pudo subir el documento.",
      })
    } finally {
      setIsUploading(false)
    }
  }

  async function deleteSelectedDocument() {
    if (!selectedId) return
    const name = documents.find((document) => document.id === selectedId)?.name ?? "el documento"
    setIsDeleting(true)
    setFeedback(null)
    try {
      await api<{ deleted: boolean }>(`/api/drive/documents/${encodeURIComponent(selectedId)}`, token, {
        method: "DELETE",
      })
      setDocuments((current) => current.filter((document) => document.id !== selectedId))
      setSelectedId(null)
      setConfirmDelete(false)
      setFeedback({ kind: "success", text: `${name} se eliminó de Drive y del índice del portal.` })
    } catch (cause) {
      setFeedback({
        kind: "error",
        text: cause instanceof Error ? cause.message : "No se pudo eliminar el documento.",
      })
    } finally {
      setIsDeleting(false)
    }
  }

  const filteredDocuments = documents.filter((document) =>
    document.name.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()),
  )
  const selectedDocument = documents.find((document) => document.id === selectedId) ?? null
  const selectedPreview = preview?.id === selectedId ? preview : null
  const selectedPreviewError = previewError?.id === selectedId ? previewError.message : null
  const isPreviewLoading = Boolean(selectedId && !selectedPreview && !selectedPreviewError)

  return (
    <section className="documents-shell">
      <header className="documents-header">
        <div>
          <h1>Documentos de RRHH</h1>
          <p>Administra los archivos que alimentan las respuestas del asistente.</p>
        </div>
        <button className="documents-secondary-button" onClick={synchronizeDrive} disabled={isSyncing}>
          <RefreshCw size={16} className={isSyncing ? "is-spinning" : ""} />
          {isSyncing ? "Sincronizando…" : "Sincronizar"}
        </button>
      </header>

      {feedback && (
        <div className={`documents-feedback ${feedback.kind}`} role={feedback.kind === "error" ? "alert" : "status"}>
          {feedback.text}
        </div>
      )}

      <div className="documents-workspace">
        <section className="document-list-panel" aria-label="Archivos de Drive">
          <div className="document-list-heading">
            <div>
              <h2>Archivos</h2>
              <span>{documents.length} {documents.length === 1 ? "documento" : "documentos"}</span>
            </div>
            <button
              className="icon-button"
              onClick={refreshDocuments}
              disabled={isRefreshing || isLoading}
              aria-label="Actualizar lista"
              title="Actualizar lista"
            >
              <RefreshCw size={16} className={isRefreshing ? "is-spinning" : ""} />
            </button>
          </div>

          <label className="document-search">
            <Search size={16} />
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Buscar documento"
              aria-label="Buscar documento"
            />
          </label>

          <div className="document-list" aria-busy={isLoading}>
            {isLoading ? (
              <div className="document-loading" aria-label="Cargando documentos">
                <i /><i /><i />
              </div>
            ) : filteredDocuments.length > 0 ? (
              filteredDocuments.map((document) => (
                <button
                  key={document.id}
                  className={`document-row${document.id === selectedId ? " selected" : ""}`}
                  onClick={() => {
                    setSelectedId(document.id)
                    setConfirmDelete(false)
                    setFeedback(null)
                  }}
                  aria-current={document.id === selectedId ? "true" : undefined}
                >
                  <span className="document-row-icon"><FileText size={17} /></span>
                  <span className="document-row-copy">
                    <strong>{document.name}</strong>
                    <small>{formatType(document.mimeType, document.name)} · {formatDate(document.modifiedTime)}</small>
                  </span>
                </button>
              ))
            ) : (
              <div className="document-empty">
                <FileText size={20} />
                <strong>{search ? "No hay coincidencias" : "Aún no hay documentos"}</strong>
                <span>{search ? "Prueba con otro nombre." : "Sube un archivo para comenzar."}</span>
              </div>
            )}
          </div>

          <form
            className="document-upload"
            onSubmit={(event) => {
              event.preventDefault()
              void uploadDocument()
            }}
          >
            <input
              ref={fileInput}
              type="file"
              accept={acceptedFormats}
              onChange={(event) => setSelectedFile(event.target.files?.[0] ?? null)}
              aria-label="Seleccionar archivo para subir"
              tabIndex={-1}
            />
            <div className="upload-file-name">
              <Upload size={16} />
              <span>{selectedFile?.name ?? "PDF, DOCX, MD, TXT, CSV, XLS o XLSX"}</span>
            </div>
            <button type="button" className="documents-secondary-button" onClick={() => fileInput.current?.click()}>
              Elegir archivo
            </button>
            {selectedFile && (
              <button type="submit" className="documents-primary-button" disabled={isUploading}>
                {isUploading ? "Subiendo…" : "Subir documento"}
              </button>
            )}
            <small>Máximo 15 MB. El archivo se indexa al terminar la carga.</small>
          </form>
        </section>

        <section className="document-preview-panel" aria-label="Contenido del documento">
          {selectedDocument ? (
            <>
              <header className="document-preview-header">
                <div className="document-preview-title">
                  <span className="document-row-icon"><FileText size={18} /></span>
                  <div>
                    <h2>{selectedDocument.name}</h2>
                    <span>
                      {formatType(selectedDocument.mimeType, selectedDocument.name)}
                      {formatSize(selectedDocument.size) ? ` · ${formatSize(selectedDocument.size)}` : ""}
                      {` · Modificado ${formatDate(selectedDocument.modifiedTime)}`}
                    </span>
                  </div>
                </div>
                <button
                  className="documents-danger-button"
                  onClick={() => setConfirmDelete(true)}
                  disabled={isDeleting}
                >
                  <Trash2 size={16} />Eliminar
                </button>
              </header>

              {confirmDelete && (
                <div className="document-delete-confirm" role="alert">
                  <div>
                    <strong>¿Eliminar este documento?</strong>
                    <span>Se borrará permanentemente de Drive y del índice del portal.</span>
                  </div>
                  <div className="document-confirm-actions">
                    <button className="documents-secondary-button" onClick={() => setConfirmDelete(false)} disabled={isDeleting}>
                      Cancelar
                    </button>
                    <button className="documents-danger-button" onClick={deleteSelectedDocument} disabled={isDeleting}>
                      {isDeleting ? "Eliminando…" : "Eliminar permanentemente"}
                    </button>
                  </div>
                </div>
              )}

              {isPreviewLoading ? (
                <div className="document-preview-loading"><i /><i /><i /></div>
              ) : selectedPreviewError ? (
                <div className="document-preview-message error">{selectedPreviewError}</div>
              ) : (
                <pre className="document-content">{selectedPreview?.content}</pre>
              )}
            </>
          ) : (
            <div className="document-preview-empty">
              <FileText size={25} />
              <strong>Selecciona un documento</strong>
              <span>El contenido aparecerá aquí para que puedas revisarlo antes de administrarlo.</span>
            </div>
          )}
        </section>
      </div>
    </section>
  )
}
