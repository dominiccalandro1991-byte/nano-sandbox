/**
 * NanoHabitat Sandbox Engine — orchestration layer.
 *
 * Ports and adapters:
 *   Storage        (port)  -> IndexedDB | in-memory adapter
 *   ContentStore   (core)  -> CAHS: dedup, compression, Merkle DAG
 *   Governor       (core)  -> Jetsam-aware working-set policy
 *   AccessPredictor(core)  -> predictive materialization
 *   Runtime        (adapter) -> Worker interpreter for live modules
 *   Snapshot       (adapter) -> sealed habitat export/import
 *
 * The engine never performs I/O outside its own container store.
 */

import { ContentStore } from "./cas"
import { WorkingSetGovernor } from "./governor"
import { AccessPredictor, cosineSimilarity, embedText } from "./predictor"
import { buildArchitectureGraph } from "./graph"
import { runLiveModule } from "./runtime"
import { adoptSnapshot, buildSnapshot, parseSnapshot, serializeSnapshot } from "./snapshot"
import { STORE, createMemoryStorage, createStorage, type Storage } from "./storage"
import { SEED_HABITATS } from "./seed"
import { sha256Hex } from "./hash"
import type {
  ArchitectureGraph,
  CapacityModel,
  CommitObject,
  FileEntry,
  GovernorStats,
  Hash,
  HabitatNote,
  HabitatRecord,
  PredictorStats,
  RunResult,
  SearchHit,
  TreeObject,
} from "./types"

const AUTHOR = "local-device"
const DEFAULT_STORAGE_BUDGET = 1_000_000_000_000 // 1 TB device class.

export interface HistoryEntry {
  hash: Hash
  commit: CommitObject
  added: string[]
  modified: string[]
  removed: string[]
}

export class NanoHabitatEngine {
  readonly cas: ContentStore
  readonly governor: WorkingSetGovernor
  private readonly predictors = new Map<string, AccessPredictor>()
  private readonly graphCache = new Map<string, { key: string; graph: ArchitectureGraph }>()
  private readonly listeners = new Set<() => void>()
  private storageBudget = DEFAULT_STORAGE_BUDGET

  private constructor(readonly storage: Storage) {
    this.cas = new ContentStore(storage)
    this.governor = new WorkingSetGovernor({ budgetBytes: 6 * 1024 * 1024 })
  }

  static async create(): Promise<NanoHabitatEngine> {
    const storage = await createStorage()
    const engine = new NanoHabitatEngine(storage)
    await engine.bootstrap()
    return engine
  }

  /**
   * Container-isolated engine backed purely by memory. Used by the verification
   * suite so tests can never mutate the user's persistent habitats.
   */
  static async createEphemeral(options: { seed?: boolean } = {}): Promise<NanoHabitatEngine> {
    const engine = new NanoHabitatEngine(createMemoryStorage())
    engine.governor.arm()
    if (options.seed !== false) await engine.seed()
    return engine
  }

  get backend(): string {
    return this.storage.backend
  }

  // ---------------------------------------------------------------- lifecycle

  private async bootstrap(): Promise<void> {
    this.governor.arm()
    await this.probeStorageBudget()
    const habitats = await this.listHabitats()
    if (habitats.length === 0) await this.seed()
  }

  private async probeStorageBudget(): Promise<void> {
    try {
      if (typeof navigator !== "undefined" && navigator.storage?.estimate) {
        const estimate = await navigator.storage.estimate()
        if (estimate.quota && estimate.quota > 0) this.storageBudget = estimate.quota
      }
    } catch {
      this.storageBudget = DEFAULT_STORAGE_BUDGET
    }
  }

