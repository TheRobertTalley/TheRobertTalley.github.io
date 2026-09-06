(function (root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (root) root.TsvTelemetry = api;
})(typeof window !== "undefined" ? window : null, function () {
  "use strict";
  const POSITION_CURRENT_MS = 90000;

  function normalizeEndpoint(value) {
    let endpoint = String(value || "").trim().replace(/\/$/, "");
    if (!endpoint) return "";
    const explicitScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(endpoint);
    if (/^https?:\/\//i.test(endpoint)) endpoint = endpoint.replace(/^http/i, "ws");
    else if (explicitScheme && !/^wss?:\/\//i.test(endpoint)) return "";
    else if (!explicitScheme) endpoint = `ws://${endpoint}`;
    try {
      const url = new URL(endpoint);
      if (!/^wss?:$/.test(url.protocol) || !url.hostname || url.username || url.password) return "";
      // Bare headset addresses retain :8787. Explicit HTTP(S)/WS(S) URLs use
      // their standard or supplied port, including HTTPS relays on 443/9443.
      if (!explicitScheme && !url.port) url.port = "8787";
      url.pathname = "/"; url.search = ""; url.hash = "";
      return url.toString().replace(/\/$/, "");
    } catch (_) { return ""; }
  }

  function endpointKey(endpoint) {
    try {
      const url = new URL(endpoint);
      const host = url.hostname.toLowerCase() === "localhost" ? "127.0.0.1" : url.hostname.toLowerCase();
      return `${url.protocol}//${host}:${url.port || (url.protocol === "wss:" ? "443" : "80")}`;
    } catch (_) { return endpoint; }
  }

  function endpointsFromQuery(search) {
    if (typeof search !== "string" || search.length > 12288) return [];
    const endpoints = [], seen = new Set();
    let inspected = 0;
    for (const pair of search.replace(/^\?/, "").split("&")) {
      const separator = pair.indexOf("=");
      const rawKey = separator < 0 ? pair : pair.slice(0, separator);
      let key;
      try { key = decodeURIComponent(rawKey.replace(/\+/g, " ")); } catch (_) { continue; }
      if (key !== "asset") continue;
      if (++inspected > 4) break;
      let value;
      try { value = decodeURIComponent((separator < 0 ? "" : pair.slice(separator + 1)).replace(/\+/g, " ")); }
      catch (_) { continue; }
      if (!value || value.length > 2048) continue;
      const endpoint = normalizeEndpoint(value);
      if (!endpoint || seen.has(endpointKey(endpoint))) continue;
      seen.add(endpointKey(endpoint));
      endpoints.push(endpoint);
    }
    return endpoints;
  }

  function isSyntheticPosition(node) {
    return node && (node.source === "test-location" || node.source === "demo");
  }

  function isReadOnly(payload) {
    return payload.readOnly === true || payload.capabilities?.readOnly === true ||
      payload.capabilities?.commands === false;
  }

  function addressSpace(host) {
    host = String(host).toLowerCase().replace(/^\[|\]$/g, "");
    if (host === "localhost" || host === "::1") return "loopback";
    const p = host.split(".").map(Number);
    if (p.length === 4 && p.every(v => Number.isInteger(v) && v >= 0 && v <= 255)) {
      if (p[0] === 127) return "loopback";
      if (p[0] === 10 || (p[0] === 172 && p[1] >= 16 && p[1] <= 31) ||
          (p[0] === 192 && p[1] === 168) || (p[0] === 169 && p[1] === 254) ||
          (p[0] === 100 && p[1] >= 64 && p[1] <= 127)) return "local";
    }
    if (/^(fc|fd)[0-9a-f]{2}:/.test(host) || /^fe[89ab][0-9a-f]:/.test(host) ||
        host.endsWith(".ts.net")) return "local";
    return "";
  }

  function positionTime(node, now) {
    const unix = Number(node.positionTimeUnix);
    if (Number.isFinite(unix) && unix > 0) return unix * 1000;
    const age = Number(node.positionAgeMs);
    if (node.positionAgeMs != null && Number.isFinite(age) && age >= 0) return now - age;
    return null;
  }

  function positionCurrent(node, now = Date.now()) {
    if (isSyntheticPosition(node)) return false;
    const time = node.positionUpdatedAt == null ? positionTime(node, now) : node.positionUpdatedAt;
    return node.positionCurrent !== false && time != null && time <= now + 60000 &&
      now - time <= POSITION_CURRENT_MS;
  }

  function normalizeSnapshot(payload, now = Date.now()) {
    if (!payload || typeof payload !== "object") throw new Error("Invalid telemetry");
    if (payload.type === "snapshot" && Array.isArray(payload.nodes)) {
      return { ...payload, assetLabel: payload.assetLabel ||
        (payload.source === "headset" ? (payload.localHandle ? `${payload.localHandle} · Quest headset` : "Quest headset") : "") };
    }
    // Older Mayhamburger relays expose camera and GPS status without /snapshot.
    if (payload.relayPort !== 8088 || !payload.hud ||
        !Number.isFinite(Number(payload.cameraFrameVersion))) throw new Error("Unsupported telemetry");
    const hud = payload.hud;
    const age = Number(hud.gpsAgeMs);
    const lat = Number(hud.latitude), lon = Number(hud.longitude);
    const positioned = hud.gpsAvailable === true && Number.isFinite(lat) && Math.abs(lat) <= 90 &&
      Number.isFinite(lon) && Math.abs(lon) <= 180 && Number.isFinite(age) && age >= 0;
    const node = { id: "mayhamburger", label: "Mayhamburger", isLocal: true, source: "mayhamburger",
      lat, lon, positionTimeUnix: positioned ? Math.floor((now - age) / 1000) : 0,
      positionCurrent: positioned && age <= POSITION_CURRENT_MS,
      heading: Number.isFinite(Number(hud.headingDeg)) ? Number(hud.headingDeg) : null,
      accuracyYards: Number(hud.accuracyMeters) > 0 ? Number(hud.accuracyMeters) / 0.9144 : null };
    const cameraAge = Number(payload.cameraFrameAgeMs);
    const cameraLive = Number(payload.cameraFrameVersion) > 0 && cameraAge >= 0 && cameraAge <= 1500;
    return { type: "snapshot", source: "mayhamburger", assetLabel: "Mayhamburger",
      radioStatus: "Camera relay", cameraStatus: cameraLive ? "Camera live" : "Camera waiting",
      positionStatus: positioned ? (node.positionCurrent ? "GPS current" : "GPS last known") : "GPS waiting",
      nodes: positioned ? [node] : [], markers: [], messages: [],
      ...(positioned && node.positionCurrent ? { center: { lat, lon, zoom: 16 } } : {}) };
  }

  function summary(payload) {
    return [isReadOnly(payload) ? "Read-only" : "", payload.radioStatus, payload.cameraStatus,
      payload.testLocationActive ? "TEST LOCATION" : payload.positionStatus].filter(Boolean).join(" · ");
  }

  function createManager(options) {
    const sessions = new Map();
    const fetcher = options.fetch || ((...args) => fetch(...args));
    const Socket = options.WebSocket || WebSocket;
    const timers = options.timers || {
      setTimeout: (fn, ms) => setTimeout(fn, ms), clearTimeout: id => clearTimeout(id),
      setInterval: (fn, ms) => setInterval(fn, ms), clearInterval: id => clearInterval(id)
    };
    const clock = options.now || Date.now;
    const Abort = options.AbortController || AbortController;
    const current = s => sessions.get(s.endpoint) === s && s.desired;
    const notify = (s, status, live) => {
      if (current(s)) options.onState(s.endpoint, status, live, s.socket);
    };
    const receive = (s, data) => {
      const payload = normalizeSnapshot(data, clock());
      if (!current(s)) return;
      options.onSnapshot(payload, s.endpoint);
      notify(s, summary(payload) || "Live telemetry", true);
    };

    async function fetchJson(s, path) {
      const target = new URL(s.endpoint);
      target.protocol = target.protocol === "wss:" ? "https:" : "http:";
      target.pathname = path;
      const abort = new Abort();
      s.abort = abort;
      const timeout = timers.setTimeout(() => abort.abort(), 4000);
      const address = addressSpace(target.hostname);
      try {
        const response = await fetcher(target.toString(), {
          cache: "no-store", signal: abort.signal,
          ...(address ? { targetAddressSpace: address } : {})
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return normalizeSnapshot(await response.json(), clock());
      } finally {
        timers.clearTimeout(timeout);
        if (s.abort === abort) s.abort = null;
      }
    }

    async function poll(s) {
      if (!current(s) || s.inFlight || (s.lastSocketData && clock() - s.lastSocketData < 2500)) return;
      s.inFlight = true;
      try {
        let payload;
        try { payload = await fetchJson(s, s.statusPath || "/snapshot"); }
        catch (error) {
          if (!current(s)) return;
          if (s.statusPath === "/status") throw error;
          payload = await fetchJson(s, "/status");
          s.statusPath = "/status";
        }
        receive(s, payload);
      } catch (error) {
        notify(s, "Unavailable · open address to check network access", false);
      } finally { s.inFlight = false; }
    }

    function disconnect(endpoint) {
      const s = sessions.get(endpoint);
      if (!s) return;
      s.desired = false;
      sessions.delete(endpoint);
      timers.clearInterval(s.timer);
      if (s.abort) s.abort.abort();
      if (s.socket) s.socket.close();
      options.onState(endpoint, "Disconnected", false, null);
    }

    function connect(endpoint) {
      disconnect(endpoint);
      const s = { endpoint, desired: true, socket: null, inFlight: false, lastSocketData: 0 };
      sessions.set(endpoint, s);
      notify(s, "Connecting", false);
      s.timer = timers.setInterval(() => poll(s), 2000);
      // The phone relay is HTTP-only; do not make a WebSocket request trigger its HTML route.
      if (new URL(endpoint).port !== "8088") {
        try {
          const socket = new Socket(endpoint);
          s.socket = socket;
          socket.addEventListener("open", () => {
            if (!current(s)) return;
            socket.send(JSON.stringify({ type: "hello", client: "talleysoft-vision-web" }));
          });
          socket.addEventListener("message", event => {
            if (!current(s)) return;
            try {
              const payload = JSON.parse(event.data);
              if (payload && ["node", "position", "marker", "target", "message"].includes(payload.type)) {
                options.onSnapshot(payload, s.endpoint);
                notify(s, "Live telemetry", true);
              } else receive(s, payload);
              s.lastSocketData = clock();
            }
            catch (error) { notify(s, "Invalid telemetry", false); }
          });
          socket.addEventListener("close", () => {
            if (!current(s)) return;
            s.socket = null;
            s.lastSocketData = 0;
            poll(s);
          });
          socket.addEventListener("error", () => { if (current(s)) poll(s); });
        } catch (error) { /* HTTP polling remains independent of WebSocket support. */ }
      }
      poll(s);
    }

    function requestSoon(endpoint, delay = 160) {
      const s = sessions.get(endpoint);
      if (s) timers.setTimeout(() => { if (current(s)) { s.lastSocketData = 0; poll(s); } }, delay);
    }
    return { connect, disconnect, requestSoon };
  }
  return { normalizeEndpoint, endpointKey, endpointsFromQuery, isSyntheticPosition, isReadOnly,
    addressSpace, positionTime, positionCurrent, normalizeSnapshot, summary, createManager };
});
