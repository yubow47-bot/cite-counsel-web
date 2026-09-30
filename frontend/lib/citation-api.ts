// API 客户端与类型定义
// base URL 先用 localhost:8000，后续可用 NEXT_PUBLIC_API_BASE_URL 覆盖为生产地址
export const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8000"

export type CitationStatus =
  | "done"
  | "needs_selection"
  | "unsupported"
  | "error"

export interface Citation {
  citation: string
  source_case?: string
  /** false 表示由用户手动填写、未经数据库核验 */
  verified?: boolean
  /** 后端透传的来源类型，用于前端 placeholder 选择 */
  source_type?: string
  /** 结构化 pinpoint（如 "s 718.2(e)"），由后端 _verify_legislation 填入 */
  pinpoint?: string
}

export interface Candidate {
  display: string
  [key: string]: unknown
}

export interface CitationData {
  citations?: Citation[]
  candidates?: Candidate[]
  reason?: string
}

export interface Envelope {
  ok: boolean
  route: string
  status: CitationStatus
  data: CitationData
  error: null | { reason: string }
}

const CITATION_STATUSES: readonly CitationStatus[] = [
  "done",
  "needs_selection",
  "unsupported",
  "error",
]

function isEnvelopeShape(json: unknown): json is Envelope {
  if (typeof json !== "object" || json === null) return false
  const obj = json as Record<string, unknown>
  return (
    typeof obj.ok === "boolean" &&
    typeof obj.status === "string" &&
    (CITATION_STATUSES as string[]).includes(obj.status) &&
    typeof obj.data === "object" &&
    obj.data !== null
  )
}

/**
 * Statuses returned by the reverse proxy in front of the backend (Hugging
 * Face Spaces) while the container is asleep or booting — never an envelope.
 */
const GATEWAY_STATUSES: ReadonlySet<number> = new Set([502, 503, 504])

/** The backend could not be reached through its proxy (cold start / outage). */
export class GatewayError extends Error {
  readonly status: number
  constructor(status: number) {
    super(
      "The citation service is waking up or temporarily unavailable. " +
        "Please try again in a few seconds.",
    )
    this.name = "GatewayError"
    this.status = status
  }
}

/**
 * Parse a fetch Response into an Envelope, validating its shape rather than
 * blindly trusting `json as Envelope`. Deliberately does NOT branch on
 * `res.ok` — the backend legitimately returns envelopes on 4xx/5xx (see
 * callers), so a non-2xx status alone must not be treated as failure here.
 * What it does reject is JSON that parses but isn't envelope-shaped, e.g. a
 * gateway timeout page or proxy error body that happens to be valid JSON.
 */
export async function parseEnvelope(res: Response): Promise<Envelope> {
  let json: unknown
  try {
    json = await res.json()
  } catch {
    if (GATEWAY_STATUSES.has(res.status)) throw new GatewayError(res.status)
    throw new Error(`服务器返回了无法解析的响应（HTTP ${res.status}）`)
  }

  if (!isEnvelopeShape(json)) {
    if (GATEWAY_STATUSES.has(res.status)) throw new GatewayError(res.status)
    throw new Error(`服务器返回了格式不正确的响应（HTTP ${res.status}）`)
  }

  return json
}

/** POST /api/citation —— 提交原始引用文本 */
export async function postCitation(input: string): Promise<Envelope> {
  return request("/api/citation", { input })
}

/** POST /api/citation/select —— 在 needs_selection 后提交用户选择 */
export async function postCitationSelect(
  candidates: Candidate[],
  selectedIndex: number,
): Promise<Envelope> {
  return request("/api/citation/select", {
    candidates,
    selected_index: selectedIndex,
  })
}

/** POST /api/extract/file —— 上传文件（multipart，字段名 file）提取引用 */
export async function postExtractFile(file: File): Promise<Envelope> {
  const form = new FormData()
  form.append("file", file)

  const res = await fetch(`${API_BASE_URL}/api/extract/file`, {
    method: "POST",
    body: form,
  })

  return parseEnvelope(res)
}

/** POST /api/extract/url —— 提交 URL / DOI / ISBN 提取引用 */
export async function postExtractUrl(args: {
  url?: string
  doi?: string
  isbn?: string
}): Promise<Envelope> {
  return request("/api/extract/url", args)
}

/** POST /api/feedback —— 对单条引用结果反馈（字段契约见 api/main.py 的 FeedbackInput） */
export async function postFeedback(payload: {
  verdict: "up" | "down"
  input?: string
  output?: string
}): Promise<void> {
  try {
    await fetch(`${API_BASE_URL}/api/feedback`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    })
  } catch {
    // 反馈失败不阻塞主流程，静默处理
  }
}

/** POST /api/feedback —— 提交自由反馈消息 (kind=message) */
export async function postFeedbackMessage(note: string): Promise<void> {
  try {
    await fetch(`${API_BASE_URL}/api/feedback`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ kind: "message", note }),
    })
  } catch {
    // 反馈失败不阻塞主流程，静默处理
  }
}

async function requestOnce(path: string, body: unknown): Promise<Envelope> {
  const res = await fetch(`${API_BASE_URL}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })

  // 即使是 4xx/5xx，后端也可能返回信封结构；parseEnvelope 不会因状态码拒绝
  return parseEnvelope(res)
}

async function request(path: string, body: unknown): Promise<Envelope> {
  try {
    return await requestOnce(path, body)
  } catch (err) {
    // One automatic retry for the cold-start window: a sleeping Space fails
    // the first attempt (gateway 502/503/504 page, or the network error the
    // browser raises while the proxy holds the connection) while the backend
    // boots; the retry lands on the now-warm service.  An envelope-shaped
    // answer — even 4xx/5xx — is a real backend verdict and is NOT retried.
    const retriable = err instanceof GatewayError || err instanceof TypeError
    if (!retriable) throw err
    return await requestOnce(path, body)
  }
}
