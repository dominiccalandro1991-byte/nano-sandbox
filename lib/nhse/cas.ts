/**
 * Content-Addressable Hierarchical Store (CAHS).
 *
 * Invariants (model-checkable):
 *   I1. record.hash === SHA256(raw bytes of the payload it stores.
 *   I2. Writing identical content twice never allocates new physical bytes;
 *       it only increments the reference count (global deduplication).
 *   I3. Integrity verification is pure hash equality — no side channel.
 *
 * Complexity: putBlob/getBlob/putObject/getObject are O(n) in payload size for
 * hashing and O(1) in store size. Stats aggregation is O(B) over unique blobs.
 */

import { canonicalJson, sha256Hex } from "./hash"
import { compressText, decompressText, groupTokenFor } from "./codec"
import { STORE, type Storage } from "./storage"
import type { BlobRecord, CasStats, CommitObject, Hash, NhseObject, ObjectRecord, TreeObject } from "./types"

export interface PutBlobResult {
  hash: Hash
  deduplicated: boolean
  rawSize: number
  storedSize: number
}

export class ContentStore {
  constructor(private readonly storage: Storage) {}

  /** Store a text payload. Returns the address and whether dedup absorbed it. */
  async putBlob(text: string, path: string): Promise<PutBlobResult> {
    const hash = await sha256Hex(text)
    const existing = await this.storage.get<BlobRecord>(STORE.blobs, hash)
    if (existing) {
      const updated: BlobRecord = { ...existing, refs: existing.refs + 1 }
      await this.storage.put(STORE.blobs, hash, updated)
      return { hash, deduplicated: true, rawSize: existing.rawSize, storedSize: existing.storedSize }
    }
    const packed = await compressText(text, groupTokenFor(path))
    const record: BlobRecord = {
      hash,
      codec: packed.codec,
      data: packed.data,
      rawSize: packed.rawSize,
      storedSize: packed.storedSize,
      refs: 1,
      firstSeen: Date.now(),
    }
    await this.storage.put(STORE.blobs, hash, record)
    return { hash, deduplicated: false, rawSize: packed.rawSize, storedSize: packed.storedSize }
  }

  async getBlobRecord(hash: Hash): Promise<BlobRecord | undefined> {
    return this.storage.get<BlobRecord>(STORE.blobs, hash)
  }

  /** Materialize a blob to text and verify its content address. */
  async getText(hash: Hash): Promise<string> {
    const record = await this.getBlobRecord(hash)
    if (!record) throw new Error(`CAHS miss: object ${hash.slice(0, 12)} is not present in the container`)
    const text = await decompressText(record.data, record.codec)
    const actual = await sha256Hex(text)
    if (actual !== hash) {
      throw new Error(`CAHS integrity failure: ${hash.slice(0, 12)} decoded to ${actual.slice(0, 12)}`)
    }
    return text
  }

  /** Decrement a reference. Physical bytes are reclaimed at zero refs. */
  async releaseBlob(hash: Hash): Promise<void> {
    const record = await this.getBlobRecord(hash)
    if (!record) return
    if (record.refs <= 1) {
      await this.storage.delete(STORE.blobs, hash)
      return
    }
    await this.storage.put(STORE.blobs, hash, { ...record, refs: record.refs - 1 })
  }

  async putObject(object: NhseObject): Promise<Hash> {
    const json = canonicalJson(object)
    const hash = await sha256Hex(json)
    const record: ObjectRecord = { hash, kind: object.kind, json }
    await this.storage.put(STORE.objects, hash, record)
    return hash
  }

  async getObject<T extends NhseObject>(hash: Hash): Promise<T> {
    const record = await this.storage.get<ObjectRecord>(STORE.objects, hash)
    if (!record) throw new Error(`DAG miss: object ${hash.slice(0, 12)} is not present in the container`)
    const actual = await sha256Hex(record.json)
    if (actual !== hash) throw new Error(`DAG integrity failure at ${hash.slice(0, 12)}`)
    return JSON.parse(record.json) as T
  }

  async getTree(hash: Hash): Promise<TreeObject> {
    return this.getObject<TreeObject>(hash)
  }

  async getCommit(hash: Hash): Promise<CommitObject> {
    return this.getObject<CommitObject>(hash)
  }

  async allObjects(): Promise<ObjectRecord[]> {
    return this.storage.getAll<ObjectRecord>(STORE.objects)
  }

  async allBlobs(): Promise<BlobRecord[]> {
    return this.storage.getAll<BlobRecord>(STORE.blobs)
  }

  /** Import a raw record without recompressing. Verifies the address first. */
  async adoptBlob(record: BlobRecord): Promise<void> {
    const text = await decompressText(record.data, record.codec)
    const actual = await sha256Hex(text)
    if (actual !== record.hash) throw new Error("Refusing to adopt blob with mismatched content address")
    const existing = await this.getBlobRecord(record.hash)
    if (existing) {
      await this.storage.put(STORE.blobs, record.hash, { ...existing, refs: existing.refs + record.refs })
      return
    }
    await this.storage.put(STORE.blobs, record.hash, record)
  }

  async adoptObject(hash: Hash, json: string, kind: NhseObject["kind"]): Promise<void> {
    const actual = await sha256Hex(json)
    if (actual !== hash) throw new Error("Refusing to adopt DAG object with mismatched content address")
    const record: ObjectRecord = { hash, kind, json }
    await this.storage.put(STORE.objects, hash, record)
  }

  async stats(): Promise<CasStats> {
    const blobs = await this.allBlobs()
    let uniqueRawBytes = 0
    let physicalBytes = 0
    let logicalBytes = 0
    for (const blob of blobs) {
      uniqueRawBytes += blob.rawSize
      physicalBytes += blob.storedSize
      logicalBytes += blob.rawSize * Math.max(1, blob.refs)
    }
    const objectCount = await this.storage.count(STORE.objects)
    return {
      blobCount: blobs.length,
      objectCount,
      uniqueRawBytes,
      physicalBytes,
      logicalBytes,
      dedupSavedBytes: Math.max(0, logicalBytes - uniqueRawBytes),
    }
  }

  /** Full-store verification sweep: re-hash every blob and DAG object. */
  async verifyAll(): Promise<{ checked: number; corrupted: Hash[] }> {
    const corrupted: Hash[] = []
    const blobs = await this.allBlobs()
    for (const blob of blobs) {
      try {
        const text = await decompressText(blob.data, blob.codec)
        if ((await sha256Hex(text)) !== blob.hash) corrupted.push(blob.hash)
      } catch {
        corrupted.push(blob.hash)
      }
    }
    const objects = await this.allObjects()
    for (const object of objects) {
      if ((await sha256Hex(object.json)) !== object.hash) corrupted.push(object.hash)
    }
    return { checked: blobs.length + objects.length, corrupted }
  }
}
