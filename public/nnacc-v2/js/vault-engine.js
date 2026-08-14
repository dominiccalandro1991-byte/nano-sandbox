/**
 * vault-engine.js — Gigabyte-scale IndexedDB File Vault + volatile-mode mitigation
 *
 * CONNECTIVITY MAP
 * ----------------
 * Aligns NNACC V2 client vault with project BINARY_STORES policy:
 * large file text / blobs → IndexedDB only; session metadata stays on localStorage.
 * DB name: nnacc_vault_db  (object store: files)
 * Memory-mode: when persist denied / IDB unavailable, queue encrypted blobs to
 * backend POST /nase/vault-sync (ephemeral store) when Remote URL is configured.
 *
 * Evidence class: Partially Verified
 *   - IndexedDB open/put/get/delete: standard IDB API.
 *   - navigator.storage.persist() / estimate(): best-effort; private mode often denies.
 *   - Backend vault-sync: ephemeral in-process store (test_nase_attestation.py);
 *     not durable multi-tenant storage. Client "encryption" here is Web Crypto
 *     AES-GCM with a session-ephemeral key (not end-to-end identity crypto).
 *   - Residual: private-mode still loses data on tab close if remote is offline.
 */

(function (global) {
  "use strict";

  const DB_NAME = "nnacc_vault_db";
  const DB_VERSION = 1;
  const STORE = "files";

  let db = null;
  const memoryFallback = new Map();
  let backend = "pending";
  let persistGranted = false;
  let volatile = false;
  let remoteBase = null;
  let onVolatile = null;
  const syncQueue = [];
  let sessionKeyPromise = null;

  function openDb() {
    return new Promise(function (resolve) {
      if (typeof indexedDB === "undefined") {
        backend = "memory";
        volatile = true;
        resolve(null);
        return;
      }
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = function () {
        const database = req.result;
        if (!database.objectStoreNames.contains(STORE)) {
          database.createObjectStore(STORE, { keyPath: "id" });
        }
      };
      req.onsuccess = function () {
        db = req.result;
        backend = "indexeddb";
        resolve(db);
      };
      req.onerror = function () {
        backend = "memory";
        volatile = true;
        resolve(null);
      };
    });
  }

  async function ensureDb() {
    if (backend === "pending") await openDb();
    return db;
  }

  async function evaluateStorageQuota() {
    const result = {
      persistGranted: false,
      persisted: false,
      volatile: false,
      quota: 0,
      usage: 0,
      backend: backend,
    };
    try {
      if (navigator.storage && navigator.storage.persist) {
        result.persistGranted = await navigator.storage.persist();
        persistGranted = result.persistGranted;
      }
      if (navigator.storage && navigator.storage.persisted) {
        result.persisted = await navigator.storage.persisted();
      }
      if (navigator.storage && navigator.storage.estimate) {
        const est = await navigator.storage.estimate();
        result.quota = est.quota || 0;
        result.usage = est.usage || 0;
      }
    } catch (e) {
      result.volatile = true;
    }
    await ensureDb();
    result.backend = backend;
    if (backend === "memory") {
      result.volatile = true;
      volatile = true;
    }
    if (result.volatile && typeof onVolatile === "function") {
      onVolatile(result);
    }
    return result;
  }

  function setRemoteBase(url) {
    remoteBase = url ? String(url).replace(/\/+$/, "") : null;
  }

  function setVolatileHandler(fn) {
    onVolatile = typeof fn === "function" ? fn : null;
  }

  async function getSessionKey() {
    if (sessionKeyPromise) return sessionKeyPromise;
    sessionKeyPromise = (async function () {
      return crypto.subtle.generateKey(
        { name: "AES-GCM", length: 256 },
        true,
        ["encrypt", "decrypt"]
      );
    })();
    return sessionKeyPromise;
  }

  async function encryptText(text) {
    const key = await getSessionKey();
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ct = await crypto.subtle.encrypt(
      { name: "AES-GCM", iv: iv },
      key,
      new TextEncoder().encode(text || "")
    );
    const packed = new Uint8Array(iv.length + ct.byteLength);
    packed.set(iv, 0);
    packed.set(new Uint8Array(ct), iv.length);
    let bin = "";
    packed.forEach(function (b) { bin += String.fromCharCode(b); });
    return btoa(bin);
  }

  async function sha256Hex(str) {
    const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(str || ""));
    return Array.from(new Uint8Array(buf)).map(function (b) {
      return b.toString(16).padStart(2, "0");
    }).join("");
  }

  async function syncToBackend(entry) {
    if (!remoteBase) return null;
    try {
      const cipher = await encryptText(entry.text || "");
      const hash = await sha256Hex(entry.text || "");
      const res = await fetch(remoteBase + "/nase/vault-sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ciphertext_b64: cipher,
          content_hash: hash,
          session_hint: entry.id,
        }),
      });
      if (!res.ok) throw new Error("vault-sync HTTP " + res.status);
      return await res.json();
    } catch (err) {
      syncQueue.push({ id: entry.id, error: String(err && err.message || err), at: Date.now() });
      if (syncQueue.length > 50) syncQueue.shift();
      return null;
    }
  }

  async function putFile(entry) {
    if (!entry || !entry.id) return false;
    await ensureDb();
    await evaluateStorageQuota();
    const record = {
      id: entry.id,
      name: entry.name || "untitled",
      type: entry.type || "text/plain",
      size: entry.size != null ? entry.size : (entry.text ? entry.text.length : 0),
      text: entry.text || "",
      ingestedAt: entry.ingestedAt || Date.now(),
    };
    let ok = false;
    if (backend === "indexeddb" && db) {
      ok = await new Promise(function (resolve) {
        try {
          const tx = db.transaction(STORE, "readwrite");
          tx.objectStore(STORE).put(record);
          tx.oncomplete = function () { resolve(true); };
          tx.onerror = function () { resolve(false); };
        } catch (e) {
          resolve(false);
        }
      });
    }
    if (!ok) {
      memoryFallback.set(record.id, record.text);
      volatile = true;
      backend = backend === "indexeddb" ? "hybrid-memory" : "memory";
      if (typeof onVolatile === "function") {
        onVolatile({ volatile: true, backend: backend, reason: "idb-put-failed-or-memory" });
      }
      await syncToBackend(record);
      return true;
    }
    return true;
  }

  async function getFile(id) {
    if (!id) return null;
    await ensureDb();
    if (backend === "indexeddb" && db) {
      const fromIdb = await new Promise(function (resolve) {
        try {
          const tx = db.transaction(STORE, "readonly");
          const req = tx.objectStore(STORE).get(id);
          req.onsuccess = function () { resolve(req.result || null); };
          req.onerror = function () { resolve(null); };
        } catch (e) {
          resolve(null);
        }
      });
      if (fromIdb) return fromIdb;
    }
    if (memoryFallback.has(id)) {
      return { id: id, text: memoryFallback.get(id), name: "memory" };
    }
    return null;
  }

  async function deleteFile(id) {
    if (!id) return;
    await ensureDb();
    memoryFallback.delete(id);
    if (backend === "indexeddb" && db) {
      await new Promise(function (resolve) {
        try {
          const tx = db.transaction(STORE, "readwrite");
          tx.objectStore(STORE).delete(id);
          tx.oncomplete = function () { resolve(); };
          tx.onerror = function () { resolve(); };
        } catch (e) {
          resolve();
        }
      });
    }
  }

  async function estimate() {
    const q = await evaluateStorageQuota();
    return {
      quota: q.quota,
      usage: q.usage,
      quotaGB: q.quota ? +(q.quota / 1e9).toFixed(3) : null,
      usageGB: q.usage ? +(q.usage / 1e9).toFixed(3) : null,
      backend: backend,
      volatile: volatile || q.volatile,
      persistGranted: persistGranted || q.persistGranted,
      persisted: q.persisted,
    };
  }

  ensureDb().then(function () { return evaluateStorageQuota(); });

  global.VaultEngine = {
    putFile: putFile,
    getFile: getFile,
    deleteFile: deleteFile,
    estimate: estimate,
    ensureDb: ensureDb,
    evaluateStorageQuota: evaluateStorageQuota,
    setRemoteBase: setRemoteBase,
    setVolatileHandler: setVolatileHandler,
    getBackend: function () { return backend; },
    isVolatile: function () { return volatile; },
    getSyncQueue: function () { return syncQueue.slice(); },
    DB_NAME: DB_NAME,
  };
})(typeof window !== "undefined" ? window : globalThis);
