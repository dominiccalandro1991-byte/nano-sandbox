/**
 * avatar-controller.js — Vail Cipher artist hooks + animation state machine
 * States: IDLE | THINKING | BUILDING | CELEBRATE | ERROR
 * Cycle hooks: isThinking, isStreaming, onSuccess, onError
 * Five artist slots ready for drop-in animation assets.
 */
(function (global) {
  "use strict";

  var STATES = ["IDLE", "THINKING", "BUILDING", "CELEBRATE", "ERROR"];
  var CELEBRATE_MS = 3000;

  /** Five Vail Cipher / Voltage artists — bind animation files later via assetUrl */
  var ARTIST_SLOTS = [
    { id: "vail-cipher", name: "Vail Cipher", glyph: "🔐", assetUrl: null },
    { id: "backroad-voltage", name: "BackRoad Voltage", glyph: "⚡", assetUrl: null },
    { id: "funkastatic", name: "Funkastatic", glyph: "🎨", assetUrl: null },
    { id: "aisle-nine", name: "Aisle Nine", glyph: "⚙️", assetUrl: null },
    { id: "dj-fault-line", name: "DJ Fault Line", glyph: "📡", assetUrl: null }
  ];

  function AvatarController(rootSelector) {
    this.root =
      typeof rootSelector === "string"
        ? document.querySelector(rootSelector)
        : rootSelector || document.getElementById("persona-stage");
    this.state = "IDLE";
    this.activeArtistId = ARTIST_SLOTS[0].id;
    this._celebrateTimer = null;
    this._listeners = { thinking: [], streaming: [], success: [], error: [], state: [] };
    this.setState("IDLE");
    this.setArtist(this.activeArtistId);
  }

  AvatarController.prototype.on = function (event, fn) {
    if (this._listeners[event]) this._listeners[event].push(fn);
    return this;
  };

  AvatarController.prototype._emit = function (event, detail) {
    var list = this._listeners[event] || [];
    for (var i = 0; i < list.length; i++) {
      try {
        list[i](detail);
      } catch (e) {}
    }
    try {
      global.dispatchEvent(new CustomEvent("vcs:avatar-" + event, { detail: detail }));
    } catch (e) {}
  };

  AvatarController.prototype.setArtist = function (artistId) {
    var slot =
      ARTIST_SLOTS.filter(function (a) {
        return a.id === artistId;
      })[0] || ARTIST_SLOTS[0];
    this.activeArtistId = slot.id;
    if (this.root) {
      this.root.setAttribute("data-artist", slot.id);
      this.root.setAttribute("data-artist-name", slot.name);
    }
    var glyph = document.getElementById("persona-glyph");
    if (glyph) {
      if (slot.assetUrl) {
        glyph.innerHTML = '<img src="' + slot.assetUrl + '" alt="" class="persona-asset" />';
      } else {
        glyph.textContent = slot.glyph;
      }
    }
    return slot;
  };

  AvatarController.prototype.registerAsset = function (artistId, url) {
    ARTIST_SLOTS.forEach(function (a) {
      if (a.id === artistId) a.assetUrl = url;
    });
    if (this.activeArtistId === artistId) this.setArtist(artistId);
  };

  AvatarController.prototype.setState = function (next) {
    next = String(next || "IDLE").toUpperCase();
    if (STATES.indexOf(next) === -1) next = "IDLE";
    if (this._celebrateTimer) {
      clearTimeout(this._celebrateTimer);
      this._celebrateTimer = null;
    }
    this.state = next;
    var el = this.root;
    if (el) {
      el.setAttribute("data-anim-state", next);
      el.classList.remove(
        "anim-idle",
        "anim-thinking",
        "anim-building",
        "anim-celebrate",
        "anim-error"
      );
      el.classList.add("anim-" + next.toLowerCase());
    }
    var label = document.getElementById("persona-anim-label");
    if (label) label.textContent = next;
    this._emit("state", { state: next, artistId: this.activeArtistId });
    var self = this;
    if (next === "CELEBRATE") {
      this._celebrateTimer = setTimeout(function () {
        self.setState("IDLE");
      }, CELEBRATE_MS);
    }
  };

  /** Model execution cycle hooks */
  AvatarController.prototype.isThinking = function () {
    this.setState("THINKING");
    this._emit("thinking", { artistId: this.activeArtistId });
  };
  AvatarController.prototype.isStreaming = function () {
    this.setState("BUILDING");
    this._emit("streaming", { artistId: this.activeArtistId });
  };
  AvatarController.prototype.onSuccess = function (detail) {
    this.setState("CELEBRATE");
    this._emit("success", Object.assign({ artistId: this.activeArtistId }, detail || {}));
  };
  AvatarController.prototype.onError = function (detail) {
    this.setState("ERROR");
    this._emit("error", Object.assign({ artistId: this.activeArtistId }, detail || {}));
  };
  AvatarController.prototype.thinking = function () {
    this.isThinking();
  };
  AvatarController.prototype.building = function () {
    this.isStreaming();
  };
  AvatarController.prototype.celebrate = function () {
    this.onSuccess();
  };
  AvatarController.prototype.error = function () {
    this.onError();
  };
  AvatarController.prototype.idle = function () {
    this.setState("IDLE");
  };

  AvatarController.ARTIST_SLOTS = ARTIST_SLOTS;
  AvatarController.STATES = STATES;

  global.AvatarController = AvatarController;
})(typeof window !== "undefined" ? window : globalThis);
