/**
 * vault-engine.js — Gigabyte-scale IndexedDB File Vault
 *
 * CONNECTIVITY MAP
 * ----------------
 * Aligns NNACC V2 client vault with project BINARY_STORES policy:
 * large file text / blobs → IndexedDB only; session metadata stays on localStorage.
 * DB name: nnacc_vault_db  (object store: files)
 * Invokes navigator.storage.persist() once on init to request durable quota.
 *
 * Evidence class: Partially Verified
 *   - IndexedDB open/put/get/delete implemented against standard IDB API.
 *   - navigator.storage.persist() and estimate() are best-effort; browser may deny.
 *   - Migration of pre-existing localStorage-embedded file.text is opportunistic
 *     (read-through); full bulk migration not automatic.
 *   - Residual: private-mode / Safari ITP may still quota-limit; in-memory fallback
 *     keeps API alive but is not GB-scale.
 */

(function (global) {
  "use strict";

  const DB_NAME = "nnacc_vault_db";
  const DB_VERSION = 1;
  const STORE = "files";

  /** @type {IDBDatabase|null} */
  let db = null;
  /** @type {Map<string, string>} */
  const memoryFallback = new Map();
  let backend = "pending";
  let persistRequested = false;

  function openDb() {
    return new Promise((resolve, reject) => {
      if (typeof indexedDB === "undefined") {
        backend = "memory";
        resolve(null);
        return;
      }
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const database = req.result;
        if (!database.objectStoreNames.contains(STORE)) {
          database.createObjectStore(STORE, { keyPath: "id" });
        }
      };
      req.onsuccess = () => {
        db = req.result;
        backend = "indexeddb";
        resolve(db);
      };
      req.onerror = () => {
        backend = "memory";
        resolve(null);
      };
    });
  }

  async function ensureDb() {
    if (backend === "pending") await openDb();
    return db;
  }

  async function requestPersist() {
    if (persistRequested) return;
    persistRequested = true;
    try {
      if (navigator.storage && navigator.storage.persist) {
        await navigator.storage.persist();
      }
    } catch {
      /* non-fatal */
    }
  }

  /**
   * Put full text payload under file id. Returns true on success.
   */
  async function putFile(entry) {
    if (!entry || !entry.id) return false;
    await ensureDb();
    await requestPersist();
    const record = {
      id: entry.id,
      name: entry.name || "untitled",
      type: entry.type || "text/plain",
      size: entry.size != null ? entry.size : (entry.text ? entry.text.length : 0),
      text: entry.text || "",
      ingestedAt: entry.ingestedAt || Date.now(),
    };
    if (backend === "indexeddb" && db) {
      return new Promise((resolve) => {
        try {
          const tx = db.transaction(STORE, "readwrite");
          tx.objectStore(STORE).put(record);
          tx.oncomplete = () => resolve(true);
          tx.onerror = () => {
            memoryFallback.set(record.id, record.text);
            resolve(false);
          };
        } catch {
          memoryFallback.set(record.id, record.text);
          resolve(false);
        }
      });
    }
    memoryFallback.set(record.id, record.text);
    return true;
  }

  async function getFile(id) {
    if (!id) return null;
    await ensureDb();
    if (backend === "indexeddb" && db) {
      return new Promise((resolve) => {
        try {
          const tx = db.transaction(STORE, "readonly");
          const req = tx.objectStore(STORE).get(id);
          req.onsuccess = () => {
            const v = req.result || null;
            if (v) resolve(v);
            else if (memoryFallback.has(id)) {
              resolve({ id, text: memoryFallback.get(id), name: "memory" });
            } else resolve(null);
          };
          req.onerror = () => {
            if (memoryFallback.has(id)) resolve({ id, text: memoryFallback.get(id) });
            else resolve(null);
          };
        } catch {
          if (memoryFallback.has(id)) resolve({ id, text: memoryFallback.get(id) });
          else resolve(null);
        }
      });
    }
    if (memoryFallback.has(id)) return { id, text: memoryFallback.get(id) };
    return null;
  }

  async function deleteFile(id) {
    if (!id) return;
    await ensureDb();
    memoryFallback.delete(id);
    if (backend === "indexeddb" && db) {
      return new Promise((resolve) => {
        try {
          const tx = db.transaction(STORE, "readwrite");
          tx.objectStore(STORE).delete(id);
          tx.oncomplete = () => resolve();
          tx.onerror = () => resolve();
        } catch {
          resolve();
        }
      });
    }
  }

  async function estimate() {
    try {
      if (navigator.storage && navigator.storage.estimate) {
        const e = await navigator.storage.estimate();
        return {
          quota: e.quota || 0,
          usage: e.usage || 0,
          quotaGB: e.quota != null ? +(e.quota / 1e9).toFixed(3) : null,
          usageGB: e.usage != null ? +(e.usage / 1e9).toFixed(3) : null,
          backend,
        };
      }
    } catch {
      /* fall through */
    }
    return { quota: 0, usage: 0, quotaGB: null, usageGB: null, backend };
  }

  // Eager open + persist request
  ensureDb().then(() => requestPersist());

  global.VaultEngine = {
    putFile,
    getFile,
    deleteFile,
    estimate,
    ensureDb,
    requestPersist,
    getBackend: () => backend,
    DB_NAME,
  };
})(typeof window !== "undefined" ? window : globalThis);
