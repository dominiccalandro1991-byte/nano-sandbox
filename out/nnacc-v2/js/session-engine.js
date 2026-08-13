/**
 * session-engine.js — Multi-Thread Session Manager + File Vault
 *
 * CONNECTIVITY MAP
 * ----------------
 * Engine 25 (NNACC) : owns active thread surface
 * FileVault         : full payloads kept out of chat stream; badge-only in feed
 * Persistence       : session meta on localStorage (nnacc_session_* + index);
 *                     file text/blobs via VaultEngine → IndexedDB nnacc_vault_db
 *                     (aligns with project BINARY_STORES policy)
 * NASE / I5         : mutations still gated by ui-controller.js
 *
 * Evidence class: Partially Verified
 *   - Meta + index remain on localStorage (small documents).
 *   - Full file text routed to VaultEngine / IndexedDB when available.
 *   - Legacy sessions that still embed .text in localStorage are read-through
 *     and optionally migrated on getFile.
 *   - Residual: browser may deny storage.persist(); private modes may fall
 *     back to memory Map (not GB-scale).
 */

(function (global) {
  "use strict";

  const INDEX_KEY = "nnacc_session_index";
  const ACTIVE_KEY = "nnacc_active_session";
  const PREFIX = "nnacc_session_";

  function now() {
    return Date.now();
  }

  function makeId() {
    return PREFIX + now() + "_" + Math.random().toString(36).slice(2, 8);
  }

  function readIndex() {
    try {
      const raw = localStorage.getItem(INDEX_KEY);
      if (!raw) return [];
      const list = JSON.parse(raw);
      return Array.isArray(list) ? list : [];
    } catch {
      return [];
    }
  }

  function writeIndex(list) {
    try {
      localStorage.setItem(INDEX_KEY, JSON.stringify(list));
    } catch {
      /* quota */
    }
  }

  function readSession(id) {
    try {
      const raw = localStorage.getItem(id);
      if (!raw) return null;
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }

  /**
   * Persist session meta only. Strip large text from files[] before write
   * to avoid localStorage quota; text lives in IndexedDB via VaultEngine.
   */
  function writeSession(session) {
    if (!session || !session.id) return false;
    try {
      session.updatedAt = now();
      // Shallow clone files without full text for LS
      const toStore = Object.assign({}, session);
      if (Array.isArray(session.files)) {
        toStore.files = session.files.map(function (f) {
          return {
            id: f.id,
            name: f.name,
            type: f.type,
            size: f.size,
            ingestedAt: f.ingestedAt,
            // text intentionally omitted from localStorage
            hasText: !!(f.text || f.hasText),
          };
        });
      }
      localStorage.setItem(session.id, JSON.stringify(toStore));
      const index = readIndex().filter(function (e) {
        return e.id !== session.id;
      });
      index.unshift({
        id: session.id,
        title: session.title || "Untitled chat",
        updatedAt: session.updatedAt,
        createdAt: session.createdAt,
        messageCount: (session.messages || []).filter(function (m) {
          return m.role !== "system";
        }).length,
        fileCount: (session.files || []).length,
      });
      writeIndex(index.slice(0, 40));
      return true;
    } catch {
      return false;
    }
  }

  function createSession(opts) {
    const id = makeId();
    const session = {
      id: id,
      title: (opts && opts.title) || "New chat",
      createdAt: now(),
      updatedAt: now(),
      messages: [],
      files: [],
      pendingUssePayload: null,
    };
    writeSession(session);
    setActiveSessionId(id);
    return session;
  }

  function listSessions() {
    return readIndex();
  }

  function getActiveSessionId() {
    try {
      return localStorage.getItem(ACTIVE_KEY) || null;
    } catch {
      return null;
    }
  }

  function setActiveSessionId(id) {
    try {
      if (id) localStorage.setItem(ACTIVE_KEY, id);
      else localStorage.removeItem(ACTIVE_KEY);
    } catch {
      /* ignore */
    }
  }

  function loadOrCreateActive() {
    const id = getActiveSessionId();
    if (id) {
      const s = readSession(id);
      if (s) return s;
    }
    const index = readIndex();
    if (index.length) {
      const s = readSession(index[0].id);
      if (s) {
        setActiveSessionId(s.id);
        return s;
      }
    }
    return createSession({ title: "New chat" });
  }

  function deleteSession(id) {
    try {
      localStorage.removeItem(id);
    } catch {
      /* ignore */
    }
    // Best-effort: remove associated vault files if VaultEngine present
    try {
      const s = readSession(id);
      if (s && Array.isArray(s.files) && global.VaultEngine) {
        s.files.forEach(function (f) {
          if (f && f.id) global.VaultEngine.deleteFile(f.id);
        });
      }
    } catch {
      /* ignore */
    }
    const index = readIndex().filter(function (e) {
      return e.id !== id;
    });
    writeIndex(index);
    if (getActiveSessionId() === id) {
      if (index.length) setActiveSessionId(index[0].id);
      else setActiveSessionId(null);
    }
  }

  function deriveTitle(session) {
    if (!session) return "Untitled chat";
    const firstUser = (session.messages || []).find(function (m) {
      return m.role === "user" && m.kind !== "file-badge";
    });
    if (firstUser && firstUser.text) {
      const t = firstUser.text.trim().replace(/\s+/g, " ");
      return t.length > 48 ? t.slice(0, 45) + "…" : t;
    }
    if (session.files && session.files.length) {
      return "📎 " + session.files[0].name;
    }
    return session.title || "New chat";
  }

  function autoTitle(session) {
    const title = deriveTitle(session);
    if (title && title !== session.title) {
      session.title = title;
      writeSession(session);
    }
    return title;
  }

  /**
   * Store full file payload: meta in session, text in VaultEngine (IDB).
   * Returns vault entry (with text still attached in-memory for immediate use).
   */
  function addFileToVault(session, opts) {
    if (!session) return null;
    const name = (opts && opts.name) || "untitled";
    const text = (opts && opts.text) || "";
    const type = (opts && opts.type) || "text/plain";
    const size = opts && opts.size != null ? opts.size : text.length;
    const entry = {
      id: "file_" + now() + "_" + Math.random().toString(36).slice(2, 7),
      name: name,
      type: type,
      size: size,
      text: text,
      ingestedAt: now(),
      hasText: true,
    };
    if (!session.files) session.files = [];
    session.files.push(entry);
    writeSession(session);
    // Async IDB write (fire-and-forget; in-memory entry remains usable)
    if (global.VaultEngine && typeof global.VaultEngine.putFile === "function") {
      global.VaultEngine.putFile(entry).catch(function () {
        /* residual: write failed; text still in current session object */
      });
    }
    return entry;
  }

  /**
   * Resolve file, preferring in-memory text then IndexedDB then legacy LS text.
   */
  async function getFileAsync(session, fileId) {
    if (!session || !session.files) return null;
    const meta = session.files.find(function (f) {
      return f.id === fileId;
    });
    if (!meta) return null;
    if (meta.text) return meta;
    if (global.VaultEngine && typeof global.VaultEngine.getFile === "function") {
      const fromIdb = await global.VaultEngine.getFile(fileId);
      if (fromIdb && fromIdb.text != null) {
        meta.text = fromIdb.text;
        return meta;
      }
    }
    return meta;
  }

  function getFile(session, fileId) {
    if (!session || !session.files) return null;
    return (
      session.files.find(function (f) {
        return f.id === fileId;
      }) || null
    );
  }

  function listFiles(session) {
    return (session && session.files) || [];
  }

  function removeFile(session, fileId) {
    if (!session || !session.files) return;
    session.files = session.files.filter(function (f) {
      return f.id !== fileId;
    });
    writeSession(session);
    if (global.VaultEngine && typeof global.VaultEngine.deleteFile === "function") {
      global.VaultEngine.deleteFile(fileId);
    }
  }

  global.SessionEngine = {
    createSession: createSession,
    listSessions: listSessions,
    loadSession: readSession,
    saveSession: writeSession,
    deleteSession: deleteSession,
    getActiveSessionId: getActiveSessionId,
    setActiveSessionId: setActiveSessionId,
    loadOrCreateActive: loadOrCreateActive,
    deriveTitle: deriveTitle,
    autoTitle: autoTitle,
    addFileToVault: addFileToVault,
    getFile: getFile,
    getFileAsync: getFileAsync,
    listFiles: listFiles,
    removeFile: removeFile,
    PREFIX: PREFIX,
  };
})(typeof window !== "undefined" ? window : globalThis);
