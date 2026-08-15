/**
 * Chat Core Partition — virtual branch isolated from AST/codegen orchestrators.
 * Namespace: ChatPartition.* only. Never shares mutable refs with EngineIsolates.
 */
(function (global) {
  "use strict";

  var PERSONAS = [
    { id: "vail-cipher", name: "Vail Cipher", glyph: "🔐" },
    { id: "backroad-voltage", name: "BackRoad Voltage", glyph: "⚡" },
    { id: "funkastatic", name: "Funkastatic", glyph: "🎨" },
    { id: "aisle-nine", name: "Aisle Nine", glyph: "⚙️" },
    { id: "dj-fault-line", name: "DJ Fault Line", glyph: "📡" }
  ];

  var FREE_MODELS = [
    { id: "poolside/laguna-s-2.1:free", label: "Laguna S 2.1 (Lead Architect)", cat: "coding" },
    { id: "poolside/laguna-xs-2.1:free", label: "Laguna XS 2.1 (Fast Iteration)", cat: "coding" },
    { id: "openai/gpt-oss-20b:free", label: "GPT-OSS 20B (Code Reviewer)", cat: "coding" },
    { id: "nvidia/nemotron-3-ultra-550b-a55b:free", label: "Nemotron 3 Ultra (Deep Reasoning)", cat: "general" },
    { id: "nvidia/nemotron-3-super-120b-a12b:free", label: "Nemotron 3 Super (Balanced)", cat: "general" },
    { id: "google/gemma-4-26b-a4b-it:free", label: "Gemma 4 26B (Generalist)", cat: "general" }
  ];

  // Strictly partitioned chat state (not on EngineIsolates)
  var chatState = {
    personaId: "vail-cipher",
    modelId: "google/gemma-4-26b-a4b-it:free",
    messages: [],
    streaming: false,
    threadId: "thread_" + Date.now().toString(36)
  };

  function getPersona() {
    return (
      PERSONAS.filter(function (p) {
        return p.id === chatState.personaId;
      })[0] || PERSONAS[0]
    );
  }

  async function sendUserMessage(text) {
    if (!text || chatState.streaming) return null;
    chatState.streaming = true;
    chatState.messages.push({ role: "user", content: text, ts: Date.now() });
    var history = chatState.messages
      .filter(function (m) {
        return m.role === "user" || m.role === "assistant";
      })
      .slice(0, -1)
      .map(function (m) {
        return { role: m.role, content: m.content };
      });
    var messages = history.concat([{ role: "user", content: text }]);
    var base =
      (global.NASE_Daemon && global.NASE_Daemon.backendBase()) ||
      "https://nano-sandbox-api.onrender.com";
    try {
      var res = await fetch(base + "/llm/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({
          model: chatState.modelId,
          messages: messages,
          persona: chatState.personaId
        })
      });
      var body = await res.json().catch(function () {
        return {};
      });
      if (!res.ok) {
        var detail = body.detail;
        if (typeof detail === "object") detail = detail.message || JSON.stringify(detail);
        throw new Error(detail || "LLM HTTP " + res.status);
      }
      var content = body.content || body.result || "";
      chatState.messages.push({
        role: "assistant",
        content: content,
        model: chatState.modelId,
        ts: Date.now()
      });
      return content;
    } catch (err) {
      var msg = err && err.message ? err.message : String(err);
      chatState.messages.push({
        role: "assistant",
        content: msg,
        failed: true,
        ts: Date.now()
      });
      throw err;
    } finally {
      chatState.streaming = false;
    }
  }

  function deleteThread() {
    chatState.messages = [];
    chatState.threadId = "thread_" + Date.now().toString(36);
  }

  function exportThread() {
    return JSON.stringify(
      {
        threadId: chatState.threadId,
        persona: chatState.personaId,
        model: chatState.modelId,
        messages: chatState.messages
      },
      null,
      2
    );
  }

  global.ChatPartition = {
    PERSONAS: PERSONAS,
    FREE_MODELS: FREE_MODELS,
    getState: function () {
      return {
        personaId: chatState.personaId,
        modelId: chatState.modelId,
        messages: chatState.messages.slice(),
        streaming: chatState.streaming,
        threadId: chatState.threadId,
        persona: getPersona()
      };
    },
    setPersona: function (id) {
      chatState.personaId = id;
    },
    setModel: function (id) {
      chatState.modelId = id;
    },
    sendUserMessage: sendUserMessage,
    deleteThread: deleteThread,
    exportThread: exportThread
  };
})(typeof window !== "undefined" ? window : globalThis);
