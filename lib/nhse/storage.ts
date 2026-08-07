/**
 * Container-local persistence. All I/O is confined to the origin's own
 * IndexedDB database, mirroring the iOS App Sandbox container invariant: the
 * engine never reads or writes outside its own store.
 *
 * A complete in-memory backend is used when IndexedDB is unavailable (SSR,
 * private-mode WebKit quirks). The API surface is identical, so the engine and
 * every test keeps working with zero branching at the call sites.
 */

export const DB_NAME = "nhse-container"
export const DB_VERSION = 1

export const STORE = {
  blobs: "blobs",
  objects: "objects",
  habitats: "habitats",
  predictor: "predictor",
  meta: "meta",
} as const

export type StoreName = (typeof STORE)[keyof typeof STORE]

const ALL_STORES: StoreName[] = [STORE.blobs, STORE.objects, STORE.habitats, STORE.predictor, STORE.meta]

export interface Storage {
  readonly backend: "indexeddb" | "memory"
  get<T>(store: StoreName, key: string): Promise<T | undefined>
  put(store: StoreName, key: string, value: unknown): Promise<void>
  putMany(store: StoreName, entries: { key: string; value: unknown }[]): Promise<void>
  delete(store: StoreName, key: string): Promise<void>
  getAll<T>(store: StoreName): Promise<T[]>
  count(store: StoreName): Promise<number>
  clearAll(): Promise<void>
}

function createMemoryStorage(): Storage {
  const tables = new Map<StoreName, Map<string, unknown>>()
  for (const name of ALL_STORES) tables.set(name, new Map())
  const table = (name: StoreName) => {
    const found = tables.get(name)
    if (found) return found
    const created = new Map<string, unknown>()
    tables.set(name, created)
    return created
  }
  return {
    backend: "memory",
    async get<T>(store, key) {
      return table(store).get(key) as T | undefined
    },
    async put(store, key, value) {
      table(store).set(key, value)
    },
    async putMany(store, entries) {
      for (const entry of entries) table(store).set(entry.key, entry.value)
    },
    async delete(store, key) {
      table(store).delete(key)
    },
    async getAll<T>(store) {
      return Array.from(table(store).values()) as T[]
    },
    async count(store) {
      return table(store).size
    },
    async clearAll() {
      for (const name of ALL_STORES) table(name).clear()
    },
  }
}

function requestToPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error("IndexedDB request failed"))
  })
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION)
    request.onupgradeneeded = () => {
      const db = request.result
      for (const name of ALL_STORES) {
        if (!db.objectStoreNames.contains(name)) db.createObjectStore(name)
      }
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error("IndexedDB open failed"))
    request.onblocked = () => reject(new Error("IndexedDB open blocked by another tab"))
  })
}

function createIdbStorage(db: IDBDatabase): Storage {
  const run = <T>(store: StoreName, mode: IDBTransactionMode, fn: (os: IDBObjectStore) => Promise<T> | T) =>
    new Promise<T>((resolve, reject) => {
      let result: T
      let settled = false
      const tx = db.transaction(store, mode)
      tx.oncomplete = () => {
        if (!settled) {
          settled = true
          resolve(result)
        }
      }
      tx.onerror = () => {
        if (!settled) {
          settled = true
          reject(tx.error ?? new Error("IndexedDB transaction failed"))
        }
      }
      tx.onabort = () => {
        if (!settled) {
          settled = true
          reject(tx.error ?? new Error("IndexedDB transaction aborted"))
        }
      }
      Promise.resolve(fn(tx.objectStore(store)))
        .then((value) => {
          result = value
        })
        .catch((error) => {
          if (!settled) {
            settled = true
            reject(error)
          }
          try {
            tx.abort()
          } catch {
            // Transaction already finished.
          }
        })
    })

  return {
    backend: "indexeddb",
    get<T>(store, key) {
      return run(store, "readonly", (os) => requestToPromise(os.get(key) as IDBRequest<T | undefined>))
    },
    put(store, key, value) {
      return run(store, "readwrite", (os) => {
        os.put(value, key)
      })
    },
    putMany(store, entries) {
      return run(store, "readwrite", (os) => {
        for (const entry of entries) os.put(entry.value, entry.key)
      })
    },
    delete(store, key) {
      return run(store, "readwrite", (os) => {
        os.delete(key)
      })
    },
    getAll<T>(store) {
      return run(store, "readonly", (os) => requestToPromise(os.getAll() as IDBRequest<T[]>))
    },
    count(store) {
      return run(store, "readonly", (os) => requestToPromise(os.count()))
    },
    async clearAll() {
      for (const name of ALL_STORES) {
        await run(name, "readwrite", (os) => {
          os.clear()
        })
      }
    },
  }
}

/** Resolve the strongest available container-local backend. Never throws. */
export async function createStorage(): Promise<Storage> {
  if (typeof indexedDB === "undefined") return createMemoryStorage()
  try {
    const db = await openDatabase()
    return createIdbStorage(db)
  } catch {
    return createMemoryStorage()
  }
}

export { createMemoryStorage }
