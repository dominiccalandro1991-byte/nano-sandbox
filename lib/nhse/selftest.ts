/**
 * Embedded verification suite and edge-case matrix.
 *
 * Every test runs against a container-isolated in-memory engine, so running
 * the suite can never mutate the user's persistent habitats. Each case asserts
 * a specification invariant, a boundary condition, or a failure mode.
 */

import { NanoHabitatEngine } from "./engine"
import { ContentStore } from "./cas"
import { WorkingSetGovernor } from "./governor"
import { AccessPredictor } from "./predictor"
import { buildArchitectureGraph } from "./graph"
import { runLiveModule } from "./runtime"
import { adoptSnapshot, buildSnapshot, parseSnapshot, serializeSnapshot } from "./snapshot"
import { createMemoryStorage, STORE } from "./storage"
import { canonicalJson, sha256Hex, sha256Sync, bytesToHex, textToBytes } from "./hash"
import { compressText, decompressText, hasNativeCompression } from "./codec"
import type { BlobRecord, TestResult } from "./types"

class AssertionError extends Error {}

function assert(condition: unknown, message: string): void {
  if (!condition) throw new AssertionError(message)
}

interface Case {
  id: string
  category: string
  name: string
  run: () => Promise<string>
}

const CASES: Case[] = [
  {
    id: "cas-01",
    category: "Content addressing",
    name: "SHA-256 matches the published NIST vector",
    async run() {
      const digest = await sha256Hex("abc")
      assert(
        digest === "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
        `unexpected digest ${digest}`,
      )
      return digest.slice(0, 16)
    },
  },
  {
    id: "cas-02",
    category: "Content addressing",
    name: "Software SHA-256 fallback is bit-identical to WebCrypto",
    async run() {
      const payloads = ["", "a", "nano", "x".repeat(55), "y".repeat(56), "z".repeat(1000), "🛰️ habitat"]
      for (const payload of payloads) {
        const viaCrypto = await sha256Hex(payload)
        const viaSoftware = bytesToHex(sha256Sync(textToBytes(payload)))
        assert(viaCrypto === viaSoftware, `divergence at length ${payload.length}`)
      }
      return `${payloads.length} boundary lengths verified (incl. 55/56-byte padding edges)`
    },
  },
  {
    id: "cas-03",
    category: "Content addressing",
    name: "Canonical JSON is key-order independent",
    async run() {
      const a = canonicalJson({ b: 1, a: [3, { d: 4, c: 5 }] })
      const b = canonicalJson({ a: [3, { c: 5, d: 4 }], b: 1 })
      assert(a === b, "canonical forms diverged")
      assert((await sha256Hex(a)) === (await sha256Hex(b)), "hashes diverged")
      return a
    },
  },
  {
    id: "cas-04",
    category: "Compression",
    name: "Compression round-trips and shrinks source payloads",
    async run() {
      const source = "export function step(){ return 1 }\n".repeat(400)
      const packed = await compressText(source, "src.ts")
      const restored = await decompressText(packed.data, packed.codec)
      assert(restored === source, "payload changed across the codec")
      if (hasNativeCompression()) {
        assert(packed.storedSize < packed.rawSize, "no compression achieved on repetitive source")
        const ratio = packed.storedSize / packed.rawSize
        return `ratio ${(ratio * 100).toFixed(2)}% of original`
      }
      return "native codec unavailable — raw fallback verified"
    },
  },
  {
    id: "cas-05",
    category: "Compression",
    name: "Empty, unicode, and incompressible payloads survive",
    async run() {
      const random = Array.from({ length: 2048 }, (_, index) => String.fromCharCode(33 + ((index * 7919) % 90))).join("")
      const payloads = ["", "🛰️🧬 نانو 汉字 habitat", random, "\u0000\u0001\u0002"]
      for (const payload of payloads) {
        const packed = await compressText(payload, "misc.bin")
        const restored = await decompressText(packed.data, packed.codec)
        assert(restored === payload, `round-trip failed for ${JSON.stringify(payload.slice(0, 12))}`)
      }
      return `${payloads.length} adversarial payloads verified`
    },
  },
  {
    id: "cas-06",
    category: "Deduplication",
    name: "Identical content across habitats stores one physical blob",
    async run() {
      const cas = new ContentStore(createMemoryStorage())
      const text = "module.exports = { shared: true }\n"
      const first = await cas.putBlob(text, "a/shared.js")
      const second = await cas.putBlob(text, "b/shared.js")
      assert(first.hash === second.hash, "same content produced different addresses")
      assert(second.deduplicated, "second write was not absorbed by dedup")
      const stats = await cas.stats()
      assert(stats.blobCount === 1, `expected 1 unique blob, found ${stats.blobCount}`)
      assert(stats.logicalBytes === stats.uniqueRawBytes * 2, "logical accounting is wrong")
      assert(stats.dedupSavedBytes === stats.uniqueRawBytes, "dedup savings mis-reported")
      return `1 blob, refs=2, saved ${stats.dedupSavedBytes} B`
    },
  },
  {
    id: "cas-07",
    category: "Deduplication",
    name: "Physical bytes are reclaimed only at zero references",
    async run() {
      const cas = new ContentStore(createMemoryStorage())
      const text = "shared payload"
      const { hash } = await cas.putBlob(text, "a.txt")
      await cas.putBlob(text, "b.txt")
      await cas.releaseBlob(hash)
      assert((await cas.getBlobRecord(hash))?.refs === 1, "first release should leave one reference")
      await cas.releaseBlob(hash)
      assert((await cas.getBlobRecord(hash)) === undefined, "blob should be reclaimed at zero refs")
      return "refcount 2 -> 1 -> reclaimed"
    },
  },
  {
    id: "cas-08",
    category: "Integrity",
    name: "Byte-level tampering is detected by hash equality alone",
    async run() {
      const storage = createMemoryStorage()
      const cas = new ContentStore(storage)
      const { hash } = await cas.putBlob("integrity matters", "note.txt")
      const record = (await cas.getBlobRecord(hash)) as BlobRecord
      const mutated = new Uint8Array(record.data)
      mutated[mutated.length - 1] ^= 0xff
      await storage.put(STORE.blobs, hash, { ...record, data: mutated })
      let detected = false
      try {
        await cas.getText(hash)
      } catch {
        detected = true
      }
      assert(detected, "corruption was not detected")
      const sweep = await cas.verifyAll()
      assert(sweep.corrupted.includes(hash), "verifyAll missed the corrupted object")
      return `flagged after sweeping ${sweep.checked} object(s)`
    },
  },
  {
    id: "dag-01",
    category: "Merkle DAG",
    name: "Tree roots are stable and one-byte sensitive",
    async run() {
      const cas = new ContentStore(createMemoryStorage())
      const a = await cas.putObject({ kind: "tree", entries: { "a.js": "1".repeat(64), "b.js": "2".repeat(64) } })
      const b = await cas.putObject({ kind: "tree", entries: { "b.js": "2".repeat(64), "a.js": "1".repeat(64) } })
      const c = await cas.putObject({ kind: "tree", entries: { "a.js": "1".repeat(64), "b.js": `${"2".repeat(63)}3` } })
      assert(a === b, "entry ordering changed the root")
      assert(a !== c, "root did not diverge on a changed entry")
      return `${a.slice(0, 10)} vs ${c.slice(0, 10)}`
    },
  },
  {
    id: "dag-02",
    category: "Merkle DAG",
    name: "History diffs classify add / modify / remove",
    async run() {
      const engine = await NanoHabitatEngine.createEphemeral({ seed: false })
      const habitat = await engine.createHabitat("diff-lab", "history test")
      await engine.writeFile(habitat.id, "src/one.js", "module.exports = 1\n")
      await engine.writeFile(habitat.id, "src/one.js", "module.exports = 2\n")
      await engine.deleteFile(habitat.id, "src/one.js")
      const history = await engine.history(habitat.id)
      const [removal, modification, addition] = history
      assert(removal.removed.includes("src/one.js"), "removal not detected")
      assert(modification.modified.includes("src/one.js"), "modification not detected")
      assert(addition.added.includes("src/one.js"), "addition not detected")
      engine.dispose()
      return `${history.length} commits classified`
    },
  },
  {
    id: "dag-03",
    category: "Merkle DAG",
    name: "Rewriting identical content creates no commit",
    async run() {
      const engine = await NanoHabitatEngine.createEphemeral({ seed: false })
      const habitat = await engine.createHabitat("idempotent", "")
      const text = "module.exports = { stable: true }\n"
      await engine.writeFile(habitat.id, "src/x.js", text)
      const before = (await engine.history(habitat.id)).length
      const changed = await engine.writeFile(habitat.id, "src/x.js", text)
      const after = (await engine.history(habitat.id)).length
      assert(changed === false, "no-op write reported a change")
      assert(before === after, `history grew from ${before} to ${after}`)
      engine.dispose()
      return `history stable at ${after} commits`
    },
  },
  {
    id: "gov-01",
    category: "Working-set governor",
    name: "Resident bytes never exceed the budget",
    async run() {
      const governor = new WorkingSetGovernor({ budgetBytes: 8 * 1024, highWaterMark: 0.9, reliefTarget: 0.5 })
      const page = "p".repeat(1024)
      for (let i = 0; i < 40; i++) {
        await governor.materialize(`hash-${i}`, `page-${i}`, async () => page)
        assert(
          governor.stats().residentBytes <= governor.budgetBytes,
          `budget exceeded at page ${i}: ${governor.stats().residentBytes}`,
        )
      }
      const stats = governor.stats()
      assert(stats.evictions > 0, "no eviction occurred under sustained pressure")
      governor.dispose()
      return `${stats.evictions} eviction(s), ${stats.residentCount} resident page(s)`
    },
  },
  {
    id: "gov-02",
    category: "Working-set governor",
    name: "Re-reads are served from the working set",
    async run() {
      const governor = new WorkingSetGovernor({ budgetBytes: 1024 * 1024 })
      let loads = 0
      const loader = async () => {
        loads += 1
        return "resident payload"
      }
      await governor.materialize("h1", "a.js", loader)
      await governor.materialize("h1", "a.js", loader)
      await governor.materialize("h1", "a.js", loader)
      const stats = governor.stats()
      assert(loads === 1, `loader ran ${loads} times, expected 1`)
      assert(stats.hits === 2 && stats.misses === 1, `hit/miss accounting wrong: ${stats.hits}/${stats.misses}`)
      governor.dispose()
      return `hit rate ${(stats.hitRate * 100).toFixed(0)}%`
    },
  },
  {
    id: "gov-03",
    category: "Working-set governor",
    name: "Invalidation and full compression release every page",
    async run() {
      const governor = new WorkingSetGovernor({ budgetBytes: 1024 * 1024 })
      await governor.materialize("h1", "a.js", async () => "aaaa")
      await governor.materialize("h2", "b.js", async () => "bbbb")
      governor.invalidate("h1")
      assert(governor.stats().residentCount === 1, "invalidate did not release the page")
      governor.clear()
      const stats = governor.stats()
      assert(stats.residentCount === 0 && stats.residentBytes === 0, "clear left residue")
      assert(stats.pressure === 0, "pressure did not return to zero")
      governor.dispose()
      return "working set fully compressed"
    },
  },
  {
    id: "ai-01",
    category: "Intelligence layer",
    name: "Predictor learns access order and scores its own accuracy",
    async run() {
      const predictor = new AccessPredictor(createMemoryStorage(), "habitat")
      await predictor.load()
      const sequence = ["src/main.js", "src/physics.js", "src/lattice.js"]
      // Same order as NanoHabitatEngine.readThrough: record access, then predict next.
      for (let round = 0; round < 6; round++) {
        for (const path of sequence) {
          predictor.record(path)
          predictor.predict(path)
        }
      }
      const prediction = predictor.predict("src/main.js")
      assert(prediction[0] === "src/physics.js", `expected physics first, got ${prediction.join(",")}`)
      const stats = predictor.stats()
      assert(stats.hitRate > 0.5, `hit rate too low: ${stats.hitRate}`)
      assert(stats.states === 3, `expected 3 states, got ${stats.states}`)
      return `hit rate ${(stats.hitRate * 100).toFixed(0)}% over ${stats.transitions} transitions`
    },
  },
  {
    id: "ai-02",
    category: "Intelligence layer",
    name: "Cold states fall back to the dependency prior",
    async run() {
      const predictor = new AccessPredictor(createMemoryStorage(), "habitat")
      await predictor.load()
      const prediction = predictor.predict("src/unseen.js", ["src/dep-a.js", "src/dep-b.js"], 2)
      assert(prediction[0] === "src/dep-a.js", `prior ignored: ${prediction.join(",")}`)
      assert(prediction.length === 2, "k was not respected")
      return prediction.join(" → ")
    },
  },
  {
    id: "ai-03",
    category: "Intelligence layer",
    name: "Predictive prefetch warms the next file before it is opened",
    async run() {
      const engine = await NanoHabitatEngine.createEphemeral()
      for (let round = 0; round < 4; round++) {
        await engine.readFile("lattice", "src/main.js")
        await engine.readFile("lattice", "src/physics.js")
        await engine.readFile("lattice", "src/lattice.js")
      }
      const stats = await engine.predictorStats("lattice")
      assert(stats.hitRate > 0.5, `prefetch hit rate ${stats.hitRate}`)
      const governor = engine.governorStats()
      assert(governor.hits > 0, "governor never served a resident page")
      engine.dispose()
      return `predictor ${(stats.hitRate * 100).toFixed(0)}%, governor ${(governor.hitRate * 100).toFixed(0)}%`
    },
  },
  {
    id: "arch-01",
    category: "Architecture graph",
    name: "Relative imports resolve and layer correctly",
    async run() {
      const graph = buildArchitectureGraph([
        { path: "src/main.js", text: 'var p = require("./physics");\nimport x from "./lattice"', bytes: 40 },
        { path: "src/physics.js", text: 'var l = require("./lattice")', bytes: 20 },
        { path: "src/lattice.js", text: "module.exports = {}", bytes: 20 },
      ])
      const main = graph.nodes.find((node) => node.id === "src/main.js")
      const lattice = graph.nodes.find((node) => node.id === "src/lattice.js")
      assert(graph.edges.length === 3, `expected 3 edges, found ${graph.edges.length}`)
      assert(main?.layer === 0, `main should be layer 0, got ${main?.layer}`)
      assert(lattice?.layer === 2, `lattice should be layer 2, got ${lattice?.layer}`)
      assert(lattice?.fanIn === 2, `lattice fan-in should be 2, got ${lattice?.fanIn}`)
      assert(graph.cycles.length === 0, "false cycle reported on a DAG")
      return `${graph.nodes.length} nodes across ${graph.layers.length} layers`
    },
  },
  {
    id: "arch-02",
    category: "Architecture graph",
    name: "Dependency cycles are detected without stack overflow",
    async run() {
      const files = [
        { path: "a.js", text: 'require("./b")', bytes: 10 },
        { path: "b.js", text: 'require("./c")', bytes: 10 },
        { path: "c.js", text: 'require("./a")', bytes: 10 },
      ]
      const cyclic = buildArchitectureGraph(files)
      assert(cyclic.cycles.length === 1, `expected 1 cycle, found ${cyclic.cycles.length}`)
      assert(cyclic.edges.some((edge) => edge.cyclic), "cyclic edge not flagged")

      const deep = Array.from({ length: 4000 }, (_, index) => ({
        path: `m${index}.js`,
        text: index < 3999 ? `require("./m${index + 1}")` : "module.exports = {}",
        bytes: 10,
      }))
      const chain = buildArchitectureGraph(deep)
      assert(chain.cycles.length === 0, "false cycle on a 4000-node chain")
      assert(chain.layers.length === 4000, `expected 4000 layers, got ${chain.layers.length}`)
      return "3-node cycle flagged; 4000-node chain layered iteratively"
    },
  },
  {
    id: "arch-03",
    category: "Architecture graph",
    name: "Bare and dangling specifiers are reported, not silently dropped",
    async run() {
      const graph = buildArchitectureGraph([
        { path: "src/app.js", text: 'import react from "react"\nrequire("./missing")', bytes: 30 },
      ])
      assert(graph.unresolved.length === 2, `expected 2 unresolved, got ${graph.unresolved.length}`)
      assert(graph.edges.length === 0, "an unresolved specifier created an edge")
      return graph.unresolved.map((item) => item.specifier).join(", ")
    },
  },
  {
    id: "run-01",
    category: "Runtime adapter",
    name: "Seeded lattice module runs and conserves mass",
    async run() {
      const engine = await NanoHabitatEngine.createEphemeral()
      const result = await engine.run("lattice", "src/main.js")
      assert(result.ok, `run failed: ${result.error}`)
      const payload = result.result as { conserved?: boolean; maxDrift?: number } | null
      assert(payload?.conserved === true, `mass drift too high: ${payload?.maxDrift}`)
      assert(result.logs.length >= 4, `expected log output, got ${result.logs.length} lines`)
      engine.dispose()
      return `${result.durationMs} ms, drift ${(payload?.maxDrift ?? 0).toExponential(2)}`
    },
  },
  {
    id: "run-02",
    category: "Runtime adapter",
    name: "Seeded game logic replays deterministically",
    async run() {
      const engine = await NanoHabitatEngine.createEphemeral()
      const result = await engine.run("serpent", "src/main.js")
      assert(result.ok, `run failed: ${result.error}`)
      const payload = result.result as { deterministic?: boolean; score?: number } | null
      assert(payload?.deterministic === true, "identical seeds diverged")
      engine.dispose()
      return `score ${payload?.score}, replay identical`
    },
  },
  {
    id: "run-03",
    category: "Runtime adapter",
    name: "Runaway module is terminated by the wall-clock budget",
    async run() {
      const started = Date.now()
      const result = await runLiveModule({
        entry: "loop.js",
        files: { "loop.js": "while (true) { Math.sqrt(2) }" },
        timeoutMs: 700,
      })
      const elapsed = Date.now() - started
      assert(!result.ok, "runaway module reported success")
      assert(/exceeded/i.test(result.error ?? ""), `unexpected error: ${result.error}`)
      assert(elapsed < 4000, `termination took too long: ${elapsed} ms`)
      return `terminated after ${elapsed} ms, host thread unaffected`
    },
  },
  {
    id: "run-04",
    category: "Runtime adapter",
    name: "Missing modules, throws, and circular requires fail gracefully",
    async run() {
      const missing = await runLiveModule({ entry: "a.js", files: { "a.js": 'require("./nope")' } })
      assert(!missing.ok && /not found/i.test(missing.error ?? ""), `missing-module path wrong: ${missing.error}`)

      const thrown = await runLiveModule({ entry: "a.js", files: { "a.js": 'throw new Error("boom")' } })
      assert(!thrown.ok && /boom/.test(thrown.error ?? ""), `throw path wrong: ${thrown.error}`)

      const circular = await runLiveModule({
        entry: "a.js",
        files: { "a.js": 'require("./b")', "b.js": 'require("./a")' },
      })
      assert(!circular.ok && /circular/i.test(circular.error ?? ""), `circular path wrong: ${circular.error}`)

      const absent = await runLiveModule({ entry: "ghost.js", files: {} })
      assert(!absent.ok && /not present/i.test(absent.error ?? ""), `absent-entry path wrong: ${absent.error}`)
      return "4 failure modes contained"
    },
  },
  {
    id: "snap-01",
    category: "Snapshot export",
    name: "Exported habitat re-materializes byte-identically elsewhere",
    async run() {
      const source = await NanoHabitatEngine.createEphemeral()
      const original = await source.readFile("lattice", "src/main.js")
      const exported = await source.exportHabitat("lattice")

      const target = await NanoHabitatEngine.createEphemeral({ seed: false })
      const imported = await target.importHabitat(exported.text)
      const restored = await target.readFile(imported.id, "src/main.js")
      assert(restored === original, "restored payload differs from the original")
      const files = await target.listFiles(imported.id)
      assert(files.length >= 4, `expected the full tree, got ${files.length} files`)
      const history = await target.history(imported.id)
      assert(history.length >= 1, "history did not travel with the snapshot")
      source.dispose()
      target.dispose()
      return `${files.length} files, ${history.length} commit(s), ${exported.bytes} B package`
    },
  },
  {
    id: "snap-02",
    category: "Snapshot export",
    name: "Tampered snapshots are rejected before adoption",
    async run() {
      const engine = await NanoHabitatEngine.createEphemeral()
      const habitat = await engine.getHabitat("cahs")
      const snapshot = await buildSnapshot(engine.cas, habitat)

      const objectHash = Object.keys(snapshot.objects)[0]
      const mutated = parseSnapshot(serializeSnapshot(snapshot))
      mutated.objects[objectHash] = `${mutated.objects[objectHash]} `
      let objectDetected = false
      try {
        await adoptSnapshot(new ContentStore(createMemoryStorage()), mutated)
      } catch {
        objectDetected = true
      }
      assert(objectDetected, "object tampering was not detected")

      const reordered = parseSnapshot(serializeSnapshot(snapshot))
      reordered.chain = `${reordered.chain.slice(0, -1)}0`
      let chainDetected = false
      try {
        await adoptSnapshot(new ContentStore(createMemoryStorage()), reordered)
      } catch {
        chainDetected = true
      }
      assert(chainDetected, "chain tampering was not detected")

      const notPackage = () => parseSnapshot('{"format":"something-else"}')
      let formatDetected = false
      try {
        notPackage()
      } catch {
        formatDetected = true
      }
      assert(formatDetected, "foreign package accepted")
      engine.dispose()
      return "object, chain, and format tampering all rejected"
    },
  },
  {
    id: "cap-01",
    category: "Capacity model",
    name: "C_eff = S / r is derived from live measurements",
    async run() {
      const engine = await NanoHabitatEngine.createEphemeral()
      const capacity = await engine.capacity()
      assert(capacity.ratio > 0 && capacity.ratio <= 1, `ratio out of range: ${capacity.ratio}`)
      assert(capacity.logicalBytes >= capacity.uniqueRawBytes, "logical size below unique size")
      assert(
        capacity.effectiveCapacityBytes >= capacity.storageBudgetBytes,
        "effective capacity below physical budget",
      )
      assert(capacity.blobCount > 0, "no blobs measured")
      engine.dispose()
      return `r = ${(capacity.ratio * 100).toFixed(1)}%, expansion ×${capacity.expansionFactor.toFixed(1)}`
    },
  },
  {
    id: "cap-02",
    category: "Capacity model",
    name: "Cross-habitat dedup is observable from a cold seed",
    async run() {
      const engine = await NanoHabitatEngine.createEphemeral()
      const lattice = await engine.listFiles("lattice")
      const cahs = await engine.listFiles("cahs")
      const a = lattice.find((file) => file.path === "src/checksum.js")
      const b = cahs.find((file) => file.path === "src/checksum.js")
      assert(a && b, "shared module missing from a seeded habitat")
      assert(a?.hash === b?.hash, "identical files received different addresses")
      const record = await engine.cas.getBlobRecord(a!.hash)
      assert((record?.refs ?? 0) >= 2, `expected refs >= 2, got ${record?.refs}`)
      engine.dispose()
      return `checksum.js shared by 2 habitats at ${a?.hash.slice(0, 10)}`
    },
  },
  {
    id: "srch-01",
    category: "Search",
    name: "Ranked search spans code and notes across habitats",
    async run() {
      const engine = await NanoHabitatEngine.createEphemeral()
      const hits = await engine.search("diffusion CFL")
      assert(hits.length > 0, "no results for a seeded term")
      assert(hits.some((hit) => hit.path.includes("physics.js")), "physics.js not surfaced")
      assert(hits.some((hit) => hit.path.startsWith("note:")), "notes were not searched")
      assert(hits[0].score >= hits[hits.length - 1].score, "results are not ranked")
      const empty = await engine.search("   ")
      assert(empty.length === 0, "blank query returned results")
      engine.dispose()
      return `${hits.length} ranked hit(s); blank query returns none`
    },
  },
  {
    id: "iso-01",
    category: "Container isolation",
    name: "Habitat deletion releases references and clears predictor state",
    async run() {
      const engine = await NanoHabitatEngine.createEphemeral()
      const shared = (await engine.listFiles("lattice")).find((file) => file.path === "src/checksum.js")
      assert(shared, "shared module missing")
      const before = (await engine.cas.getBlobRecord(shared!.hash))?.refs ?? 0
      await engine.deleteHabitat("lattice")
      const after = (await engine.cas.getBlobRecord(shared!.hash))?.refs ?? 0
      assert(after === before - 1, `refs went ${before} -> ${after}`)
      const remaining = await engine.listHabitats()
      assert(!remaining.some((habitat) => habitat.id === "lattice"), "habitat still listed")
      const stillReadable = await engine.readFile("cahs", "src/checksum.js")
      assert(stillReadable.includes("FNV-1a"), "surviving habitat lost its shared blob")
      engine.dispose()
      return `refs ${before} → ${after}, surviving habitat intact`
    },
  },
  {
    id: "iso-02",
    category: "Container isolation",
    name: "Reads outside the habitat head are refused",
    async run() {
      const engine = await NanoHabitatEngine.createEphemeral()
      let missingFile = false
      try {
        await engine.readFile("lattice", "src/does-not-exist.js")
      } catch {
        missingFile = true
      }
      assert(missingFile, "a non-existent path was served")
      let missingHabitat = false
      try {
        await engine.getHabitat("../../etc/passwd")
      } catch {
        missingHabitat = true
      }
      assert(missingHabitat, "a path-traversal habitat id resolved")
      engine.dispose()
      return "unknown paths and traversal ids both refused"
    },
  },
]

export interface SuiteSummary {
  results: TestResult[]
  passed: number
  failed: number
  totalMs: number
}

/** Run the full matrix. Never throws: a thrown case is reported as a failure. */
export async function runVerificationSuite(
  onProgress?: (result: TestResult, index: number, total: number) => void,
): Promise<SuiteSummary> {
  const results: TestResult[] = []
  const suiteStarted = Date.now()

  for (let index = 0; index < CASES.length; index++) {
    const testCase = CASES[index]
    const started = Date.now()
    let result: TestResult
    try {
      const detail = await testCase.run()
      result = {
        id: testCase.id,
        category: testCase.category,
        name: testCase.name,
        status: "pass",
        detail,
        ms: Date.now() - started,
      }
    } catch (error) {
      result = {
        id: testCase.id,
        category: testCase.category,
        name: testCase.name,
        status: "fail",
        detail: error instanceof Error ? error.message : String(error),
        ms: Date.now() - started,
      }
    }
    results.push(result)
    onProgress?.(result, index, CASES.length)
  }

  return {
    results,
    passed: results.filter((item) => item.status === "pass").length,
    failed: results.filter((item) => item.status === "fail").length,
    totalMs: Date.now() - suiteStarted,
  }
}

export const TEST_COUNT = CASES.length
