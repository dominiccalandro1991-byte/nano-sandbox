/**
 * Container-local persistence. All I/O is confined to the origin's own
 * IndexedDB database, mirroring the iOS App Sandbox container invariant: the
 * engine never reads or writes outside its own store.
 *
 * A complete in-memory backend is used when IndexedDB is unavailable (SSR,
 * private-mode WebKit quirks). The API surface is identical, so the engine and
 * every test keeps working with zero branching at the call sites.
 *
 * ROUTING (P0 fix): STORE.blobs and STORE.objects are routed exclusively
 * through IndexedDB. STORE.habitats, STORE.predictor and STORE.meta remain on
 * localStorage. This prevents binary diagnostic media from hitting the
 * localStorage size/quota bottleneck.
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

/** Stores that MUST use IndexedDB (binary / large diagnostic media). */
const BINARY_STORES = new Set<StoreName>([STORE.blobs, STORE.objects])

/**
 * Storage: NOTE the added `persistent` flag so higher layers can detect a
 * degraded/in-memory backend and surface warnings or force export.
 */
export interface Storage {
  readonly backend: "indexeddb" | "memory" | "localstorage" | "hybrid"
  readonly persistent: boolean
  get<T>(store: StoreName, key: string): Promise<T | undefined>
  put(store: StoreName, key: string, value: unknown): Promise<void>
  putMany(store: StoreName, entries: { key: string; value: unknown }[]): Promise<void>
  delete(store: StoreName, key: string): Promise<void>
  getAll<T>(store: StoreName): Promise<T[]>
  count(store: StoreName): Promise<number>
  clearAll(): Promise<void>
}

/**
 * LocalStorage adapter — synchronous but wrapped to the Storage interface.
 * Use only for small metadata and small payloads; localStorage has per-origin
 * size limits and may throw on quota exceeded.
 */
