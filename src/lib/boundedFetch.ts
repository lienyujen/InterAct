// Bound classroom reads, but leave uploads and AI requests to their own limits.
export async function boundedFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const url = input instanceof Request ? input.url : String(input)
  if (!url.includes('/rest/v1/')) return fetch(input, init)
  const controller = new AbortController()
  const signal = init?.signal || (input instanceof Request ? input.signal : undefined)
  const abort = () => controller.abort(signal?.reason)
  if (signal?.aborted) abort()
  else signal?.addEventListener('abort', abort, { once: true })
  const timer = setTimeout(() => controller.abort(), 20_000)
  try {
    return await fetch(input, { ...init, signal: controller.signal })
  } finally {
    clearTimeout(timer)
    signal?.removeEventListener('abort', abort)
  }
}
