import { describe, it, expect } from 'vitest'
import { parseEnvelope } from './citation-api'

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

function nonJsonResponse(body: string, status = 200): Response {
  return new Response(body, { status })
}

describe('parseEnvelope', () => {
  it('parses a well-formed 200 envelope', async () => {
    const envelope = {
      ok: true,
      route: 'citation',
      status: 'done',
      data: { citations: [{ citation: 'Test citation.' }] },
      error: null,
    }
    const result = await parseEnvelope(jsonResponse(envelope))
    expect(result).toEqual(envelope)
  })

  it('parses a well-formed envelope on a 4xx response (backend legitimately returns envelopes on error status)', async () => {
    const envelope = {
      ok: false,
      route: 'citation',
      status: 'error',
      data: {},
      error: { reason: 'bad input' },
    }
    const result = await parseEnvelope(jsonResponse(envelope, 422))
    expect(result).toEqual(envelope)
  })

  it('rejects a response body that is not valid JSON', async () => {
    await expect(
      parseEnvelope(nonJsonResponse('<html>502 Bad Gateway</html>', 502)),
    ).rejects.toThrow(/无法解析的响应（HTTP 502）/)
  })

  it('rejects valid JSON that is not envelope-shaped (e.g. a proxy error body)', async () => {
    await expect(
      parseEnvelope(jsonResponse({ message: 'Internal Server Error' }, 500)),
    ).rejects.toThrow(/格式不正确的响应（HTTP 500）/)
  })

  it('rejects an envelope with an invalid status value', async () => {
    await expect(
      parseEnvelope(
        jsonResponse({
          ok: true,
          route: 'citation',
          status: 'processing', // not one of the four valid CitationStatus values
          data: {},
          error: null,
        }),
      ),
    ).rejects.toThrow(/格式不正确的响应/)
  })

  it('rejects an envelope missing the data field', async () => {
    await expect(
      parseEnvelope(
        jsonResponse({
          ok: true,
          route: 'citation',
          status: 'done',
          error: null,
        }),
      ),
    ).rejects.toThrow(/格式不正确的响应/)
  })

  it('rejects a JSON array (typeof is "object" but not envelope-shaped)', async () => {
    await expect(parseEnvelope(jsonResponse([1, 2, 3]))).rejects.toThrow(
      /格式不正确的响应/,
    )
  })
})