function createLocalStorage(): Storage {
  // probe use of localStorage to fail fast in hostile/opaque origins.
  try {
    if (typeof localStorage === "undefined") throw new Error("localStorage unavailable")
    localStorage.setItem("__nhse_probe", "1")
    localStorage.removeItem("__nhse_probe")
  } catch {
    throw new Error("localStorage unavailable")
  }

  const keyFor = (store: StoreName, key: string) => `${DB_NAME}:${store}:${key}`

  return {
    backend: "localstorage",
    persistent: true,
    async get<T>(_store: StoreName, key: string) {
      try {
        const raw = localStorage.getItem(keyFor(_store, key))
        return raw ? (JSON.parse(raw) as T) : undefined
      } catch {
        // localStorage can throw for quota/security — surface as unavailable to caller
        throw new Error("localStorage read failed")
      }
    },
    async put(_store: StoreName, key: string, value: unknown) {
      try {
        localStorage.setItem(keyFor(_store, key), JSON.stringify(value))
      } catch {
        throw new Error("localStorage write failed")
      }
    },
    async putMany(_store: StoreName, entries: { key: string; value: unknown }[]) {
      try {
        for (const entry of entries) localStorage.setItem(keyFor(_store, entry.key), JSON.stringify(entry.value))
      } catch {
        throw new Error("localStorage writeMany failed")
      }
    },
    async delete(_store: StoreName, key: string) {
      try {
        localStorage.removeItem(keyFor(_store, key))
      } catch {
        // no-op
      }
    },
    async getAll<T>(_store: StoreName) {
      const prefix = `${DB_NAME}:${_store}:`
      const out: T[] = []
      try {
        for (let i = 0; i < localStorage.length; i++) {
          const k = localStorage.key(i)
          if (!k) continue
          if (k.startsWith(prefix)) {
            const raw = localStorage.getItem(k)
            if (raw) out.push(JSON.parse(raw) as T)
          }
        }
      } catch {
        throw new Error("localStorage getAll failed")
      }
      return out
    },
    async count(_store: StoreName) {
      const prefix = `${DB_NAME}:${_store}:`
      let c = 0
      try {
        for (let i = 0; i < localStorage.length; i++) {
          const k = localStorage.key(i)
          if (k && k.startsWith(prefix)) c++
        }
      } catch {
        throw new Error("localStorage count failed")
      }
      return c
    },
    async clearAll() {
      const prefix = `${DB_NAME}:`
      const toRemove: string[] = []
      try {
        for (let i = 0; i < localStorage.length; i++) {
          const k = localStorage.key(i)
          if (k && k.startsWith(prefix)) toRemove.push(k)
        }
        for (const k of toRemove) localStorage.removeItem(k)
      } catch {
        throw new Error("localStorage clearAll failed")
      }
    },
  }
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
    persistent: false,
    async get<T>(store: StoreName, key: string) {
      return table(store).get(key) as T | undefined
    },
    async put(store: StoreName, key: string, value: unknown) {
      table(store).set(key, value)
    },
    async putMany(store: StoreName, entries: { key: string; value: unknown }[]) {
      for (const entry of entries) table(store).set(entry.key, entry.value)
    },
    async delete(store: StoreName, key: string) {
      table(store).delete(key)
    },
    async getAll<T>(store: StoreName) {
      return Array.from(table(store).values()) as T[]
    },
    async count(store: StoreName) {
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
    persistent: true,
    get<T>(store: StoreName, key: string) {
      return run(store, "readonly", (os) => requestToPromise(os.get(key) as IDBRequest<T | undefined>))
    },
    put(store: StoreName, key: string, value: unknown) {
      return run(store, "readwrite", (os) => {
        os.put(value, key)
      })
    },
    putMany(store: StoreName, entries: { key: string; value: unknown }[]) {
      return run(store, "readwrite", (os) => {
        for (const entry of entries) os.put(entry.value, entry.key)
      })
    },
    delete(store: StoreName, key: string) {
      return run(store, "readwrite", (os) => {
        os.delete(key)
      })
    },
    getAll<T>(store: StoreName) {
      return run(store, "readonly", (os) => requestToPromise(os.getAll() as IDBRequest<T[]>))
    },
    count(store: StoreName) {
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

/**
 * Hybrid storage: blobs + objects → IndexedDB; habitats + predictor + meta → localStorage.
 * Satisfies the P0 routing requirement so binary diagnostic media never touch localStorage.
 */
function createHybridStorage(idb: Storage, ls: Storage): Storage {
  const route = (store: StoreName): Storage => (BINARY_STORES.has(store) ? idb : ls)

  return {
    backend: "hybrid",
    persistent: true,
    get<T>(store: StoreName, key: string) {
      return route(store).get<T>(store, key)
    },
    put(store: StoreName, key: string, value: unknown) {
      return route(store).put(store, key, value)
    },
    putMany(store: StoreName, entries: { key: string; value: unknown }[]) {
      return route(store).putMany(store, entries)
    },
    delete(store: StoreName, key: string) {
      return route(store).delete(store, key)
    },
    getAll<T>(store: StoreName) {
      return route(store).getAll<T>(store)
    },
    count(store: StoreName) {
      return route(store).count(store)
    },
    async clearAll() {
      // Clear both backends so residual keys cannot leak across routes.
      await Promise.all([idb.clearAll(), ls.clearAll()])
    },
  }
}

/** Resolve the strongest available container-local backend. Never throws. */
export async function createStorage(): Promise<Storage> {
  let idb: Storage | null = null
  let ls: Storage | null = null

  // Prefer localStorage for the three metadata stores (habitats / predictor / meta).
  try {
    ls = createLocalStorage()
  } catch {
    // fall through
  }

  // Prefer IndexedDB exclusively for blobs + objects (binary diagnostic media).
  if (typeof indexedDB !== "undefined") {
    try {
      const TIMEOUT_MS = 2000
      const db = await Promise.race([
        openDatabase(),
        new Promise<IDBDatabase>((_, reject) =>
          setTimeout(() => reject(new Error("IndexedDB open timed out")), TIMEOUT_MS),
        ),
      ])
      idb = createIdbStorage(db)
    } catch {
      // fall through
    }
  }

  if (idb && ls) {
    return createHybridStorage(idb, ls)
  }

  // Degraded paths: if only one backend is available, use it for everything
  // (still better than pure memory). Callers can inspect .backend / .persistent.
  if (idb) return idb
  if (ls) return ls

  // Last resort: in-memory store
  return createMemoryStorage()
}

export { createMemoryStorage }
