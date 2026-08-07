/**
 * NanoHabitat Sandbox Engine (NHSE) — shared type model.
 *
 * Every persisted structure is content-addressed. A hash is the lowercase hex
 * SHA-256 of the canonical byte representation of the object it names.
 */

export type Hash = string

export type Codec = "gzip" | "raw"

/** A compressed leaf in the Content-Addressable Hierarchical Store. */
export interface BlobRecord {
  hash: Hash
  codec: Codec
  /** Stored (compressed) payload. */
  data: Uint8Array
  /** Length of the original uncompressed payload in bytes. */
  rawSize: number
  /** Length of the stored payload in bytes. */
  storedSize: number
  /** Number of tree entries across all habitats that reference this blob. */
  refs: number
  firstSeen: number
}

/** Flat path -> blob map. Its hash is the Merkle root of the habitat snapshot. */
export interface TreeObject {
  kind: "tree"
  entries: Record<string, Hash>
}

/** Immutable history node. `parent` is null for the root commit. */
export interface CommitObject {
  kind: "commit"
  parent: Hash | null
  tree: Hash
  message: string
  ts: number
  author: string
}

export type NhseObject = TreeObject | CommitObject

export interface ObjectRecord {
  hash: Hash
  kind: NhseObject["kind"]
  /** Canonical JSON of the object; hashing this yields `hash`. */
  json: string
}

export interface HabitatNote {
  id: string
  title: string
  body: string
  updatedAt: number
  /** Deterministic bag-of-tokens embedding used by the intelligence layer. */
  embedding: number[]
}

export interface HabitatRecord {
  id: string
  name: string
  description: string
  createdAt: number
  updatedAt: number
  head: Hash | null
  notes: HabitatNote[]
  /** Entry paths that are registered as runnable live modules. */
  liveModules: string[]
  /** Serialized live-state snapshots produced by the runtime adapters. */
  liveState: LiveStateSnapshot[]
}

export interface LiveStateSnapshot {
  id: string
  entry: string
  ts: number
  durationMs: number
  ok: boolean
  logCount: number
  summary: string
}

export interface FileEntry {
  path: string
  hash: Hash
  rawSize: number
  storedSize: number
  codec: Codec
}

export interface CasStats {
  blobCount: number
  objectCount: number
  /** Sum of rawSize over unique blobs. */
  uniqueRawBytes: number
  /** Sum of storedSize over unique blobs (true physical footprint). */
  physicalBytes: number
  /** Sum of rawSize * refs — the logical size the user perceives. */
  logicalBytes: number
  /** Bytes eliminated purely by content-address deduplication. */
  dedupSavedBytes: number
}

export interface CapacityModel extends CasStats {
  /** r = physicalBytes / logicalBytes (spec: 0.04–0.15 for source-heavy loads). */
  ratio: number
  /** C_eff = S / r for S = physical free storage budget. */
  effectiveCapacityBytes: number
  /** Physical storage budget S used for the projection (bytes). */
  storageBudgetBytes: number
  expansionFactor: number
}

export interface GovernorEvent {
  ts: number
  kind: "materialize" | "hit" | "evict" | "pressure" | "prefetch" | "clear"
  detail: string
}

export interface GovernorStats {
  residentCount: number
  residentBytes: number
  budgetBytes: number
  pressure: number
  hits: number
  misses: number
  evictions: number
  hitRate: number
  events: GovernorEvent[]
}

export interface PredictorStats {
  states: number
  transitions: number
  hits: number
  misses: number
  hitRate: number
}

export interface GraphNode {
  id: string
  label: string
  layer: number
  fanIn: number
  fanOut: number
  bytes: number
}

export interface GraphEdge {
  from: string
  to: string
  /** True when the edge participates in a dependency cycle. */
  cyclic: boolean
}

export interface ArchitectureGraph {
  nodes: GraphNode[]
  edges: GraphEdge[]
  layers: string[][]
  cycles: string[][]
  unresolved: { from: string; specifier: string }[]
}

export interface RunLogLine {
  level: "log" | "info" | "warn" | "error"
  text: string
  ts: number
}

export interface RunResult {
  ok: boolean
  entry: string
  logs: RunLogLine[]
  error: string | null
  durationMs: number
  /** Value the module assigned to `module.exports.result`, if serializable. */
  result: unknown
}

export interface SearchHit {
  habitatId: string
  habitatName: string
  path: string
  score: number
  preview: string
}

export type TestStatus = "pass" | "fail"

export interface TestResult {
  id: string
  category: string
  name: string
  status: TestStatus
  detail: string
  ms: number
}

export interface EngineSnapshotPackage {
  format: "nhse-habitat-snapshot"
  version: 1
  exportedAt: number
  habitat: HabitatRecord
  objects: Record<Hash, string>
  blobs: Record<Hash, { codec: Codec; rawSize: number; b64: string }>
  /** Fold-hash over every object and blob hash in sorted order. */
  chain: Hash
}
