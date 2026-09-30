import { describe, it, expect, vi, afterEach } from 'vitest'
import { GatewayError, parseEnvelope, postCitation } from './citation-api'

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

  it('throws a GatewayError on a 502 gateway page that is not valid JSON', async () => {
    await expect(
      parseEnvelope(nonJsonResponse('<html>502 Bad Gateway</html>', 502)),
    ).rejects.toBeInstanceOf(GatewayError)
  })

  it('rejects a response body that is not valid JSON on a non-gateway status', async () => {
    await expect(
      parseEnvelope(nonJsonResponse('<html>not found</html>', 404)),
    ).rejects.toThrow(/无法解析的响应（HTTP 404）/)
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

  it('throws a GatewayError with a friendly message on a 503 gateway page', async () => {
    const err = await parseEnvelope(
      nonJsonResponse('<html>Service Unavailable</html>', 503),
    ).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(GatewayError)
    expect((err as Error).message).toMatch(/waking up|temporarily unavailable/)
  })
})

describe('request() cold-start retry', () => {
  const envelope = {
    ok: true,
    route: 'citation',
    status: 'done',
    data: { citations: [{ citation: 'Test citation.' }] },
    error: null,
  }

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('retries once after a 502 gateway page and succeeds', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(nonJsonResponse('<html>502</html>', 502))
      .mockResolvedValueOnce(jsonResponse(envelope))
    vi.stubGlobal('fetch', fetchMock)

    await expect(postCitation('r v gladue')).resolves.toEqual(envelope)
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('retries once when fetch rejects with a network error', async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValueOnce(jsonResponse(envelope))
    vi.stubGlobal('fetch', fetchMock)

    await expect(postCitation('r v gladue')).resolves.toEqual(envelope)
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('does not retry an envelope-shaped response (even 4xx/5xx)', async () => {
    const errorEnvelope = {
      ok: false,
      route: 'citation',
      status: 'error',
      data: {},
      error: { reason: 'Daily service capacity reached.' },
    }
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse(errorEnvelope, 503))
    vi.stubGlobal('fetch', fetchMock)

    // A real envelope — even on 503 — is a backend verdict, not a gateway page
    await expect(postCitation('r v gladue')).resolves.toEqual(errorEnvelope)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('gives up after one retry when the gateway keeps failing', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(nonJsonResponse('<html>502</html>', 502))
    vi.stubGlobal('fetch', fetchMock)

    await expect(postCitation('r v gladue')).rejects.toBeInstanceOf(GatewayError)
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })
})
