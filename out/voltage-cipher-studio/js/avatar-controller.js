/**
 * avatar-controller.js — Persona animation state machine
 * IDLE → THINKING → BUILDING → CELEBRATE | ERROR
 */
(function (global) {
  "use strict";

  var STATES = ["IDLE", "THINKING", "BUILDING", "CELEBRATE", "ERROR"];
  var CELEBRATE_MS = 3000;

  function AvatarController(rootSelector) {
    this.root =
      typeof rootSelector === "string"
        ? document.querySelector(rootSelector)
        : rootSelector || document.getElementById("persona-stage");
    this.state = "IDLE";
    this._celebrateTimer = null;
    this.setState("IDLE");
  }

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
    try {
      global.dispatchEvent(
        new CustomEvent("vcs:avatar-state", { detail: { state: next } })
      );
    } catch (e) {}
    if (next === "CELEBRATE") {
      var self = this;
      this._celebrateTimer = setTimeout(function () {
        self.setState("IDLE");
      }, CELEBRATE_MS);
    }
  };

  AvatarController.prototype.thinking = function () {
    this.setState("THINKING");
  };
  AvatarController.prototype.building = function () {
    this.setState("BUILDING");
  };
  AvatarController.prototype.celebrate = function () {
    this.setState("CELEBRATE");
  };
  AvatarController.prototype.error = function () {
    this.setState("ERROR");
  };
  AvatarController.prototype.idle = function () {
    this.setState("IDLE");
  };

  global.AvatarController = AvatarController;
})(typeof window !== "undefined" ? window : globalThis);