  private async seed(): Promise<void> {
    for (const seed of SEED_HABITATS) {
      const habitat: HabitatRecord = {
        id: seed.id,
        name: seed.name,
        description: seed.description,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        head: null,
        notes: seed.notes.map((note, index) => ({
          id: `${seed.id}-note-${index}`,
          title: note.title,
          body: note.body,
          updatedAt: Date.now(),
          embedding: embedText(`${note.title} ${note.body}`),
        })),
        liveModules: seed.liveModules,
        liveState: [],
      }
      await this.storage.put(STORE.habitats, habitat.id, habitat)
      await this.commitFiles(habitat.id, seed.files, "seed habitat")
    }
    this.emit()
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  private emit(): void {
    for (const listener of this.listeners) listener()
  }

  dispose(): void {
    this.governor.dispose()
    this.listeners.clear()
  }

  // ---------------------------------------------------------------- habitats

  async listHabitats(): Promise<HabitatRecord[]> {
    const habitats = await this.storage.getAll<HabitatRecord>(STORE.habitats)
    return habitats.sort((a, b) => b.updatedAt - a.updatedAt)
  }

  async getHabitat(id: string): Promise<HabitatRecord> {
    const habitat = await this.storage.get<HabitatRecord>(STORE.habitats, id)
    if (!habitat) throw new Error(`Habitat "${id}" does not exist in this container.`)
    return habitat
  }

  async createHabitat(name: string, description = ""): Promise<HabitatRecord> {
    const trimmed = name.trim()
    if (trimmed.length === 0) throw new Error("A habitat needs a name.")
    const existing = await this.listHabitats()
    if (existing.some((habitat) => habitat.name.toLowerCase() === trimmed.toLowerCase())) {
      throw new Error(`A habitat named "${trimmed}" already exists.`)
    }
    const id = `${trimmed.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "habitat"}-${Date.now().toString(36)}`
    const habitat: HabitatRecord = {
      id,
      name: trimmed,
      description: description.trim(),
      createdAt: Date.now(),
      updatedAt: Date.now(),
      head: null,
      notes: [],
      liveModules: [],
      liveState: [],
    }
    await this.storage.put(STORE.habitats, id, habitat)
    await this.commitFiles(
      id,
      {
        "README.md": `# ${trimmed}\n\n${description.trim() || "A new nano-habitat."}\n`,
        "src/main.js": `// Live module entry point. Assign module.exports.result to report a value.\nconsole.log("habitat online:", ${JSON.stringify(trimmed)});\n\nmodule.exports.result = { ok: true };\n`,
      },
      "initialize habitat",
    )
    this.emit()
    return this.getHabitat(id)
  }

  async deleteHabitat(id: string): Promise<void> {
    const habitat = await this.getHabitat(id)
    if (habitat.head) {
      const commit = await this.cas.getCommit(habitat.head)
      const tree = await this.cas.getTree(commit.tree)
      for (const hash of Object.values(tree.entries)) {
        await this.cas.releaseBlob(hash)
        this.governor.invalidate(hash)
      }
    }
    await this.storage.delete(STORE.habitats, id)
    await this.storage.delete(STORE.predictor, id)
    this.predictors.delete(id)
    this.graphCache.delete(id)
    this.emit()
  }

  async saveNote(habitatId: string, title: string, body: string, noteId?: string): Promise<void> {
    const habitat = await this.getHabitat(habitatId)
    const note: HabitatNote = {
      id: noteId ?? `${habitatId}-note-${Date.now().toString(36)}`,
      title: title.trim() || "Untitled note",
      body,
      updatedAt: Date.now(),
      embedding: embedText(`${title} ${body}`),
    }
    const notes = habitat.notes.filter((item) => item.id !== note.id)
    notes.unshift(note)
    await this.storage.put(STORE.habitats, habitatId, { ...habitat, notes, updatedAt: Date.now() })
    this.emit()
  }

  async deleteNote(habitatId: string, noteId: string): Promise<void> {
    const habitat = await this.getHabitat(habitatId)
    const notes = habitat.notes.filter((note) => note.id !== noteId)
    await this.storage.put(STORE.habitats, habitatId, { ...habitat, notes, updatedAt: Date.now() })
    this.emit()
  }

  // ------------------------------------------------------------------- files

  private async currentTree(habitat: HabitatRecord): Promise<TreeObject> {
    if (!habitat.head) return { kind: "tree", entries: {} }
    const commit = await this.cas.getCommit(habitat.head)
    return this.cas.getTree(commit.tree)
  }

  async listFiles(habitatId: string): Promise<FileEntry[]> {
    const habitat = await this.getHabitat(habitatId)
    const tree = await this.currentTree(habitat)
    const entries: FileEntry[] = []
    for (const [path, hash] of Object.entries(tree.entries)) {
      const record = await this.cas.getBlobRecord(hash)
      entries.push({
        path,
        hash,
        rawSize: record?.rawSize ?? 0,
        storedSize: record?.storedSize ?? 0,
        codec: record?.codec ?? "raw",
      })
    }
    return entries.sort((a, b) => (a.path < b.path ? -1 : 1))
  }

  /** Read through the governor, then train and act on the predictor. */
  async readFile(habitatId: string, path: string): Promise<string> {
    const habitat = await this.getHabitat(habitatId)
    const tree = await this.currentTree(habitat)
    const hash = tree.entries[path]
    if (!hash) throw new Error(`"${path}" is not present at the habitat head.`)
    const text = await this.governor.materialize(hash, path, (target) => this.cas.getText(target))

    const predictor = await this.predictor(habitatId)
    predictor.record(path)
    const prior = await this.dependencyPrior(habitatId, path)
    const predicted = predictor.predict(path, prior, 3)
    for (const candidate of predicted) {
      const candidateHash = tree.entries[candidate]
      if (candidateHash) {
        await this.governor.prefetch(candidateHash, candidate, (target) => this.cas.getText(target))
      }
    }
    await predictor.flush()
    return text
  }

  async writeFile(habitatId: string, path: string, text: string, message?: string): Promise<boolean> {
    const cleanPath = path.trim().replace(/^\/+/, "")
    if (cleanPath.length === 0) throw new Error("A file needs a path.")
    const habitat = await this.getHabitat(habitatId)
    const tree = await this.currentTree(habitat)
    const nextHash = await sha256Hex(text)
    if (tree.entries[cleanPath] === nextHash) return false // Nothing changed: no commit.

    const previous = tree.entries[cleanPath]
    const put = await this.cas.putBlob(text, cleanPath)
    const entries = { ...tree.entries, [cleanPath]: put.hash }
    if (previous && previous !== put.hash) {
      await this.cas.releaseBlob(previous)
      this.governor.invalidate(previous)
    }
    await this.commitTree(habitat, entries, message ?? `update ${cleanPath}`)
    this.governor.invalidate(put.hash)
    this.graphCache.delete(habitatId)
    this.emit()
    return true
  }

  async deleteFile(habitatId: string, path: string): Promise<void> {
    const habitat = await this.getHabitat(habitatId)
    const tree = await this.currentTree(habitat)
    const hash = tree.entries[path]
    if (!hash) return
    const entries = { ...tree.entries }
    delete entries[path]
    await this.cas.releaseBlob(hash)
    this.governor.invalidate(hash)
    await this.commitTree(habitat, entries, `remove ${path}`)
    this.graphCache.delete(habitatId)
    this.emit()
  }

  /** Batch write used for seeding and imports: one commit for many files. */
  async commitFiles(habitatId: string, files: Record<string, string>, message: string): Promise<void> {
    const habitat = await this.getHabitat(habitatId)
    const tree = await this.currentTree(habitat)
    const entries = { ...tree.entries }
    for (const [path, text] of Object.entries(files)) {
      const put = await this.cas.putBlob(text, path)
      const previous = entries[path]
      if (previous && previous !== put.hash) await this.cas.releaseBlob(previous)
      entries[path] = put.hash
    }
    await this.commitTree(habitat, entries, message)
    this.graphCache.delete(habitatId)
    this.emit()
  }

  private async commitTree(habitat: HabitatRecord, entries: Record<string, Hash>, message: string): Promise<Hash> {
    const treeHash = await this.cas.putObject({ kind: "tree", entries })
    const commitHash = await this.cas.putObject({
      kind: "commit",
      parent: habitat.head,
      tree: treeHash,
      message,
      ts: Date.now(),
      author: AUTHOR,
    })
    await this.storage.put(STORE.habitats, habitat.id, { ...habitat, head: commitHash, updatedAt: Date.now() })
    return commitHash
  }

  async history(habitatId: string, limit = 40): Promise<HistoryEntry[]> {
    const habitat = await this.getHabitat(habitatId)
    const out: HistoryEntry[] = []
    let cursor = habitat.head
    const visited = new Set<Hash>()
    while (cursor && out.length < limit && !visited.has(cursor)) {
      visited.add(cursor)
      const commit = await this.cas.getCommit(cursor)
      const tree = await this.cas.getTree(commit.tree)
      const parentEntries = commit.parent
        ? (await this.cas.getTree((await this.cas.getCommit(commit.parent)).tree)).entries
        : {}
      const added: string[] = []
      const modified: string[] = []
      const removed: string[] = []
      for (const [path, hash] of Object.entries(tree.entries)) {
        if (!(path in parentEntries)) added.push(path)
        else if (parentEntries[path] !== hash) modified.push(path)
      }
      for (const path of Object.keys(parentEntries)) {
        if (!(path in tree.entries)) removed.push(path)
      }
      out.push({ hash: cursor, commit, added: added.sort(), modified: modified.sort(), removed: removed.sort() })
      cursor = commit.parent
    }
    return out
  }

  // ------------------------------------------------------- architecture layer

  async graph(habitatId: string): Promise<ArchitectureGraph> {
    const habitat = await this.getHabitat(habitatId)
    const key = habitat.head ?? "empty"
    const cached = this.graphCache.get(habitatId)
    if (cached && cached.key === key) return cached.graph
    const tree = await this.currentTree(habitat)
    const files: { path: string; text: string; bytes: number }[] = []
    for (const [path, hash] of Object.entries(tree.entries)) {
      const text = this.governor.peek(hash) ?? (await this.cas.getText(hash))
      files.push({ path, text, bytes: text.length })
    }
    const graph = buildArchitectureGraph(files)
    this.graphCache.set(habitatId, { key, graph })
    return graph
  }

  private async dependencyPrior(habitatId: string, path: string): Promise<string[]> {
    try {
      const graph = await this.graph(habitatId)
      return graph.edges.filter((edge) => edge.from === path).map((edge) => edge.to)
    } catch {
      return []
    }
  }

  private async predictor(habitatId: string): Promise<AccessPredictor> {
    const existing = this.predictors.get(habitatId)
    if (existing) return existing
    const created = new AccessPredictor(this.storage, habitatId)
    await created.load()
    this.predictors.set(habitatId, created)
    return created
  }

  async predictorStats(habitatId: string): Promise<PredictorStats> {
    return (await this.predictor(habitatId)).stats()
  }

  governorStats(): GovernorStats {
    return this.governor.stats()
  }

  // -------------------------------------------------------------- live runtime

  /** Materialize the whole module graph and run `entry` in the worker adapter. */
  async run(habitatId: string, entry: string): Promise<RunResult> {
    const habitat = await this.getHabitat(habitatId)
    const tree = await this.currentTree(habitat)
    const files: Record<string, string> = {}
    for (const [path, hash] of Object.entries(tree.entries)) {
      if (!/\.(js|mjs|json)$/.test(path)) continue
      files[path] = await this.governor.materialize(hash, path, (target) => this.cas.getText(target))
    }
    const result = await runLiveModule({ entry, files })
    const liveState = [
      {
        id: `run-${Date.now().toString(36)}`,
        entry,
        ts: Date.now(),
        durationMs: result.durationMs,
        ok: result.ok,
        logCount: result.logs.length,
        summary: result.ok
          ? `ok — ${result.logs.length} log line(s)${result.result ? `, result ${JSON.stringify(result.result).slice(0, 80)}` : ""}`
          : `failed — ${(result.error ?? "unknown error").split("\n")[0]}`,
      },
      ...habitat.liveState,
    ].slice(0, 12)
    const liveModules = habitat.liveModules.includes(entry) ? habitat.liveModules : [...habitat.liveModules, entry]
    await this.storage.put(STORE.habitats, habitatId, { ...habitat, liveState, liveModules, updatedAt: Date.now() })
    this.emit()
    return result
  }

  // ------------------------------------------------------------------ search

  /** Ranked search across every habitat: path match, term frequency, notes. */
  async search(query: string, limit = 24): Promise<SearchHit[]> {
    const terms = query.toLowerCase().match(/[a-z0-9_.]+/g) ?? []
    if (terms.length === 0) return []
    // terms.length > 0 is guaranteed above, but TS's indexed-access typing
    // doesn't see that -- pin the first term to a real string once here
    // instead of asserting it at every call site below.
    const firstTerm: string = terms[0] ?? ""
    const queryEmbedding = embedText(query)
    const habitats = await this.listHabitats()
    const hits: SearchHit[] = []

    for (const habitat of habitats) {
      const tree = await this.currentTree(habitat)
      for (const [path, hash] of Object.entries(tree.entries)) {
        const text = this.governor.peek(hash) ?? (await this.cas.getText(hash))
        const lowerText = text.toLowerCase()
        const lowerPath = path.toLowerCase()
        let score = 0
        for (const term of terms) {
          if (lowerPath.includes(term)) score += 4
          let index = lowerText.indexOf(term)
          let occurrences = 0
          while (index !== -1 && occurrences < 50) {
            occurrences += 1
            index = lowerText.indexOf(term, index + term.length)
          }
          score += Math.min(6, occurrences)
        }
        score += cosineSimilarity(queryEmbedding, embedText(text)) * 3
        if (score <= 0) continue
        const anchor = lowerText.indexOf(firstTerm)
        const start = anchor === -1 ? 0 : Math.max(0, anchor - 40)
        hits.push({
          habitatId: habitat.id,
          habitatName: habitat.name,
          path,
          score,
          preview: text.slice(start, start + 140).replace(/\s+/g, " ").trim(),
        })
      }
      for (const note of habitat.notes) {
        const similarity = cosineSimilarity(queryEmbedding, note.embedding)
        const lexical = terms.reduce(
          (sum, term) => sum + (`${note.title} ${note.body}`.toLowerCase().includes(term) ? 3 : 0),
          0,
        )
        const score = similarity * 6 + lexical
        if (score < 1) continue
        hits.push({
          habitatId: habitat.id,
          habitatName: habitat.name,
          path: `note: ${note.title}`,
          score,
          preview: note.body.slice(0, 140),
        })
      }
    }
    return hits.sort((a, b) => b.score - a.score).slice(0, limit)
  }

  // ---------------------------------------------------------------- capacity

  async capacity(): Promise<CapacityModel> {
    const stats = await this.cas.stats()
    const logical = Math.max(1, stats.logicalBytes)
    const ratio = stats.physicalBytes / logical
    const safeRatio = ratio > 0 ? ratio : 0.05
    return {
      ...stats,
      ratio: safeRatio,
      storageBudgetBytes: this.storageBudget,
      effectiveCapacityBytes: this.storageBudget / safeRatio,
      expansionFactor: 1 / safeRatio,
    }
  }

  // ---------------------------------------------------------------- snapshots

  async exportHabitat(habitatId: string): Promise<{ filename: string; text: string; bytes: number }> {
    const habitat = await this.getHabitat(habitatId)
    const snapshot = await buildSnapshot(this.cas, habitat)
    const text = serializeSnapshot(snapshot)
    return { filename: `${habitat.name}-${snapshot.chain.slice(0, 8)}.nhsnap.json`, text, bytes: text.length }
  }

  async importHabitat(text: string): Promise<HabitatRecord> {
    const snapshot = parseSnapshot(text)
    await adoptSnapshot(this.cas, snapshot)
    const existing = await this.storage.get<HabitatRecord>(STORE.habitats, snapshot.habitat.id)
    const record: HabitatRecord = existing
      ? { ...snapshot.habitat, id: `${snapshot.habitat.id}-import-${Date.now().toString(36)}`, name: `${snapshot.habitat.name} (imported)` }
      : snapshot.habitat
    await this.storage.put(STORE.habitats, record.id, { ...record, updatedAt: Date.now() })
    this.graphCache.delete(record.id)
    this.emit()
    return record
  }

  // -------------------------------------------------------------------- admin

  async resetContainer(): Promise<void> {
    await this.storage.clearAll()
    this.governor.clear()
    this.predictors.clear()
    this.graphCache.clear()
    await this.seed()
  }
}
