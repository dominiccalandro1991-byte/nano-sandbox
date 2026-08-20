/**
 * Chat Core Partition — streaming LLM + multi-pass continuation.
 * Isolated from EngineIsolates / AST plane.
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

  var chatState = {
    personaId: "vail-cipher",
    modelId: "google/gemma-4-26b-a4b-it:free",
    messages: [],
    streaming: false,
    threadId: "thread_" + Date.now().toString(36)
  };

  function backendBase() {
    try {
      if (global.__NNACC_REMOTE__ && /^https?:\/\//i.test(global.__NNACC_REMOTE__)) {
        return String(global.__NNACC_REMOTE__).replace(/\/$/, "");
      }
      var s = localStorage.getItem("nnacc-v2-remote") || localStorage.getItem("vcs-remote") || "";
      if (s && /^https?:\/\//i.test(s)) return s.replace(/\/$/, "");
    } catch (e) {}
    return (global.NASE_Daemon && global.NASE_Daemon.backendBase()) || "https://nano-sandbox-api.onrender.com";
  }

  function getPersona() {
    return (
      PERSONAS.filter(function (p) {
        return p.id === chatState.personaId;
      })[0] || PERSONAS[0]
    );
  }

  function historyMessages() {
    return chatState.messages
      .filter(function (m) {
        return (m.role === "user" || m.role === "assistant") && m.content && !m.failed;
      })
      .map(function (m) {
        return { role: m.role, content: m.content };
      });
  }

  async function postChat(messages, onToken) {
    var modelId = chatState.modelId;
    var maxOut =
      global.CodegenUtils && global.CodegenUtils.computeMaxOut
        ? global.CodegenUtils.computeMaxOut(modelId, messages)
        : 8192;
    var base = backendBase();

    // Prefer SSE stream
    try {
      var res = await fetch(base + "/llm/chat/stream", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
        body: JSON.stringify({
          model: modelId,
          messages: messages,
          persona: chatState.personaId,
          max_tokens: maxOut,
          stream: true
        })
      });
      if (res.ok && res.body) {
        var reader = res.body.getReader();
        var decoder = new TextDecoder();
        var full = "";
        var buf = "";
        var finish = null;
        while (true) {
          var chunk = await reader.read();
          if (chunk.done) break;
          buf += decoder.decode(chunk.value, { stream: true });
          var parts = buf.split("\n");
          buf = parts.pop() || "";
          for (var i = 0; i < parts.length; i++) {
            var line = parts[i].trim();
            if (!line.indexOf("data:") === 0 && line.indexOf("data: ") !== 0) continue;
            var data = line.replace(/^data:\s*/, "");
            if (data === "[DONE]") continue;
            try {
              var j = JSON.parse(data);
              if (j.error) throw new Error(typeof j.error === "string" ? j.error : JSON.stringify(j.error));
              var delta =
                j.choices &&
                j.choices[0] &&
                j.choices[0].delta &&
                j.choices[0].delta.content;
              if (delta) {
                full += delta;
                if (onToken) onToken(delta, full);
              }
              if (j.choices && j.choices[0] && j.choices[0].finish_reason) {
                finish = j.choices[0].finish_reason;
              }
            } catch (e) {
              if (e && e.message && e.message.indexOf("JSON") === -1) throw e;
            }
          }
        }
        return {
          content: full,
          finish_reason: finish,
          continue_needed: finish === "length",
          max_tokens_used: maxOut
        };
      }
    } catch (streamErr) {
      try {
        console.warn("[ChatPartition] stream fallback", streamErr);
      } catch (e) {}
    }

    // Non-stream fallback
    var res2 = await fetch(base + "/llm/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({
        model: modelId,
        messages: messages,
        persona: chatState.personaId,
        max_tokens: maxOut
      })
    });
    var body = await res2.json().catch(function () {
      return {};
    });
    if (!res2.ok) {
      var detail = body.detail;
      if (typeof detail === "object") detail = detail.message || JSON.stringify(detail);
      throw new Error(detail || "LLM HTTP " + res2.status);
    }
    var content = body.content || body.result || "";
    if (onToken && content) onToken(content, content);
    return body;
  }

  async function sendUserMessage(text, opts) {
    opts = opts || {};
    if (!text || chatState.streaming) return null;
    chatState.streaming = true;
    chatState.messages.push({ role: "user", content: text, ts: Date.now() });
    var assistant = {
      role: "assistant",
      content: "",
      model: chatState.modelId,
      ts: Date.now(),
      files: []
    };
    chatState.messages.push(assistant);
    if (opts.onUpdate) opts.onUpdate(assistant);

    try {
      var msgs = historyMessages().slice(0, -1);
      msgs.push({ role: "user", content: text });
      var result = await postChat(msgs, function (delta, full) {
        assistant.content = full;
        if (opts.onUpdate) opts.onUpdate(assistant);
      });
      assistant.content = result.content || result.result || assistant.content;
      assistant.finish_reason = result.finish_reason;
      var pass = 0;
      var maxPasses = 4;
      while (
        pass < maxPasses &&
        global.CodegenUtils &&
        global.CodegenUtils.needsContinuation(assistant.content, result)
      ) {
        pass++;
        var contUser =
          "CONTINUE from the exact point you stopped. Output only the remainder. Keep using path-tagged Markdown code fences for files. Pass " +
          (pass + 1) +
          ".";
        var contMsgs = historyMessages().concat([
          { role: "assistant", content: assistant.content },
          { role: "user", content: contUser }
        ]);
        // Don't push continuation prompts into visible history — keep single assistant bubble
        result = await postChat(contMsgs, function (delta, full) {
          assistant.content =
            assistant.content.replace(/\s*CONTINUE_NEEDED\s*$/i, "") + full;
          if (opts.onUpdate) opts.onUpdate(assistant);
        });
        var more = result.content || result.result || "";
        assistant.content =
          assistant.content.replace(/\s*CONTINUE_NEEDED\s*$/i, "") + more;
      }
      if (global.CodegenUtils && global.CodegenUtils.extractFileTree) {
        assistant.files = global.CodegenUtils.extractFileTree(assistant.content);
      }
      if (opts.onUpdate) opts.onUpdate(assistant);
      return assistant.content;
    } catch (err) {
      var msg = err && err.message ? err.message : String(err);
      assistant.content = msg;
      assistant.failed = true;
      if (opts.onUpdate) opts.onUpdate(assistant);
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
      chatState.personaId = id || "vail-cipher";
    },
    setModel: function (id) {
      chatState.modelId = id || chatState.modelId;
    },
    hydrate: function (msgs) {
      chatState.messages = (msgs || []).map(function (m) {
        return {
          role: m.role,
          content: m.content || m.text || "",
          ts: m.ts || Date.now(),
          files: m.files || []
        };
      });
    },
    backendBase: backendBase,
    sendUserMessage: sendUserMessage,
    deleteThread: deleteThread,
    exportThread: exportThread
  };
})(typeof window !== "undefined" ? window : globalThis);
