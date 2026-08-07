/**
 * Habitat snapshot export/import.
 *
 * A snapshot is a single hash-chained package containing the habitat record,
 * every reachable DAG object (commits + trees), and every referenced blob in
 * its already-compressed form. The chain hash seals the package: any tampering
 * with a byte, an object, or the ordering is detected before a single record is
 * adopted into the container.
 */

import type { ContentStore } from "./cas"
import { canonicalJson, chainHash, sha256Hex } from "./hash"
import { base64ToBytes, bytesToBase64 } from "./codec"
import type { BlobRecord, CommitObject, EngineSnapshotPackage, Hash, HabitatRecord, TreeObject } from "./types"

async function collectReachable(cas: ContentStore, head: Hash | null) {
  const objects: Record<Hash, string> = {}
  const blobHashes = new Set<Hash>()
  let cursor = head
  const visited = new Set<Hash>()
  while (cursor && !visited.has(cursor)) {
    visited.add(cursor)
    const commit = await cas.getCommit(cursor)
    objects[cursor] = JSON.stringify(commit)
    const tree = await cas.getTree(commit.tree)
    objects[commit.tree] = JSON.stringify(tree)
    for (const hash of Object.values(tree.entries)) blobHashes.add(hash)
    cursor = commit.parent
  }
  return { objects, blobHashes }
}

/** Build a sealed, self-verifying snapshot package for one habitat. */
export async function buildSnapshot(cas: ContentStore, habitat: HabitatRecord): Promise<EngineSnapshotPackage> {
  const { objects, blobHashes } = await collectReachable(cas, habitat.head)
  const canonicalObjects: Record<Hash, string> = {}
  for (const hash of Object.keys(objects).sort()) {
    const parsed = JSON.parse(objects[hash]) as TreeObject | CommitObject
    const { hash: recomputed, json } = await hashObjectCanonical(parsed)
    if (recomputed !== hash) throw new Error(`Snapshot aborted: object ${hash.slice(0, 12)} failed re-hash`)
    canonicalObjects[hash] = json
  }

  const blobs: EngineSnapshotPackage["blobs"] = {}
  for (const hash of Array.from(blobHashes).sort()) {
    const record = await cas.getBlobRecord(hash)
    if (!record) throw new Error(`Snapshot aborted: blob ${hash.slice(0, 12)} missing from container`)
    blobs[hash] = { codec: record.codec, rawSize: record.rawSize, b64: bytesToBase64(record.data) }
  }

  const chain = await chainHash([
    ...Object.keys(canonicalObjects).sort(),
    ...Object.keys(blobs).sort(),
    habitat.id,
    String(habitat.head ?? "empty"),
  ])

  return {
    format: "nhse-habitat-snapshot",
    version: 1,
    exportedAt: Date.now(),
    habitat,
    objects: canonicalObjects,
    blobs,
    chain,
  }
}

async function hashObjectCanonical(value: TreeObject | CommitObject) {
  const json = canonicalJson(value)
  return { hash: await sha256Hex(json), json }
}

export function serializeSnapshot(snapshot: EngineSnapshotPackage): string {
  return JSON.stringify(snapshot)
}

export function parseSnapshot(text: string): EngineSnapshotPackage {
  const parsed = JSON.parse(text) as EngineSnapshotPackage
  if (parsed?.format !== "nhse-habitat-snapshot" || parsed.version !== 1) {
    throw new Error("Not a NanoHabitat snapshot package (version 1).")
  }
  if (!parsed.habitat || typeof parsed.habitat.id !== "string") {
    throw new Error("Snapshot package is missing its habitat record.")
  }
  return parsed
}

/** Verify the seal, then adopt every record. Throws before any write on error. */
export async function verifySnapshot(snapshot: EngineSnapshotPackage): Promise<void> {
  for (const [hash, json] of Object.entries(snapshot.objects)) {
    if ((await sha256Hex(json)) !== hash) {
      throw new Error(`Snapshot integrity failure: DAG object ${hash.slice(0, 12)} was altered.`)
    }
  }
  const expectedChain = await chainHash([
    ...Object.keys(snapshot.objects).sort(),
    ...Object.keys(snapshot.blobs).sort(),
    snapshot.habitat.id,
    String(snapshot.habitat.head ?? "empty"),
  ])
  if (expectedChain !== snapshot.chain) {
    throw new Error("Snapshot integrity failure: hash chain does not match the package contents.")
  }
}

export async function adoptSnapshot(
  cas: ContentStore,
  snapshot: EngineSnapshotPackage,
): Promise<{ objects: number; blobs: number }> {
  await verifySnapshot(snapshot)
  for (const [hash, json] of Object.entries(snapshot.objects)) {
    const parsed = JSON.parse(json) as TreeObject | CommitObject
    await cas.adoptObject(hash, json, parsed.kind)
  }
  for (const [hash, payload] of Object.entries(snapshot.blobs)) {
    const record: BlobRecord = {
      hash,
      codec: payload.codec,
      data: base64ToBytes(payload.b64),
      rawSize: payload.rawSize,
      storedSize: base64ToBytes(payload.b64).length,
      refs: 1,
      firstSeen: Date.now(),
    }
    await cas.adoptBlob(record)
  }
  return { objects: Object.keys(snapshot.objects).length, blobs: Object.keys(snapshot.blobs).length }
}
