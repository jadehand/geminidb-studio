export class RequestBodyError extends Error {
  constructor(status, code, message) {
    super(message)
    this.status = status
    this.code = code
  }
}

export async function readJsonBody(request, maxBytes = 1_048_576) {
  let size = 0
  const chunks = []
  for await (const chunk of request) {
    size += chunk.length
    if (size > maxBytes) {
      request.destroy?.()
      throw new RequestBodyError(413, 'REQUEST_BODY_TOO_LARGE', 'Request body exceeds 1 MiB')
    }
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
  }
  if (!chunks.length) return {}
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'))
  } catch {
    throw new RequestBodyError(400, 'INVALID_JSON', 'Request JSON is invalid')
  }
}
