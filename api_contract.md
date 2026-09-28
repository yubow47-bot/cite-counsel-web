# McGill Citation Tool — API Contract

Frontend-agnostic HTTP API.  Consumed by Next.js web frontend (v0-generated)
and future Chrome Extension.

## Base URL

Dev: `http://localhost:8000`  
Prod: configured at deploy time (HF Spaces / Render / Railway)

## Global conventions

### Response envelope

Every endpoint returns a uniform JSON object:

```json
{
  "ok": true,
  "route": "case_name | citation_number | legislation | constitutional_statutes | concept | journal | bill | select | file | url | chat | by_law | case | treaty | foreign | general_rules",
  "status": "done | needs_selection | unsupported | error",
  "data": {},
  "debug": null | {},
  "error": null | { "reason": "human-readable message" }
}
```

| field | meaning |
|---|---|
| `ok` | `true` for any handled outcome (including unsupported); `false` only for system errors |
| `route` | the classification/processing path the backend chose |
| `status` | `done` = result ready; `needs_selection` = multiple A2AJ candidates shown; `unsupported` = genuinely no McGill path (Hansard etc.); `error` = system/validation failure |
| `data` | endpoint-specific payload |
| `debug` | `null` in production; rich trace in dev (see DEBUG_RESPONSES below) |
| `error` | `null` except when `status="error"`; `reason` is user-facing Chinese text |

### Status → HTTP status code mapping

| status | HTTP | notes |
|---|---|---|
| `done` | 200 | |
| `needs_selection` | 200 | multiple A2AJ candidates shown |
| `unsupported` | 200 | could not be verified, or genuinely no McGill path (Hansard etc.) |
| `error` | 4xx / 5xx | validation or system failure |

### Debug control (IP protection)

**Environment variable `DEBUG_RESPONSES`** (default `false`):

- `false` (production): `debug` is **always `null`** in every response.  Never exposed
  to the client.  Server-side logging still works.
- `true` (local dev): `debug` contains `{route, a2aj_summary, deepseek_prompt,
  deepseek_response, rule_used}`.  The prompt and rules are the McGill rule
  database — core IP — so this is **never** enabled in production.

### CORS

Controlled by `ALLOWED_ORIGINS` (env, comma-separated, default `http://localhost:3000`).

---

## Endpoints

### 1. POST `/api/citation` — Citation query (hero flow)

Search and format a legal citation.

**Request:**
```json
{ "input": "R v Oakes" }
```

**Response** — single result (`status="done"`):
```json
{
  "ok": true,
  "route": "citation_number",
  "status": "done",
  "data": {
    "citations": [
      { "citation": "<格式化的 McGill 引用串>" }
    ]
  },
  "debug": null,
  "error": null
}
```

**Response** — concept (multi-result):
```json
{
  "ok": true,
  "route": "concept",
  "status": "done",
  "data": {
    "citations": [
      { "citation": "...", "source_case": "Haida Nation v British Columbia" },
      { "citation": "...", "source_case": "Criminal Code, RSC 1985, c C-46, s 35" }
    ]
  }
}
```

**Response** — multiple candidates (`status="needs_selection"`):
```json
{
  "ok": true,
  "route": "case_name",
  "status": "needs_selection",
  "data": {
    "candidates": [
      {
        "display": "✅ R v Oakes — [1986] 1 SCR 103",
        "style_of_cause": "R v Oakes",
        "neutral_citation": "[1986] 1 SCR 103",
        "reporter": "(1986) 53 OR (2d) 97",
        "year": "1986",
        "date": "1986-02-28",
        "url": "https://canlii.ca/t/1ft6f",
        "verified": true,
        "candidate_signature": "<server-generated HMAC>"
      }
    ]
  }
}
```

Each candidate carries the full structured fields that `format_citation` needs
(not just the display string) plus a server-generated integrity signature.
Frontend stores the array unchanged and passes it back to
`/api/citation/select`.

**Response** — unsupported:
```json
{
  "ok": true,
  "route": "case_name",
  "status": "unsupported",
  "data": {},
  "error": { "reason": "未找到匹配结果，请尝试其他关键词。" }
}
```

---

### 2. POST `/api/citation/select` — Signed candidate selection

