export async function api<T>(path: string, token?: string, options?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options?.headers,
    },
  })
  const data = await response.json()
  if (!response.ok) throw new Error(data.error ?? "Ocurrió un error")
  return data as T
}
