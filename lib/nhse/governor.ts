/**
 * Jetsam-aware working-set governor.
 *
 * Every materialization request is gated by a live pressure signal. When
 * pressure crosses the high-water mark the governor proactively releases the
 * least-recently-used resident pages back to the compressed CAS *before* the
 * platform memory killer can act. On iOS/WebKit the analogous signals are
 * page-visibility transitions (backgrounding is the highest-risk window) and,
 * where exposed, `performance.memory` heap accounting.
 *
 * Complexity: materialize O(1) amortized; eviction O(k log k) for k residents
 * sorted by recency, bounded by the resident count, never by store size.
 */

import type { GovernorEvent, GovernorStats, Hash } from "./types"

interface ResidentPage {
  hash: Hash
  text: string
  bytes: number
  lastUsed: number
  uses: number
  tag: string
}

export interface GovernorOptions {
  /** Resident byte budget. Scaled analogue of the 1.5 GB device working set. */
  budgetBytes?: number
  /** Pressure at which proactive compression begins. */
  highWaterMark?: number
  /** Fraction of budget to fall back to after an eviction sweep. */
  reliefTarget?: number
}

const MAX_EVENTS = 60

export class WorkingSetGovernor {
  private readonly pages = new Map<Hash, ResidentPage>()
  private readonly events: GovernorEvent[] = []
  private residentBytes = 0
  private hits = 0
  private misses = 0
  private evictions = 0
  private clock = 0
  private externalPressure = 0
  private detach: (() => void) | null = null

  readonly budgetBytes: number
  readonly highWaterMark: number
  readonly reliefTarget: number

  constructor(options: GovernorOptions = {}) {
    this.budgetBytes = Math.max(64 * 1024, options.budgetBytes ?? 6 * 1024 * 1024)
    this.highWaterMark = options.highWaterMark ?? 0.85
    this.reliefTarget = options.reliefTarget ?? 0.6
  }

  /** Attach platform pressure signals. Safe to call in any environment. */
  arm(): void {
    if (this.detach || typeof document === "undefined") return
    const onVisibility = () => {
      if (document.visibilityState === "hidden") {
        this.log("pressure", "backgrounded — proactive compression of LRU pages")
        this.evictTo(this.budgetBytes * 0.25)
      }
    }
    const sample = () => {
      const perf = performance as Performance & {
        memory?: { usedJSHeapSize: number; jsHeapSizeLimit: number }
      }
      const memory = perf.memory
      if (memory && memory.jsHeapSizeLimit > 0) {
        const next = Math.min(1, memory.usedJSHeapSize / memory.jsHeapSizeLimit)
        if (Math.abs(next - this.externalPressure) > 0.05) {
          this.externalPressure = next
          if (next > this.highWaterMark) {
            this.log("pressure", `heap pressure ${(next * 100).toFixed(0)}% — relieving working set`)
            this.evictTo(this.budgetBytes * this.reliefTarget)
          }
        }
      }
    }
    document.addEventListener("visibilitychange", onVisibility)
    const timer = window.setInterval(sample, 4000)
    this.detach = () => {
      document.removeEventListener("visibilitychange", onVisibility)
      window.clearInterval(timer)
    }
  }

  dispose(): void {
    this.detach?.()
    this.detach = null
  }

  /** Resident-set pressure in [0, 1], combining local and platform signals. */
  get pressure(): number {
    const local = this.residentBytes / this.budgetBytes
    return Math.min(1, Math.max(local, this.externalPressure))
  }

  peek(hash: Hash): string | undefined {
    const page = this.pages.get(hash)
    if (!page) return undefined
    page.lastUsed = ++this.clock
    page.uses += 1
    return page.text
  }

  /**
   * Materialize a page. Cache hits never touch storage. Misses load through
   * `loader`, admit the page, then run the pressure gate.
   */
  async materialize(hash: Hash, tag: string, loader: (hash: Hash) => Promise<string>): Promise<string> {
    const resident = this.pages.get(hash)
    if (resident) {
      resident.lastUsed = ++this.clock
      resident.uses += 1
      this.hits += 1
      this.log("hit", `${tag} resident (${resident.uses} uses)`)
      return resident.text
    }
    this.misses += 1
    const text = await loader(hash)
    this.admit(hash, text, tag)
    this.log("materialize", `${tag} decompressed into working set`)
    return text
  }

  /** Speculative admission driven by the predictor. Never counted as a hit. */
  async prefetch(hash: Hash, tag: string, loader: (hash: Hash) => Promise<string>): Promise<void> {
    if (this.pages.has(hash)) return
    if (this.pressure > this.highWaterMark) return
    try {
      const text = await loader(hash)
      this.admit(hash, text, tag)
      this.log("prefetch", `${tag} speculatively materialized`)
    } catch {
      // A failed speculative load must never surface to the caller.
    }
  }

  private admit(hash: Hash, text: string, tag: string): void {
    const bytes = text.length
    const existing = this.pages.get(hash)
    if (existing) this.residentBytes -= existing.bytes
    this.pages.set(hash, { hash, text, bytes, lastUsed: ++this.clock, uses: 1, tag })
    this.residentBytes += bytes
    if (this.pressure > this.highWaterMark) {
      this.evictTo(this.budgetBytes * this.reliefTarget)
    }
  }

  /** Release pages, LRU first, until resident bytes fall under `target`. */
  evictTo(target: number): number {
    if (this.residentBytes <= target) return 0
    const ordered = Array.from(this.pages.values()).sort((a, b) => a.lastUsed - b.lastUsed)
    let released = 0
    for (const page of ordered) {
      if (this.residentBytes <= target) break
      this.pages.delete(page.hash)
      this.residentBytes -= page.bytes
      this.evictions += 1
      released += 1
    }
    if (released > 0) this.log("evict", `${released} page(s) returned to compressed CAS`)
    return released
  }

  invalidate(hash: Hash): void {
    const page = this.pages.get(hash)
    if (!page) return
    this.pages.delete(hash)
    this.residentBytes -= page.bytes
  }

  clear(): void {
    this.pages.clear()
    this.residentBytes = 0
    this.log("clear", "working set fully compressed")
  }

  private log(kind: GovernorEvent["kind"], detail: string): void {
    this.events.unshift({ ts: Date.now(), kind, detail })
    if (this.events.length > MAX_EVENTS) this.events.length = MAX_EVENTS
  }

  stats(): GovernorStats {
    const total = this.hits + this.misses
    return {
      residentCount: this.pages.size,
      residentBytes: this.residentBytes,
      budgetBytes: this.budgetBytes,
      pressure: this.pressure,
      hits: this.hits,
      misses: this.misses,
      evictions: this.evictions,
      hitRate: total === 0 ? 0 : this.hits / total,
      events: [...this.events],
    }
  }
}
