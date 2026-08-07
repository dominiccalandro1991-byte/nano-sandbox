/** Presentation helpers. Pure, deterministic, no locale surprises. */

const UNITS = ["B", "KB", "MB", "GB", "TB", "PB"]

export function formatBytes(bytes: number, digits = 1): string {
  if (!Number.isFinite(bytes)) return "—"
  if (bytes < 1024) return `${Math.round(bytes)} B`
  let value = bytes
  let unit = 0
  while (value >= 1024 && unit < UNITS.length - 1) {
    value /= 1024
    unit += 1
  }
  return `${value.toFixed(digits)} ${UNITS[unit]}`
}

export function formatPercent(ratio: number, digits = 0): string {
  if (!Number.isFinite(ratio)) return "—"
  return `${(ratio * 100).toFixed(digits)}%`
}

export function formatMs(ms: number): string {
  if (ms < 1) return "<1 ms"
  if (ms < 1000) return `${Math.round(ms)} ms`
  return `${(ms / 1000).toFixed(2)} s`
}

export function shortHash(hash: string | null | undefined, length = 8): string {
  if (!hash) return "—"
  return hash.slice(0, length)
}

export function formatWhen(ts: number): string {
  const delta = Date.now() - ts
  if (delta < 60_000) return "just now"
  if (delta < 3_600_000) return `${Math.floor(delta / 60_000)}m ago`
  if (delta < 86_400_000) return `${Math.floor(delta / 3_600_000)}h ago`
  return `${Math.floor(delta / 86_400_000)}d ago`
}

export function formatCount(n: number): string {
  return n.toLocaleString("en-US")
}
