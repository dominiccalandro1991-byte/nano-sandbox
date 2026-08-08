// lib/nhse/validation.ts

export function clampNumber(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min
  return Math.min(max, Math.max(min, value))
}

export function sanitizeString(input: unknown): string {
  if (input == null) return ""
  return String(input)
}

const SAFE_URL_PROTOCOLS = ["http:", "https:"]

export function sanitizeUrl(raw: unknown): string | null {
  try {
    if (raw == null) return null
    const s = String(raw).trim()
    if (s === "") return null
    // If it looks like a URL, parse it and allow only safe protocols.
    if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(s)) {
      try {
        const u = new URL(s, "https://example.invalid")
        if (!SAFE_URL_PROTOCOLS.includes(u.protocol)) return null
        return u.toString()
      } catch {
        return null
      }
    }
    // Otherwise just return a trimmed string (not clickable).
    return s
  } catch {
    return null
  }
}
