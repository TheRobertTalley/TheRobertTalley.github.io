(function (root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (root) root.TsvMeshMessaging = api;
})(typeof window !== "undefined" ? window : null, function () {
  "use strict";
  const MAX_TEXT_LENGTH = 180;
  const MAX_TEXT_BYTES = 220;
  const RETRY_MS = 10 * 60 * 1000;

  function validateText(value) {
    const text = String(value == null ? "" : value).trim();
    if (!text) return "Enter a message.";
    if (text.length > MAX_TEXT_LENGTH) return `Keep the message within ${MAX_TEXT_LENGTH} characters.`;
    if (new TextEncoder().encode(text).length > MAX_TEXT_BYTES) return `Message exceeds the radio's ${MAX_TEXT_BYTES}-byte limit; shorten it.`;
    if (text.startsWith("!")) return "Use ATAK Tools for commands beginning with !.";
    return "";
  }

  function channelsFrom(payload) {
    const input = payload && payload.messaging && payload.messaging.channels;
    if (!Array.isArray(input)) return [];
    const seen = new Set();
    return input.filter(channel => {
      if (!channel || !Number.isInteger(channel.index) || channel.index < 0 || channel.index > 7 || seen.has(channel.index)) return false;
      const role = String(channel.role).toLowerCase();
      if (!["primary", "secondary", "1", "2"].includes(role)) return false;
      seen.add(channel.index); return true;
    }).map(channel => ({ index: channel.index, name: String(channel.name || `Channel ${channel.index}`),
      role: String(channel.role), isPrivateVerified: channel.isPrivateVerified === true }));
  }

  function messageUrl(endpoint) {
    const url = new URL(endpoint);
    if (url.protocol === "ws:") url.protocol = "http:";
    if (url.protocol === "wss:") url.protocol = "https:";
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) throw new Error("Invalid headset address");
    url.pathname = "/message"; url.search = ""; url.hash = "";
    return url.toString();
  }

  function requestId() {
    if (typeof crypto === "undefined") throw new Error("Secure request IDs are unavailable");
    if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
    const bytes = crypto.getRandomValues(new Uint8Array(16));
    return Array.from(bytes, value => value.toString(16).padStart(2, "0")).join("");
  }

  function createController(options = {}) {
    const endpoints = new Map();
    const fetcher = options.fetch || ((...args) => fetch(...args));
    const now = options.now || Date.now;
    let selectedEndpoint = "", selectedChannel = "", text = "", busy = false, attempt = null, notice = "";
    let channelChangedDuringAttempt = false;
    const channelKey = channel => channel && JSON.stringify([channel.index, channel.name, channel.role, channel.isPrivateVerified]);

    function current() {
      const entry = endpoints.get(selectedEndpoint);
      const channels = entry ? channelsFrom(entry.payload) : [];
      const channel = channels.find(item => String(item.index) === selectedChannel);
      let blocked = "";
      if (!entry) blocked = "Choose a connected headset to send a message.";
      else if (!entry.connected) blocked = "Headset disconnected. Reconnect it in Assets.";
      else if (entry.payload?.capabilities?.messages !== true) blocked = "Messaging is unavailable on this asset.";
      else if (entry.payload?.messaging?.ready !== true) blocked = String(entry.payload?.messaging?.status || "Radio is not ready. Connect it in Assets.");
      else if (!entry.payload?.messaging?.sessionId) blocked = "Waiting for the headset messaging session.";
      else if (!channels.length) blocked = "Waiting for verified radio channel information.";
      else if (!channel) blocked = "Choose a radio channel.";
      else if (attempt && entry.payload.messaging.sessionId !== attempt.sessionId) blocked = "Headset restarted. This message cannot be retried; its delivery remains unconfirmed.";
      else if (attempt && channelKey(channel) !== attempt.channelKey) blocked = "Radio channel changed. This message cannot be retried; its delivery remains unconfirmed.";
      else if (attempt && now() - attempt.createdAt >= RETRY_MS) blocked = "Retry window expired. This message's delivery remains unconfirmed.";
      return { entry, channels, channel, blocked };
    }

    function view() {
      const selected = current();
      const unknown = attempt && attempt.state === "unknown";
      const validation = validateText(text);
      return { endpoints: [...endpoints].map(([endpoint, entry]) => ({ endpoint,
        label: String(entry.payload?.assetLabel || endpoint), connected: entry.connected,
        capable: entry.payload?.capabilities?.messages === true })),
        endpoint: selectedEndpoint, channelIndex: selectedChannel, channels: selected.channels,
        text, busy, unknown: Boolean(unknown), locked: busy || Boolean(unknown),
        canSend: !busy && !selected.blocked && (!validation || Boolean(unknown)),
        status: busy ? "Submitting message…" : (unknown && selected.blocked) || notice || selected.blocked || validation || "Ready to send on the selected channel.",
        blocked: selected.blocked,
        privacy: selected.channel ? (selected.channel.isPrivateVerified ? "Private channel verified." : "Channel privacy is not verified.") : "",
        buttonLabel: unknown ? "Retry same request" : "Send Message" };
    }
    const notify = () => { if (options.onChange) options.onChange(view()); };

    function updateEndpoint(endpoint, payload, state = {}) {
      if (!payload || payload.type !== "snapshot") return;
      const before = current();
      const previous = endpoints.get(endpoint);
      endpoints.set(endpoint, { payload, connected: state.connected == null ? Boolean(previous?.connected) : state.connected === true });
      // An index must be explicitly selected again if its channel identity changes.
      if (endpoint === selectedEndpoint && before.channel &&
          channelKey(before.channel) !== channelKey(current().channel)) {
        if (busy || attempt) channelChangedDuringAttempt = true;
        else selectedChannel = "";
      }
      notify();
    }
    function setConnection(endpoint, connected) {
      const entry = endpoints.get(endpoint) || { payload: null };
      entry.connected = connected === true; endpoints.set(endpoint, entry); notify();
    }
    function removeEndpoint(endpoint) {
      endpoints.delete(endpoint);
      if (selectedEndpoint === endpoint && !busy && !attempt) { selectedEndpoint = ""; selectedChannel = ""; }
      notify();
    }
    function selectEndpoint(endpoint) {
      if (busy || attempt) return;
      selectedEndpoint = String(endpoint); selectedChannel = ""; notice = ""; notify();
    }
    function selectChannel(index) {
      if (busy || attempt) return;
      selectedChannel = String(index); notice = ""; notify();
    }
    function setText(value) {
      if (busy || attempt) return;
      text = String(value); notice = ""; notify();
    }
    function newMessage() {
      if (busy) return;
      attempt = null; text = ""; selectedChannel = "";
      channelChangedDuringAttempt = false;
      notice = "Previous delivery remains unconfirmed. Choose a channel for a new message.";
      notify();
    }

    async function send() {
      if (busy) return { state: "pending" };
      const selected = current();
      const invalid = selected.blocked || validateText(text);
      if (invalid) { notice = invalid; notify(); return { state: "blocked" }; }
      if (!attempt) {
        try {
          attempt = { requestId: (options.requestId || requestId)(), text: text.trim(),
            channelIndex: selected.channel.index, channelKey: channelKey(selected.channel),
            sessionId: selected.entry.payload.messaging.sessionId, createdAt: now(),
            endpoint: selectedEndpoint, state: "pending" };
        } catch (error) {
          notice = "This browser cannot create a secure message request."; notify(); return { state: "blocked" };
        }
      }
      busy = true; notify();
      const retained = attempt;
      const Abort = options.AbortController || AbortController;
      const abort = new Abort();
      const setTimer = options.setTimeout || setTimeout, clearTimer = options.clearTimeout || clearTimeout;
      const timeout = setTimer(() => abort.abort(), options.timeoutMs || 10000);
      try {
        const url = messageUrl(retained.endpoint);
        const response = await fetcher(url, {
          ...(options.fetchOptions ? options.fetchOptions(url) : {}),
          method: "POST", cache: "no-store", signal: abort.signal,
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ requestId: retained.requestId, sessionId: retained.sessionId,
            text: retained.text, channelIndex: retained.channelIndex })
        });
        const result = await response.json();
        if (result.requestId !== retained.requestId) throw new Error("Unmatched request result");
        if (response.ok && result.ok === true && result.submitted === true && result.state === "submitted") {
          notice = `Submitted on channel ${retained.channelIndex}. Delivery is unconfirmed.`;
          text = ""; attempt = null; return { state: "submitted" };
        }
        if (result.ok === false && result.submitted === false && ["rejected", "cancelled"].includes(result.state)) {
          notice = String(result.status || (result.state === "cancelled" ? "Message cancelled before submission." : "Message was not submitted."));
          attempt = null; return { state: result.state };
        }
        retained.state = "unknown";
        notice = "Result unknown; delivery is unconfirmed. Retry keeps the same request ID.";
        return { state: "unknown" };
      } catch (error) {
        retained.state = "unknown";
        notice = "Result unknown; delivery is unconfirmed. Retry keeps the same request ID.";
        return { state: "unknown" };
      } finally {
        clearTimer(timeout); busy = false;
        if (!attempt && channelChangedDuringAttempt) { selectedChannel = ""; channelChangedDuringAttempt = false; }
        notify();
      }
    }
    return { updateEndpoint, setConnection, removeEndpoint, selectEndpoint, selectChannel, setText, newMessage, send, view };
  }

  function createPanel(options) {
    const root = options.root;
    if (!root) return null;
    const form = root.querySelector("form"), asset = root.querySelector("[data-message-asset]");
    const channel = root.querySelector("[data-message-channel]"), input = root.querySelector("[data-message-text]");
    const send = root.querySelector("[data-message-send]"), status = root.querySelector("[data-message-status]");
    const next = root.querySelector("[data-message-new]");
    const privacy = root.querySelector("[data-message-privacy]"), count = root.querySelector("[data-message-count]");
    function choices(select, values, selected, placeholder) {
      const signature = JSON.stringify([values, placeholder]);
      if (select.dataset.options !== signature) {
        select.replaceChildren();
        for (const value of [{ value: "", label: placeholder }, ...values]) {
          const option = root.ownerDocument.createElement("option");
          option.value = value.value; option.textContent = value.label; select.append(option);
        }
        select.dataset.options = signature;
      }
      select.value = selected;
    }
    function render(state) {
      choices(asset, state.endpoints.map(entry => ({ value: entry.endpoint,
        label: `${entry.label}${entry.connected ? "" : " (disconnected)"}${entry.capable ? "" : " (messaging unavailable)"}` })), state.endpoint, "Choose a headset");
      choices(channel, state.channels.map(entry => ({ value: String(entry.index), label: `${entry.name} (${entry.index})` })), state.channelIndex, "Choose a channel");
      asset.disabled = state.locked; channel.disabled = state.locked || !state.channels.length;
      input.readOnly = state.locked; if (input.value !== state.text) input.value = state.text;
      send.disabled = !state.canSend; send.textContent = state.buttonLabel;
      next.hidden = !state.unknown; next.disabled = state.busy;
      form.setAttribute("aria-busy", String(state.busy));
      status.textContent = state.status; privacy.textContent = state.privacy;
      count.textContent = `${state.text.length}/${MAX_TEXT_LENGTH}`;
    }
    const controller = createController({ ...options, onChange: render });
    asset.addEventListener("change", () => controller.selectEndpoint(asset.value));
    channel.addEventListener("change", () => controller.selectChannel(channel.value));
    input.addEventListener("input", () => controller.setText(input.value));
    next.addEventListener("click", () => controller.newMessage());
    form.addEventListener("submit", event => { event.preventDefault(); controller.send(); });
    render(controller.view());
    return controller;
  }
  return { MAX_TEXT_LENGTH, MAX_TEXT_BYTES, validateText, channelsFrom, messageUrl, createController, createPanel };
});
