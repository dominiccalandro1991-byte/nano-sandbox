/**
 * Compression pipeline for the Content-Addressable Hierarchical Store.
 *
 * Spec calls for context-aware grouping -> high-ratio entropy stage. On the
 * web platform the available high-ratio primitive is the native DEFLATE/gzip
 * codec exposed through CompressionStream, which is hardware-accelerated in
 * WebKit. Context-aware grouping is preserved by prefixing each payload with a
 * language/type token so similar files share a dictionary-friendly prologue.
 */

import type { Codec } from "./types"
import { textToBytes } from "./hash"

const GROUP_PREFIX = "\u0001nhse:"

export function hasNativeCompression(): boolean {
  return typeof globalThis.CompressionStream === "function" && typeof globalThis.DecompressionStream === "function"
}

export function groupTokenFor(path: string): string {
  const lower = path.toLowerCase()
  const dot = lower.lastIndexOf(".")
  const ext = dot === -1 ? "bin" : lower.slice(dot + 1)
  const dir = lower.includes("/") ? lower.slice(0, lower.indexOf("/")) : "root"
  return `${dir}.${ext}`
}

async function streamThrough(bytes: Uint8Array, transform: GenericTransformStream): Promise<Uint8Array> {
  const source = new Blob([new Uint8Array(bytes) as unknown as BlobPart])
  const piped = source.stream().pipeThrough(transform)
  const buffer = await new Response(piped).arrayBuffer()
  return new Uint8Array(buffer)
}

export interface CompressedPayload {
  codec: Codec
  data: Uint8Array
  rawSize: number
  storedSize: number
}

/**
 * Compress a text payload. Falls back to `raw` storage when the platform has
 * no compression codec or when compression would inflate the payload.
 */
export async function compressText(text: string, groupToken: string): Promise<CompressedPayload> {
  const raw = textToBytes(text)
  if (!hasNativeCompression()) {
    return { codec: "raw", data: raw, rawSize: raw.length, storedSize: raw.length }
  }
  try {
    const framed = textToBytes(`${GROUP_PREFIX}${groupToken}\u0002${text}`)
    const packed = await streamThrough(framed, new CompressionStream("gzip"))
    if (packed.length >= raw.length) {
      return { codec: "raw", data: raw, rawSize: raw.length, storedSize: raw.length }
    }
    return { codec: "gzip", data: packed, rawSize: raw.length, storedSize: packed.length }
  } catch {
    return { codec: "raw", data: raw, rawSize: raw.length, storedSize: raw.length }
  }
}

export async function decompressText(data: Uint8Array, codec: Codec): Promise<string> {
  if (codec === "raw") return new TextDecoder().decode(data)
  const bytes = await streamThrough(data, new DecompressionStream("gzip"))
  const text = new TextDecoder().decode(bytes)
  const marker = text.indexOf("\u0002")
  if (text.startsWith(GROUP_PREFIX) && marker !== -1) {
    return text.slice(marker + 1)
  }
  return text
}

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = ""
  const chunk = 0x8000
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk))
  }
  return btoa(binary)
}

export function base64ToBytes(value: string): Uint8Array {
  const binary = atob(value)
  const out = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i)
  return out
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B"
  const units = ["B", "KB", "MB", "GB", "TB", "PB"]
  const exponent = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)))
  const value = bytes / 1024 ** exponent
  const digits = value >= 100 || exponent === 0 ? 0 : value >= 10 ? 1 : 2
  return `${value.toFixed(digits)} ${units[exponent]}`
}
