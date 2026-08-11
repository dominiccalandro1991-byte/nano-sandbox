/**
 * Client for the OPTIONAL remote validation engine (backend/).
 *
 * NHSE is fully self-contained without this: if no URL is configured, every
 * function here either short-circuits or the caller simply never invokes
 * them. This module owns exactly one piece of persistent state -- the
 * configured remote engine URL -- kept in localStorage (a plain string
 * preference, not engine data, so it doesn't belong in the content-addressed
 * IndexedDB store that `storage.ts` owns).
 *
 * Every network call has an explicit timeout and never throws for expected
 * failure modes (engine unset, unreachable, non-2xx) -- callers get a typed
 * result and decide what to show, matching the rest of NHSE's "errors are
 * state, not exceptions" convention.
 */

const STORAGE_KEY = "nhse.remoteEngineUrl"
const DEFAULT_TIMEOUT_MS = 8_000

export type RemoteJobStatus = "queued" | "running" | "passed" | "failed" | "error" | "timeout"

export interface RemoteValidationReport {
  passed: boolean
  score: number | null
  metrics: Record<string, number>
  findings: string[]
  error: string | null
  details: Record<string, unknown>
}

export interface RemoteJob {
  id: string
  validator_id: string
  label: string | null
  status: RemoteJobStatus
  submitted_at: number
  finished_at: number | null
  duration_seconds: number | null
  report: RemoteValidationReport | null
  error: string | null
}

export interface RemoteValidatorInfo {
  id: string
  description: string
  payload_schema: Record<string, unknown>
}

export type RemoteResult<T> = { ok: true; data: T } | { ok: false; error: string }

export function getRemoteEngineUrl(): string | null {
  if (typeof window === "undefined") return null
  const raw = window.localStorage.getItem(STORAGE_KEY)
  return raw && raw.trim().length > 0 ? raw.trim() : null
}

export function setRemoteEngineUrl(url: string | null): void {
  if (typeof window === "undefined") return
  if (!url || url.trim().length === 0) {
    window.localStorage.removeItem(STORAGE_KEY)
    return
  }
  window.localStorage.setItem(STORAGE_KEY, url.trim().replace(/\/+$/, ""))
}

async function requestJson<T>(
  url: string,
  init: RequestInit = {},
  timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<RemoteResult<T>> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetch(url, { ...init, signal: controller.signal })
    if (!response.ok) {
      let detail = response.statusText
      try {
        const body = await response.json()
        if (body?.detail) detail = String(body.detail)
      } catch {
        // response body wasn't JSON -- keep statusText
      }
      return { ok: false, error: `${response.status} ${detail}` }
    }
    const data = (await response.json()) as T
    return { ok: true, data }
  } catch (cause) {
    if (cause instanceof DOMException && cause.name === "AbortError") {
      return { ok: false, error: `Timed out after ${timeoutMs}ms` }
    }
    return { ok: false, error: cause instanceof Error ? cause.message : String(cause) }
  } finally {
    clearTimeout(timer)
  }
}

export async function checkRemoteHealth(
  baseUrl: string,
): Promise<RemoteResult<{ status: string; service: string; version: string }>> {
  return requestJson(`${baseUrl}/health`, {}, 4_000)
}

export async function listRemoteValidators(baseUrl: string): Promise<RemoteResult<RemoteValidatorInfo[]>> {
  return requestJson(`${baseUrl}/validators`)
}

export async function submitRemoteJob(
  baseUrl: string,
  args: { validatorId: string; payload: Record<string, unknown>; seed?: number | null; label?: string | null },
): Promise<RemoteResult<RemoteJob>> {
  return requestJson(
    `${baseUrl}/jobs`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        validator_id: args.validatorId,
        payload: args.payload,
        seed: args.seed ?? null,
        label: args.label ?? null,
      }),
    },
    // Submission blocks on the sandboxed run server-side, so give this one
    // more headroom than the default -- see NANO_SANDBOX_JOB_TIMEOUT_SECONDS.
    20_000,
  )
}

export async function listRemoteJobs(baseUrl: string, limit = 20): Promise<RemoteResult<RemoteJob[]>> {
  return requestJson(`${baseUrl}/jobs?limit=${limit}`)
}