Format a previously-returned candidate. The frontend passes the same candidates
array back, including each `candidate_signature`. The backend verifies the
selected candidate before performing database rechecks or formatting. Missing
or modified signatures return `status="unsupported"` and require a new search.

**Request:**
```json
{
  "candidates": [ /* same array from /api/citation response */ ],
  "selected_index": 0
}
```

**Response:**
```json
{
  "ok": true,
  "route": "select",
  "status": "done",
  "data": {
    "citations": [{ "citation": "<McGill 引用>" }]
  }
}
```

---

### 3. POST `/api/extract/file` — File upload & citation extract

**Request:** `multipart/form-data`, field name `file`.  
Accepted: `.docx`, `.pdf`, `.pptx`, `.xlsx`.  
Max size: `MAX_UPLOAD_MB` (env, default 50 MB).  Exceeding returns
`status="error"`.

**Response:**
```json
{
  "ok": true,
  "route": "file",
  "status": "done",
  "data": {
    "citations": [{ "citation": "<McGill 引用>" }],
    "doc_type": "journal_article | book | report | ..."
  }
}
```

---

### 4. POST `/api/extract/url` — URL / DOI / ISBN citation extract

**Request:**
```json
{ "url": "https://..." }
```
or
```json
{ "doi": "10.1006/bbrc.2001.4705" }
```
or
```json
{ "isbn": "978-0-19-957685-7" }
```
All three fields are optional; at least one must be non-empty.
Priority: doi → isbn → url.

**Response:** same shape as `/api/extract/file` (minus `doc_type`).

---

### 5. POST `/api/chat` — Free-form chat (non-streaming)

**Request:**
```json
{
  "messages": [
    { "role": "user", "content": "Explain the Gladue principle" }
  ]
}
```

**Response:**
```json
{
  "ok": true,
  "route": "chat",
  "status": "done",
  "data": { "reply": "The Gladue principle..." }
}
```

SSE streaming deferred to later iteration.

---

### 6. POST `/api/feedback` — User feedback (up / down)

**Request:**
```json
{
  "input": "R v Oakes",
  "output": "*R v Oakes*, [1986] 1 SCR 103.",
  "route": "citation_number",
  "verdict": "up",
  "note": "optional comment"
}
```

**Response:** `status="done"` with empty `data`.

Payload saved to `data/feedback.jsonl` for later upload to HF Dataset.

---

### 7. GET `/api/health` — Health check

**Response:** `{ "ok": true }`

Used by HF Spaces anti-sleep ping.

---

## Environment variables

| variable | default | description |
|---|---|---|
| `DEBUG_RESPONSES` | `false` | expose debug payload in responses (dev only) |
| `MAX_UPLOAD_MB` | `50` | max uploaded file size |
| `ALLOWED_ORIGINS` | `http://localhost:3000` | CORS allowed origins, comma-separated |
| `RATE_LIMIT_PER_MIN` | `30` | max requests/IP/minute |
| `RATE_LIMIT_PER_HOUR` | `200` | max requests/IP/hour |
| `CANDIDATE_SIGNING_KEY` | random per process | HMAC key for candidate integrity; set the same secret on every worker/replica and preserve it across restarts |
| `DEEPSEEK_DAILY_LIMIT` | `500` | max DeepSeek API calls/day |
| `DEEPSEEK_API_KEY` | — | DeepSeek API key (already in `.env`) |
| `LLM_DEFAULT_MODEL` | `deepseek-v4-flash` (DeepSeek direct) / `qwen/qwen3.7-flash` (custom endpoint) | default model for classification/formatting |
| `LLM_CONCEPT_MODEL` | `deepseek-v4-pro` (DeepSeek direct) / `LLM_DEFAULT_MODEL` (custom endpoint) | model for concept expansion |

## Backend internals (not exposed)

- Model routing (flash default, pro for `expand_concept`) is an implementation
  detail of `deepseek_api.py` via env variables.  API does not expose model
  selection.
- No server-side selection session is used. Selection remains stateless via the
  frontend-passed `candidates` array, whose integrity is protected by HMAC.

## Deployment notes

- **Frontend**: Next.js → Vercel (free tier)
- **Backend**: FastAPI → HF Spaces / Render / Railway
- Latency across Pacific (A2AJ in Canada, DeepSeek in China) — measure after
  deployment with real traffic, don't trust dev-machine numbers.
