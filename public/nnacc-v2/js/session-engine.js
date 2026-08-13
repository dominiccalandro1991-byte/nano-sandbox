/**
 * session-engine.js — Multi-Thread Session Manager + File Vault
 *
 * CONNECTIVITY MAP
 * ----------------
 * Engine 25 (NNACC) : owns active thread surface
 * FileVault         : full payloads kept out of chat stream; badge-only in feed
 * Persistence       : localStorage keys nnacc_session_<id> + nnacc_session_index
 * NASE / I5         : mutations still gated by ui-controller.js
 *
 * Evidence class: Partially Verified (client localStorage persistence;
 * large binary payloads may hit quota — residual uncertainty noted).
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

  function writeSession(session) {
    if (!session || !session.id) return false;
    try {
      session.updatedAt = now();
      localStorage.setItem(session.id, JSON.stringify(session));
      const index = readIndex().filter((e) => e.id !== session.id);
      index.unshift({
        id: session.id,
        title: session.title || "Untitled chat",
        updatedAt: session.updatedAt,
        createdAt: session.createdAt,
        messageCount: (session.messages || []).filter((m) => m.role !== "system").length,
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
      id,
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
    let id = getActiveSessionId();
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
    const index = readIndex().filter((e) => e.id !== id);
    writeIndex(index);
    if (getActiveSessionId() === id) {
      if (index.length) setActiveSessionId(index[0].id);
      else setActiveSessionId(null);
    }
  }

  function deriveTitle(session) {
    if (!session) return "Untitled chat";
    const firstUser = (session.messages || []).find((m) => m.role === "user" && m.kind !== "file-badge");
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

  /** Store full file payload in session.files; return vault entry (no full text in chat). */
  function addFileToVault(session, { name, text, type, size }) {
    if (!session) return null;
    const entry = {
      id: "file_" + now() + "_" + Math.random().toString(36).slice(2, 7),
      name: name || "untitled",
      type: type || "text/plain",
      size: size != null ? size : (text ? text.length : 0),
      text: text || "",
      ingestedAt: now(),
    };
    if (!session.files) session.files = [];
    session.files.push(entry);
    writeSession(session);
    return entry;
  }

  function getFile(session, fileId) {
    if (!session || !session.files) return null;
    return session.files.find((f) => f.id === fileId) || null;
  }

  function listFiles(session) {
    return (session && session.files) || [];
  }

  function removeFile(session, fileId) {
    if (!session || !session.files) return;
    session.files = session.files.filter((f) => f.id !== fileId);
    writeSession(session);
  }

  global.SessionEngine = {
    createSession,
    listSessions,
    loadSession: readSession,
    saveSession: writeSession,
    deleteSession,
    getActiveSessionId,
    setActiveSessionId,
    loadOrCreateActive,
    deriveTitle,
    autoTitle,
    addFileToVault,
    getFile,
    listFiles,
    removeFile,
    PREFIX,
  };
})(typeof window !== "undefined" ? window : globalThis);
