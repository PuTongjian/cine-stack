export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly code?: string
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

export async function api<T = any>(
  path: string,
  options?: RequestInit
): Promise<T> {
  const response = await fetch(`/api${path}`, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...options?.headers },
  })
  if (!response.ok) {
    const result = await response.json().catch(() => ({}))
    throw new ApiError(
      result.message || `请求失败 (${response.status})`,
      response.status,
      result.code
    )
  }
  return response.json()
}
