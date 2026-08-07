/**
 * Intelligence layer — predictive materialization.
 *
 * The device-side model is a first-order Markov chain over file-access
 * transitions plus a dependency-graph prior. It is trained online, costs O(1)
 * per access, and is fully deterministic — which makes prefetch accuracy
 * measurable and testable. This is the App-Store-legal, dependency-free
 * stand-in for the Core ML ranking model described in the specification; the
 * interface (`record`, `predict`, `stats`) is what a Core ML backend would
 * implement, so swapping it does not change any caller.
 */

import { STORE, type Storage } from "./storage"
import type { PredictorStats } from "./types"

interface PredictorState {
  transitions: Record<string, Record<string, number>>
  totals: Record<string, number>
  hits: number
  misses: number
}

function emptyState(): PredictorState {
  return { transitions: {}, totals: {}, hits: 0, misses: 0 }
}

export class AccessPredictor {
  private state: PredictorState = emptyState()
  private previous: string | null = null
  private lastPrediction: string[] = []
  private dirty = false

  constructor(
    private readonly storage: Storage,
    private readonly habitatId: string,
  ) {}

  async load(): Promise<void> {
    const saved = await this.storage.get<PredictorState>(STORE.predictor, this.habitatId)
    this.state = saved
      ? {
          transitions: saved.transitions ?? {},
          totals: saved.totals ?? {},
          hits: saved.hits ?? 0,
          misses: saved.misses ?? 0,
        }
      : emptyState()
  }

  async flush(): Promise<void> {
    if (!this.dirty) return
    await this.storage.put(STORE.predictor, this.habitatId, this.state)
    this.dirty = false
  }

  /** Record an access and score the previous prediction. */
  record(path: string): void {
    if (this.lastPrediction.length > 0) {
      if (this.lastPrediction.includes(path)) this.state.hits += 1
      else this.state.misses += 1
    }
    if (this.previous && this.previous !== path) {
      const row = (this.state.transitions[this.previous] ??= {})
      row[path] = (row[path] ?? 0) + 1
      this.state.totals[this.previous] = (this.state.totals[this.previous] ?? 0) + 1
    }
    this.previous = path
    this.dirty = true
  }

  /**
   * Rank the next-k likely accesses. Markov evidence dominates; the dependency
   * prior breaks ties and covers cold states with no transition history.
   */
  predict(current: string, dependencyPrior: string[] = [], k = 3): string[] {
    const scores = new Map<string, number>()
    const row = this.state.transitions[current]
    const total = this.state.totals[current] ?? 0
    if (row && total > 0) {
      for (const [next, count] of Object.entries(row)) {
        scores.set(next, count / total)
      }
    }
    dependencyPrior.forEach((path, index) => {
      if (path === current) return
      const prior = 0.25 / (index + 1)
      scores.set(path, (scores.get(path) ?? 0) + prior)
    })
    const ranked = Array.from(scores.entries())
      .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))
      .slice(0, k)
      .map(([path]) => path)
    this.lastPrediction = ranked
    return ranked
  }

  stats(): PredictorStats {
    const states = Object.keys(this.state.transitions).length
    let transitions = 0
    for (const row of Object.values(this.state.transitions)) {
      transitions += Object.keys(row).length
    }
    const total = this.state.hits + this.state.misses
    return {
      states,
      transitions,
      hits: this.state.hits,
      misses: this.state.misses,
      hitRate: total === 0 ? 0 : this.state.hits / total,
    }
  }

  reset(): void {
    this.state = emptyState()
    this.previous = null
    this.lastPrediction = []
    this.dirty = true
  }
}

/** Deterministic 32-dimension token embedding for semantic note search. */
export function embedText(text: string, dimensions = 32): number[] {
  const vector = new Array<number>(dimensions).fill(0)
  const tokens = text.toLowerCase().match(/[a-z0-9_]+/g) ?? []
  for (const token of tokens) {
    let hash = 2166136261
    for (let i = 0; i < token.length; i++) {
      hash ^= token.charCodeAt(i)
      hash = Math.imul(hash, 16777619)
    }
    const index = Math.abs(hash) % dimensions
    vector[index] += 1
  }
  const norm = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0))
  if (norm === 0) return vector
  return vector.map((value) => value / norm)
}

export function cosineSimilarity(a: number[], b: number[]): number {
  const length = Math.min(a.length, b.length)
  let dot = 0
  for (let i = 0; i < length; i++) dot += a[i] * b[i]
  return dot
}
