(function () {
  const mapElement = document.getElementById("ops-map");
  const feed = document.getElementById("event-feed");
  if (!mapElement) {
    return;
  }
  if (!window.L) {
    startOfflineMapFallback(mapElement, feed);
    return;
  }

  const defaultCenter = [34.2981382, -83.8257640];
  const defaultZoom = 17;
  const map = L.map(mapElement, {
    zoomControl: true,
    preferCanvas: true
  }).setView(defaultCenter, defaultZoom);

  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution: "&copy; OpenStreetMap contributors"
  }).addTo(map);

  const layers = {
    nodes: new Map(),
    markers: new Map(),
    routes: new Map(),
    directions: new Map()
  };

  const defaultTelemetryEndpoints = [
    "ws://127.0.0.1:8787",
    "ws://localhost:8787",
    "ws://192.168.1.61:8787"
  ];

  const state = {
    selectedKind: "target",
    placementKind: null,
    selectedNodeId: null,
    routeNumber: 1,
    routeLabel: "ROUTE 1",
    routeDraftPoints: [],
    routePreview: null,
    routeDrawing: false,
    routeSuppressClickUntil: 0,
    latestNode: null,
    didAutoCenter: false,
    didBrowserCenter: false,
    browserLocationErrorShown: false,
    nodes: new Map(),
    markers: new Map(),
    endpoints: [],
    headsets: new Map(),
    pollers: new Map(),
    endpointSnapshots: new Map()
  };

  const els = {
    headsetUrl: document.getElementById("headset-url"),
    addHeadset: document.getElementById("add-headset"),
    connectAll: document.getElementById("connect-all-headsets"),
    disconnectAll: document.getElementById("disconnect-all-headsets"),
    headsetList: document.getElementById("headset-list"),
    socketStatus: document.getElementById("socket-status"),
    connectionPill: document.getElementById("connection-pill"),
    feedMode: document.getElementById("feed-mode"),
    metricHeadsets: document.getElementById("metric-headsets"),
    metricMarkers: document.getElementById("metric-markers"),
    metricTargets: document.getElementById("metric-targets"),
    metricRadio: document.getElementById("metric-radio"),
    gridReadout: document.getElementById("grid-readout"),
    gpsReadout: document.getElementById("gps-readout"),
    accuracyReadout: document.getElementById("accuracy-readout"),
    meshReadout: document.getElementById("mesh-readout"),
    markerForm: document.getElementById("marker-form"),
    markerKind: document.getElementById("marker-kind"),
    markerLabel: document.getElementById("marker-label"),
    markerLat: document.getElementById("marker-lat"),
    markerLon: document.getElementById("marker-lon"),
    markerHeading: document.getElementById("marker-heading"),
    mapFrame: document.querySelector(".map-frame"),
    markerToolStatus: document.getElementById("marker-tool-status"),
    finishRoute: document.getElementById("finish-route"),
    cancelMarkerTool: document.getElementById("cancel-marker-tool"),
    loadDemo: document.getElementById("load-demo")
  };

  const colors = {
    headset: "#41f19b",
    target: "#ff4c4c",
    threat: "#ffd447",
    gunshot: "#ff4c4c",
    direction: "#41f19b",
    hold: "#ff4c4c",
    route: "#4ddfea",
    lz: "#ffd447",
    medical: "#e4fff3",
    location: "#41f19b",
    tracker: "#ffd447",
    browser: "#4ddfea"
  };

  function iconFor(kind, label, selected = false) {
    const safeLabel = escapeHtml(label || kind.toUpperCase());
    const color = colors[kind] || colors.location;
    return L.divIcon({
      className: `tsv-marker${selected ? " is-selected" : ""}`,
      html: `<span style="--marker-color:${color}">${symbolFor(kind)}</span><b>${safeLabel}</b>`,
      iconSize: [90, 30],
      iconAnchor: [12, 15]
    });
  }

  function symbolFor(kind) {
    switch (kind) {
      case "target":
        return "◎";
      case "threat":
      case "gunshot":
        return "!";
      case "direction":
        return ">";
      case "hold":
        return "▲";
      case "route":
        return "□";
      case "lz":
        return "H";
      case "medical":
        return "+";
      case "headset":
        return "⌖";
      case "browser":
        return "◆";
      default:
        return "•";
    }
  }

  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function addFeed(kind, message) {
    if (!feed) {
      return;
    }
    const item = document.createElement("li");
    const title = document.createElement("b");
    const detail = document.createElement("span");
    title.textContent = kind;
    detail.textContent = message;
    item.append(title, detail);
    feed.prepend(item);
    while (feed.children.length > 8) {
      feed.lastElementChild.remove();
    }
  }

  function normalizeNumber(value) {
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
  }

  function startOfflineMapFallback(container, eventFeed) {
    container.replaceChildren();
    container.style.position = "relative";
    container.style.background = "#07110c";
    const canvas = document.createElement("canvas");
    canvas.style.width = "100%";
    canvas.style.height = "100%";
    canvas.style.display = "block";
    container.append(canvas);
    const ctx = canvas.getContext("2d");
    let snapshot = { nodes: [], markers: [] };
    const fallbackColors = {
      headset: "#41f19b",
      tracker: "#ffd447",
      route: "#4ddfea",
      target: "#ff4c4c",
      threat: "#ffd447",
      gunshot: "#ff4c4c",
      direction: "#41f19b",
      hold: "#ff4c4c",
      location: "#41f19b",
      browser: "#4ddfea"
    };
    const endpoint =
      window.location && window.location.hostname &&
      window.location.port === "8787"
        ? `${window.location.protocol}//${window.location.host}`
        : "http://192.168.1.61:8787";

    function fallbackFeed(kind, message) {
      if (!eventFeed) {
        return;
      }
      const item = document.createElement("li");
      const title = document.createElement("b");
      const detail = document.createElement("span");
      title.textContent = kind;
      detail.textContent = message;
      item.append(title, detail);
      eventFeed.prepend(item);
      while (eventFeed.children.length > 8) {
        eventFeed.lastElementChild.remove();
      }
    }

    function coord(input) {
      const lat = normalizeNumber(input.lat ?? input.latitude);
      const lon = normalizeNumber(input.lon ?? input.longitude);
      return lat === null || lon === null ? null : { lat, lon };
    }

    function center() {
      return (snapshot.center ? coord(snapshot.center) : null) ||
        (snapshot.nodes || []).map(coord).find(Boolean) ||
        { lat: 34.2981382, lon: -83.8257640 };
    }

    function offsetMeters(origin, point) {
      const earthRadius = 6371000;
      const latitude = origin.lat * Math.PI / 180;
      return {
        x: (point.lon - origin.lon) *
          Math.PI / 180 *
          Math.cos(latitude) *
          earthRadius,
        y: (point.lat - origin.lat) * Math.PI / 180 * earthRadius
      };
    }

    function rangeFor(origin) {
      let range = 120;
      [...(snapshot.nodes || []), ...(snapshot.markers || [])]
        .forEach((item) => {
          const point = coord(item);
          if (!point) {
            return;
          }
          const delta = offsetMeters(origin, point);
          range = Math.max(range, Math.hypot(delta.x, delta.y) * 1.25);
        });
      return Math.min(Math.max(range, 120), 50000);
    }

    function resize() {
      const rect = container.getBoundingClientRect();
      const ratio = window.devicePixelRatio || 1;
      const width = Math.max(1, Math.round(rect.width));
      const height = Math.max(1, Math.round(rect.height));
      if (canvas.width !== width * ratio ||
          canvas.height !== height * ratio) {
        canvas.width = width * ratio;
        canvas.height = height * ratio;
        ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
      }
      return { width, height };
    }

    function project(origin, range, point, size) {
      const delta = offsetMeters(origin, point);
      const scale = Math.min(size.width, size.height) * 0.42 / range;
      return {
        x: size.width / 2 + delta.x * scale,
        y: size.height / 2 - delta.y * scale
      };
    }

    function drawPoint(item, kind, origin, range, size) {
      const point = coord(item);
      if (!point) {
        return;
      }
      const projected = project(origin, range, point, size);
      const color = fallbackColors[kind] || fallbackColors.location;
      const text = String(item.label || item.id || kind).slice(0, 16);
      ctx.strokeStyle = color;
      ctx.fillStyle = color;
      ctx.lineWidth = 2;
      ctx.beginPath();
      if (kind === "headset") {
        ctx.rect(projected.x - 6, projected.y - 6, 12, 12);
      } else {
        ctx.arc(projected.x, projected.y, 5, 0, Math.PI * 2);
      }
      ctx.stroke();
      ctx.fillText(text, projected.x + 10, projected.y - 8);
    }

    function draw() {
      const size = resize();
      const origin = center();
      const range = rangeFor(origin);
      ctx.clearRect(0, 0, size.width, size.height);
      ctx.fillStyle = "#07110c";
      ctx.fillRect(0, 0, size.width, size.height);
      ctx.strokeStyle = "rgba(65,241,155,.16)";
      for (let step = 0.25; step <= 1; step += 0.25) {
        ctx.beginPath();
        ctx.arc(
          size.width / 2,
          size.height / 2,
          Math.min(size.width, size.height) * 0.42 * step,
          0,
          Math.PI * 2
        );
        ctx.stroke();
      }
      ctx.strokeStyle = "rgba(65,241,155,.7)";
      ctx.beginPath();
      ctx.moveTo(size.width / 2 - 20, size.height / 2);
      ctx.lineTo(size.width / 2 + 20, size.height / 2);
      ctx.moveTo(size.width / 2, size.height / 2 - 20);
      ctx.lineTo(size.width / 2, size.height / 2 + 20);
      ctx.stroke();
      ctx.font = "12px system-ui";
      (snapshot.markers || []).forEach((marker) => {
        drawPoint(
          marker,
          String(marker.kind || marker.type || "location").toLowerCase(),
          origin,
          range,
          size
        );
      });
      (snapshot.nodes || []).forEach((node) => {
        drawPoint(node, node.isLocal ? "headset" : "tracker", origin, range, size);
      });
      ctx.fillStyle = "#dfffea";
      ctx.fillText(
        `Center ${origin.lat.toFixed(6)}, ${origin.lon.toFixed(6)}  ` +
          `Range ${Math.round(range)}m`,
        14,
        size.height - 18
      );
    }

    async function poll() {
      try {
        const snapshotUrl = `${endpoint}/snapshot`;
        const response = await fetch(
          snapshotUrl,
          localFetchOptions(snapshotUrl));
        snapshot = await response.json();
        draw();
        fallbackFeed(
          "HEADSET",
          `${snapshot.radioStatus || "live"} - ` +
            `${(snapshot.nodes || []).length} nodes`
        );
      } catch (error) {
        fallbackFeed("HEADSET", `Offline map fetch failed: ${error.message}`);
        draw();
      }
    }

    window.addEventListener("resize", draw);
    poll();
    window.setInterval(poll, 2000);
  }

  function normalizeEndpoint(value) {
    let endpoint = String(value || "").trim();
    if (!endpoint) {
      return "";
    }
    endpoint = endpoint.replace(/\/$/, "");
    if (/^https?:\/\//i.test(endpoint)) {
      endpoint = endpoint.replace(/^http/i, "ws");
    } else if (!/^wss?:\/\//i.test(endpoint)) {
      endpoint = `ws://${endpoint}`;
    }
    try {
      const url = new URL(endpoint);
      if (!url.port) {
        url.port = "8787";
      }
      url.pathname = "/";
      url.search = "";
      url.hash = "";
      return url.toString().replace(/\/$/, "");
    } catch (error) {
      return "";
    }
  }

  function discoverDefaultEndpoints() {
    const endpoints = [];
    if (window.location && window.location.hostname) {
      const host = window.location.hostname.toLowerCase();
      const localPage = window.location.port === "8787";
      if (localPage) {
        const scheme = window.location.protocol === "https:" ? "wss" : "ws";
        endpoints.push(`${scheme}://${window.location.host}`);
      }
    }
    defaultTelemetryEndpoints.forEach((endpoint) => endpoints.push(endpoint));
    return uniqueEndpoints(endpoints);
  }

  function endpointKey(endpoint) {
    try {
      const url = new URL(endpoint);
      const host = url.hostname.toLowerCase() === "localhost"
        ? "127.0.0.1"
        : url.hostname.toLowerCase();
      return `${url.protocol}//${host}:${url.port || "8787"}`;
    } catch (error) {
      return endpoint;
    }
  }

  function uniqueEndpoints(values) {
    const seen = new Set();
    const endpoints = [];
    values.map(normalizeEndpoint).filter(Boolean).forEach((endpoint) => {
      const key = endpointKey(endpoint);
      if (seen.has(key)) {
        return;
      }
      seen.add(key);
      endpoints.push(endpoint);
    });
    return endpoints;
  }

  function isCurrentPageEndpoint(endpoint) {
    if (!window.location || !window.location.hostname ||
        !window.location.port || window.location.port === "8787") {
      return false;
    }
    try {
      const url = new URL(endpoint);
      return url.hostname.toLowerCase() ===
          window.location.hostname.toLowerCase() &&
        (url.port || "8787") === window.location.port;
    } catch (error) {
      return false;
    }
  }

  function loadEndpoints() {
    if (!window.localStorage) {
      return [];
    }
    try {
      const saved = JSON.parse(window.localStorage.getItem("tsvHeadsetEndpoints") || "[]");
      if (Array.isArray(saved)) {
        return saved.map(normalizeEndpoint).filter(Boolean);
      }
    } catch (error) {
      addFeed("ASSET", "Ignored invalid saved Asset list");
    }
    return [];
  }

  function saveEndpoints() {
    if (window.localStorage) {
      window.localStorage.setItem("tsvHeadsetEndpoints", JSON.stringify(state.endpoints));
    }
  }

  function endpointLabel(endpoint) {
    try {
      return new URL(endpoint).host;
    } catch (error) {
      return endpoint;
    }
  }

  function connectedHeadsets() {
    return Array.from(state.headsets.values())
      .filter((headset) => headset.connected);
  }

  function setHeadsetStatus(endpoint, status, connected) {
    const existing = state.headsets.get(endpoint) || {};
    existing.endpoint = endpoint;
    existing.status = status;
    existing.connected = Boolean(connected);
    existing.lastSeen = existing.connected ? Date.now() : existing.lastSeen;
    state.headsets.set(endpoint, existing);
    updateConnectionState();
    renderHeadsetList();
  }

  function updateConnectionState() {
    const connected = connectedHeadsets().length;
    const total = state.endpoints.length;
    const live = connected > 0;
    els.socketStatus.textContent = live
      ? `${connected}/${total} live`
      : total > 0
        ? "No Asset live"
        : "No Asset";
    els.connectionPill.textContent = live ? "Live" : "Offline";
    els.feedMode.textContent = live ? "Live" : "Local";
    els.socketStatus.classList.toggle("good", live);
    els.socketStatus.classList.toggle("warn", !live);
    els.connectionPill.classList.toggle("good", live);
    els.connectionPill.classList.toggle("warn", !live);
    els.metricRadio.textContent = live ? `${connected} live` : "Local";
    els.metricHeadsets.textContent = String(connected);
  }

  function renderHeadsetList() {
    if (!els.headsetList) {
      return;
    }
    els.headsetList.replaceChildren();
    if (state.endpoints.length === 0) {
      const item = document.createElement("li");
      item.textContent = "No Asset endpoints saved.";
      els.headsetList.append(item);
      updateConnectionState();
      return;
    }
    state.endpoints.forEach((endpoint) => {
      const headset = state.headsets.get(endpoint) || { status: "Saved", connected: false };
      const item = document.createElement("li");
      const label = document.createElement("span");
      const status = document.createElement("b");
      const center = document.createElement("button");
      const connect = document.createElement("button");
      const remove = document.createElement("button");
      const node = Array.from(state.nodes.values()).find((candidate) =>
        candidate.endpoint === endpoint && candidate.isLocal);
      item.classList.toggle("is-selected", Boolean(node && node.id === state.selectedNodeId));
      label.textContent = endpointLabel(endpoint);
      status.textContent = headset.status || "Saved";
      status.className = headset.connected ? "good-text" : "warn-text";
      center.type = "button";
      center.textContent = "Center";
      center.disabled = !node;
      center.title = node ? `Center on ${node.label}` : "Waiting for a headset position";
      center.addEventListener("click", () => {
        if (node) {
          focusNode(node);
        }
      });
      connect.type = "button";
      connect.textContent = headset.connected ? "Reconnect" : "Connect";
      connect.addEventListener("click", () => connectHeadset(endpoint));
      remove.type = "button";
      remove.textContent = "Remove";
      remove.addEventListener("click", () => removeHeadset(endpoint));
      item.append(label, status, center, connect, remove);
      els.headsetList.append(item);
    });
  }

  function focusNode(node) {
    if (!node || !Number.isFinite(node.lat) || !Number.isFinite(node.lon)) {
      addFeed("CENTER", "No valid headset position is available yet");
      return;
    }
    state.selectedNodeId = node.id;
    map.flyTo([node.lat, node.lon], Math.max(map.getZoom(), 15), { duration: 0.45 });
    addFeed("CENTER", `Centered on ${node.label}`);
    renderHeadsetList();
  }

  function addHeadset() {
    const endpoint = normalizeEndpoint(els.headsetUrl.value);
    if (!endpoint) {
      addFeed("ASSET", "Enter an Asset URL");
      return;
    }
    if (!state.endpoints.includes(endpoint)) {
      state.endpoints.push(endpoint);
      saveEndpoints();
      setHeadsetStatus(endpoint, "Saved", false);
      addFeed("ASSET", `Saved ${endpoint}`);
    }
    els.headsetUrl.value = "";
    renderHeadsetList();
  }

  function removeHeadset(endpoint) {
    disconnectHeadset(endpoint);
    state.endpoints = state.endpoints.filter((item) => item !== endpoint);
    state.headsets.delete(endpoint);
    state.endpointSnapshots.delete(endpoint);
    stopSnapshotPolling(endpoint);
    saveEndpoints();
    renderHeadsetList();
    updateConnectionState();
    addFeed("ASSET", `Removed ${endpointLabel(endpoint)}`);
  }

  function connectHeadset(endpoint) {
    const normalized = normalizeEndpoint(endpoint);
    if (!normalized) {
      addFeed("ASSET", "Invalid Asset endpoint");
      return;
    }
    if (!state.endpoints.includes(normalized)) {
      state.endpoints.push(normalized);
      saveEndpoints();
    }
    disconnectHeadset(normalized, true);
    try {
      const socket = new WebSocket(normalized);
      state.headsets.set(normalized, {
        endpoint: normalized,
        socket,
        status: "Opening",
        connected: false,
        lastSeen: 0
      });
      renderHeadsetList();
      updateConnectionState();
      socket.addEventListener("open", () => {
        setHeadsetStatus(normalized, "Live", true);
        stopSnapshotPolling(normalized);
        addFeed("ASSET", `Connected ${endpointLabel(normalized)}`);
        socket.send(JSON.stringify({ type: "hello", client: "talleysoft-vision-web" }));
      });
      socket.addEventListener("message", (event) => {
        try {
          handleMessage(JSON.parse(event.data), normalized);
          setHeadsetStatus(normalized, "Live", true);
        } catch (error) {
          addFeed("ASSET", `Ignored malformed data from ${endpointLabel(normalized)}`);
        }
      });
      socket.addEventListener("close", () => {
        setHeadsetStatus(normalized, "Closed", false);
        startSnapshotPolling(normalized);
        addFeed("ASSET", `Closed ${endpointLabel(normalized)}`);
      });
      socket.addEventListener("error", () => {
        setHeadsetStatus(normalized, "Error", false);
        startSnapshotPolling(normalized);
        addFeed("ASSET", `Error ${endpointLabel(normalized)}; try the Asset URL directly`);
      });
    } catch (error) {
      setHeadsetStatus(normalized, "Error", false);
      startSnapshotPolling(normalized);
      addFeed("ASSET", error.message);
    }
  }

  function snapshotUrlForEndpoint(endpoint) {
    try {
      const url = new URL(endpoint);
      url.protocol = url.protocol === "wss:" ? "https:" : "http:";
      url.pathname = "/snapshot";
      url.search = "";
      url.hash = "";
      return url.toString();
    } catch (error) {
      return "";
    }
  }

  function controlUrlForEndpoint(endpoint, command) {
    try {
      const url = new URL(endpoint);
      url.protocol = url.protocol === "wss:" ? "https:" : "http:";
      url.pathname = "/control";
      url.search = `?command=${encodeURIComponent(command)}`;
      url.hash = "";
      return url.toString();
    } catch (error) {
      return "";
    }
  }

  function canAttemptHttpSnapshot(url) {
    try {
      const target = new URL(url);
      const host = target.hostname.toLowerCase();
      return window.location.protocol !== "https:" ||
        Boolean(targetAddressSpaceForHost(host)) ||
        host === window.location.hostname.toLowerCase();
    } catch (error) {
      return false;
    }
  }

  function targetAddressSpaceForHost(host) {
    if (host === "localhost" ||
        host === "::1" ||
        host.startsWith("127.")) {
      return "loopback";
    }
    return isPrivateNetworkHost(host) ? "local" : "";
  }

  function localFetchOptions(url) {
    const options = { cache: "no-store" };
    try {
      const target = new URL(url);
      const addressSpace = targetAddressSpaceForHost(
        target.hostname.toLowerCase());
      if (addressSpace) {
        options.targetAddressSpace = addressSpace;
      }
    } catch (error) {
      // Leave the normal fetch options in place for malformed URLs.
    }
    return options;
  }

  function isPrivateNetworkHost(host) {
    const parts = host.split(".").map((part) => Number(part));
    if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part))) {
      return false;
    }
    const [a, b] = parts;
    return a === 10 ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168);
  }

  function startSnapshotPolling(endpoint) {
    if (state.pollers.has(endpoint)) {
      return;
    }
    const snapshotUrl = snapshotUrlForEndpoint(endpoint);
    if (!snapshotUrl || !canAttemptHttpSnapshot(snapshotUrl)) {
      return;
    }

    const poller = {
      timer: null,
      inFlight: false,
      poll: null
    };

    const poll = async () => {
      if (poller.inFlight) {
        return;
      }
      poller.inFlight = true;
      try {
        const response = await fetch(
          snapshotUrl,
          localFetchOptions(snapshotUrl));
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }
        handleMessage(await response.json(), endpoint);
        setHeadsetStatus(endpoint, "Live snapshot", true);
      } catch (error) {
        setHeadsetStatus(endpoint, "No snapshot", false);
      } finally {
        poller.inFlight = false;
      }
    };

    poller.poll = poll;
    poller.timer = window.setInterval(poll, 1000);
    state.pollers.set(endpoint, poller);
    poll();
  }

  function stopSnapshotPolling(endpoint) {
    const poller = state.pollers.get(endpoint);
    if (!poller) {
      return;
    }
    window.clearInterval(poller.timer);
    state.pollers.delete(endpoint);
  }

  function requestSnapshotSoon(endpoint, delay = 160) {
    const poller = state.pollers.get(endpoint);
    if (poller && typeof poller.poll === "function") {
      window.setTimeout(poller.poll, delay);
      return;
    }
    const snapshotUrl = snapshotUrlForEndpoint(endpoint);
    if (!snapshotUrl || !canAttemptHttpSnapshot(snapshotUrl)) {
      return;
    }
    window.setTimeout(async () => {
      try {
        const response = await fetch(
          snapshotUrl,
          localFetchOptions(snapshotUrl));
        if (response.ok) {
          handleMessage(await response.json(), endpoint);
          setHeadsetStatus(endpoint, "Live snapshot", true);
        }
      } catch (error) {
        setHeadsetStatus(endpoint, "No snapshot", false);
      }
    }, delay);
  }

  function requestAllSnapshotsSoon(delay = 160) {
    state.endpoints.forEach((endpoint) => {
      requestSnapshotSoon(endpoint, delay);
    });
  }

  function disconnectHeadset(endpoint, quiet) {
    const headset = state.headsets.get(endpoint);
    if (headset && headset.socket) {
      headset.socket.close();
    }
    stopSnapshotPolling(endpoint);
    if (headset) {
      headset.socket = null;
      headset.connected = false;
      headset.status = "Closed";
      state.headsets.set(endpoint, headset);
    }
    if (!quiet) {
      addFeed("ASSET", `Disconnected ${endpointLabel(endpoint)}`);
    }
    renderHeadsetList();
    updateConnectionState();
  }

  function connectAllHeadsets() {
    if (state.endpoints.length === 0) {
      addFeed("ASSET", "Add at least one Asset endpoint first");
      return;
    }
    state.endpoints.forEach(connectHeadset);
  }

  function disconnectAllHeadsets() {
    state.endpoints.forEach((endpoint) => disconnectHeadset(endpoint, true));
    addFeed("ASSET", "Disconnected all Asset endpoints");
  }

  function markerId(marker) {
    if (marker.id) {
      return String(marker.id);
    }
    return `${marker.kind || "location"}:${marker.label || ""}:${marker.lat}:${marker.lon}`;
  }

  function destinationPoint(lat, lon, bearingDeg, meters) {
    const radius = 6371000;
    const bearing = bearingDeg * Math.PI / 180;
    const lat1 = lat * Math.PI / 180;
    const lon1 = lon * Math.PI / 180;
    const distance = meters / radius;
    const lat2 = Math.asin(
      Math.sin(lat1) * Math.cos(distance) +
      Math.cos(lat1) * Math.sin(distance) * Math.cos(bearing)
    );
    const lon2 = lon1 + Math.atan2(
      Math.sin(bearing) * Math.sin(distance) * Math.cos(lat1),
      Math.cos(distance) - Math.sin(lat1) * Math.sin(lat2)
    );
    return [lat2 * 180 / Math.PI, lon2 * 180 / Math.PI];
  }

  function clearDirection(id) {
    const existing = layers.directions.get(id);
    if (existing) {
      existing.remove();
      layers.directions.delete(id);
    }
  }

  function updateDirectionOverlay(marker) {
    clearDirection(marker.id);
    if (!["threat", "gunshot", "direction"].includes(marker.kind) ||
        marker.heading === null) {
      return;
    }

    const color = colors[marker.kind] || colors.location;
    const rangeMeters = marker.kind === "gunshot" ? 260 : 180;
    const group = L.layerGroup().addTo(map);
    const start = [marker.lat, marker.lon];
    const end = destinationPoint(marker.lat, marker.lon, marker.heading, rangeMeters);
    L.polyline([start, end], {
      color,
      weight: marker.kind === "gunshot" ? 4 : 3,
      opacity: 0.88
    }).addTo(group);

    const coneDegrees = Number(marker.coneDegrees || 0);
    if (coneDegrees > 0) {
      const left = destinationPoint(
        marker.lat,
        marker.lon,
        marker.heading - coneDegrees / 2,
        rangeMeters
      );
      const right = destinationPoint(
        marker.lat,
        marker.lon,
        marker.heading + coneDegrees / 2,
        rangeMeters
      );
      L.polygon([start, left, end, right], {
        color,
        fillColor: color,
        fillOpacity: 0.16,
        weight: 1,
        opacity: 0.7
      }).addTo(group);
    }
    layers.directions.set(marker.id, group);
  }

  function updateNode(input, endpoint) {
    const lat = normalizeNumber(input.lat ?? input.latitude);
    const lon = normalizeNumber(input.lon ?? input.longitude);
    if (lat === null || lon === null) {
      return;
    }
    const id = String(input.id || input.nodeId || input.nodeNum || "local");
    const label = input.label || input.shortName || input.longName || id;
    const now = Date.now();
    const node = {
      id,
      label,
      lat,
      lon,
      heading: normalizeNumber(input.heading ?? input.groundTrackDeg),
      accuracyYards: normalizeNumber(input.accuracyYards),
      source: input.source || "meshtastic",
      endpoint: endpoint || "local",
      updatedAt: now,
      isLocal: Boolean(input.isLocal)
    };
    const existing = state.nodes.get(id);
    if (existing && existing.updatedAt > now) {
      return;
    }
    state.nodes.set(id, node);
    if (node.isLocal || !state.latestNode || !state.latestNode.isLocal) {
      state.latestNode = node;
    }
    if (node.isLocal &&
        els.markerLat && els.markerLon &&
        (!els.markerLat.value || !els.markerLon.value ||
         els.markerLat.value === defaultCenter[0].toFixed(6) ||
         els.markerLon.value === defaultCenter[1].toFixed(6))) {
      els.markerLat.value = lat.toFixed(6);
      els.markerLon.value = lon.toFixed(6);
    }
    if (!state.didAutoCenter) {
      map.setView([lat, lon], Math.max(map.getZoom(), 15));
      state.didAutoCenter = true;
    }

    let layer = layers.nodes.get(id);
    const iconKind = node.source === "browser"
      ? "browser"
      : node.isLocal
        ? "headset"
        : "tracker";
    if (!layer) {
      layer = L.marker([lat, lon], { icon: iconFor(iconKind, label) })
        .addTo(map);
      layers.nodes.set(id, layer);
    }
    layer
      .setLatLng([lat, lon])
      .setIcon(iconFor(iconKind, label))
      .bindPopup(nodePopup(node));
    renderHeadsetList();
    updateMetrics();
    updateReadouts();
  }

  function nodePopup(node) {
    const heading = node.heading === null ? "--" : `${Math.round(node.heading)} deg`;
    const accuracy = node.accuracyYards === null ? "--" : `${Math.round(node.accuracyYards)} yd`;
    return `<strong>${escapeHtml(node.label)}</strong><br>Heading ${heading}<br>Accuracy ${accuracy}<br>${escapeHtml(node.source)}<br>${escapeHtml(endpointLabel(node.endpoint))}`;
  }

  function nodeKeyFromInput(input) {
    const lat = normalizeNumber(input.lat ?? input.latitude);
    const lon = normalizeNumber(input.lon ?? input.longitude);
    if (lat === null || lon === null) {
      return "";
    }
    return String(input.id || input.nodeId || input.nodeNum || "local");
  }

  function markerKeyFromInput(input) {
    if (String(input.source || "").toLowerCase() === "headset-trail") {
      return "";
    }
    const lat = normalizeNumber(input.lat ?? input.latitude);
    const lon = normalizeNumber(input.lon ?? input.longitude);
    if (lat === null || lon === null) {
      return "";
    }
    const kind = String(input.kind || input.type || "location").toLowerCase();
    const label = input.label || kind.toUpperCase();
    return markerId({ ...input, kind, lat, lon, label });
  }

  function removeNode(id) {
    state.nodes.delete(id);
    const layer = layers.nodes.get(id);
    if (layer) {
      layer.remove();
      layers.nodes.delete(id);
    }
    if (state.latestNode && state.latestNode.id === id) {
      state.latestNode = Array.from(state.nodes.values()).find((node) => node.isLocal) ||
        Array.from(state.nodes.values())[0] ||
        null;
    }
  }

  function removeMarker(id) {
    state.markers.delete(id);
    const markerLayer = layers.markers.get(id);
    if (markerLayer) {
      markerLayer.remove();
      layers.markers.delete(id);
    }
    clearDirection(id);
  }

  function rebuildRoutes() {
    layers.routes.forEach((route) => route.remove());
    layers.routes.clear();
    const routeLabels = new Set(
      Array.from(state.markers.values())
        .filter((marker) => marker.kind === "route")
        .map((marker) => marker.label)
    );
    routeLabels.forEach(updateRoute);
  }

  function reconcileSnapshot(endpoint, nodeIds, markerIds) {
    if (!endpoint) {
      return;
    }
    const previous = state.endpointSnapshots.get(endpoint) || {
      nodes: new Set(),
      markers: new Set()
    };
    previous.nodes.forEach((id) => {
      if (!nodeIds.has(id)) {
        const node = state.nodes.get(id);
        if (node && node.endpoint === endpoint) {
          removeNode(id);
        }
      }
    });
    let removedMarkers = false;
    previous.markers.forEach((id) => {
      if (!markerIds.has(id)) {
        const marker = state.markers.get(id);
        if (marker && marker.endpoint === endpoint) {
          removeMarker(id);
          removedMarkers = true;
        }
      }
    });
    state.endpointSnapshots.set(endpoint, {
      nodes: new Set(nodeIds),
      markers: new Set(markerIds)
    });
    if (removedMarkers) {
      rebuildRoutes();
    }
    updateMetrics();
    updateReadouts();
  }

  function updateMarker(input, endpoint) {
    if (String(input.source || "").toLowerCase() === "headset-trail") {
      return;
    }
    const lat = normalizeNumber(input.lat ?? input.latitude);
    const lon = normalizeNumber(input.lon ?? input.longitude);
    if (lat === null || lon === null) {
      return;
    }
    const kind = String(input.kind || input.type || "location").toLowerCase();
    const label = input.label || kind.toUpperCase();
    const ttl = normalizeNumber(input.ttlSeconds);
    const marker = {
      id: markerId({ ...input, kind, lat, lon, label }),
      kind,
      label,
      lat,
      lon,
      heading: normalizeNumber(input.heading ?? input.headingDeg),
      coneDegrees: normalizeNumber(input.coneDegrees),
      expiresAt: ttl !== null
        ? Date.now() + ttl * 1000
        : normalizeNumber(input.expiresAt),
      updatedAt: Date.now(),
      endpoint: endpoint || "local",
      selected: Boolean(input.selected)
    };
    const existing = state.markers.get(marker.id);
    state.markers.set(marker.id, marker);

    if (kind === "route") {
      const pointLayer = layers.markers.get(marker.id);
      if (pointLayer) {
        pointLayer.remove();
        layers.markers.delete(marker.id);
      }
      clearDirection(marker.id);
      rebuildRoutes();
      if (!existing ||
          existing.lat !== marker.lat ||
          existing.lon !== marker.lon ||
          existing.label !== marker.label ||
          existing.kind !== marker.kind) {
        addFeed("ROUTE", `${label} point ${lat.toFixed(5)}, ${lon.toFixed(5)}`);
      }
      updateMetrics();
      return;
    }

    let layer = layers.markers.get(marker.id);
    if (!layer) {
      layer = L.marker([lat, lon], {
        icon: iconFor(kind, label, marker.selected)
      }).addTo(map);
      layers.markers.set(marker.id, layer);
    }
    layer
      .setLatLng([lat, lon])
      .setIcon(iconFor(kind, label, marker.selected))
      .bindPopup(markerPopup(marker));

    updateDirectionOverlay(marker);
    if (!existing ||
        existing.lat !== marker.lat ||
        existing.lon !== marker.lon ||
        existing.label !== marker.label ||
        existing.kind !== marker.kind) {
      addFeed(kind.toUpperCase(), `${label} ${lat.toFixed(5)}, ${lon.toFixed(5)}`);
    }
    updateMetrics();
  }

  function markerPopup(marker) {
    const heading = marker.heading === null ? "" : `<br>Heading ${Math.round(marker.heading)} deg`;
    const selected = marker.selected ? "<br>Selected for edit/delete" : "";
    return `<strong>${escapeHtml(marker.label)}</strong><br>${escapeHtml(marker.kind.toUpperCase())}<br>${marker.lat.toFixed(6)}, ${marker.lon.toFixed(6)}${heading}${selected}<br>${escapeHtml(endpointLabel(marker.endpoint))}`;
  }

  function updateRoute(label) {
    const routePoints = Array.from(state.markers.values())
      .filter((marker) => marker.kind === "route" && marker.label === label)
      .sort((a, b) => a.updatedAt - b.updatedAt)
      .map((marker) => [marker.lat, marker.lon]);
    if (routePoints.length < 2) {
      return;
    }
    const existingRoute = layers.routes.get(label);
    if (existingRoute) {
      existingRoute.remove();
    }
    const line = L.polyline(routePoints, {
      color: colors.route,
      weight: 5,
      opacity: 0.94,
      lineCap: "round",
      lineJoin: "round"
    });
    const routeLabel = L.marker(line.getCenter(), {
      icon: iconFor("route", label),
      interactive: false
    });
    layers.routes.set(label, L.featureGroup([line, routeLabel]).addTo(map));
  }

  function autoCenterFromFeatures() {
    if (state.didAutoCenter) {
      return;
    }
    const points = [
      ...Array.from(state.nodes.values()).map((node) => [node.lat, node.lon]),
      ...Array.from(state.markers.values()).map((marker) => [marker.lat, marker.lon])
    ];
    if (points.length === 1) {
      map.setView(points[0], Math.max(map.getZoom(), 15));
      state.didAutoCenter = true;
      return;
    }
    if (points.length > 1) {
      map.fitBounds(L.latLngBounds(points).pad(0.18), { maxZoom: 15 });
      state.didAutoCenter = true;
    }
  }

  function handleMessage(payload, endpoint) {
    if (!payload || typeof payload !== "object") {
      return;
    }
    if (payload.type === "snapshot") {
      const nodeIds = new Set();
      const markerIds = new Set();
      (payload.nodes || []).forEach((node) => {
        const id = nodeKeyFromInput(node);
        if (id) {
          nodeIds.add(id);
        }
        updateNode(node, endpoint);
      });
      (payload.markers || []).forEach((marker) => {
        const id = markerKeyFromInput(marker);
        if (id) {
          markerIds.add(id);
        }
        updateMarker(marker, endpoint);
      });
      reconcileSnapshot(endpoint, nodeIds, markerIds);
      (payload.messages || []).forEach((message) => {
        addFeed(message.kind || "MSG", message.text || JSON.stringify(message));
      });
      if (!state.didAutoCenter && payload.center && payload.center.lat && payload.center.lon) {
        map.setView([payload.center.lat, payload.center.lon], payload.center.zoom || map.getZoom());
        state.didAutoCenter = true;
      } else {
        autoCenterFromFeatures();
      }
      return;
    }
    if (payload.type === "node" || payload.type === "position") {
      updateNode(payload, endpoint);
      return;
    }
    if (payload.type === "marker" || payload.type === "target") {
      updateMarker(payload, endpoint);
      return;
    }
    if (payload.type === "message") {
      addFeed(payload.kind || "MSG", payload.text || "Message received");
    }
  }

  function buildCommand(kind, lat, lon, heading, label) {
    const safeLabel = String(label || kind.toUpperCase()).trim();
    const sendLat = lat.toFixed(3);
    const sendLon = lon.toFixed(3);
    if (kind === "hold") {
      return `!stop ${sendLat} ${sendLon} ${safeLabel}`;
    }
    if (kind === "direction") {
      return `!markdir ${sendLat} ${sendLon} ${Math.round(heading || 0)} ${safeLabel}`;
    }
    if (kind === "threat" || kind === "gunshot") {
      return `!${kind} ${sendLat} ${sendLon} ${Math.round(heading || 0)} ${safeLabel}`;
    }
    if (kind === "lz") {
      return `!lz ${sendLat} ${sendLon} ${safeLabel}`;
    }
    return `!${kind} ${sendLat} ${sendLon} ${safeLabel}`;
  }

  function sendMarker(kind, lat, lon, heading, label, options = {}) {
    const marker = { type: "marker", kind, label, lat, lon, heading };
    if (kind === "threat") {
      marker.coneDegrees = 3;
      marker.ttlSeconds = 5;
    } else if (kind === "gunshot" || kind === "direction") {
      marker.ttlSeconds = 5;
    }
    updateMarker(marker);
    const command = buildCommand(kind, lat, lon, heading, label);
    const liveHeadsets = connectedHeadsets();
    if (liveHeadsets.length > 0) {
      liveHeadsets.forEach((headset) => {
        headset.socket.send(JSON.stringify({
          type: "marker_command",
          command,
          marker
        }));
        requestSnapshotSoon(headset.endpoint, 250);
        requestSnapshotSoon(headset.endpoint, 850);
      });
      if (!options.silent) {
        addFeed("SEND", `${command} sent to ${liveHeadsets.length} headset(s)`);
      }
    } else if (!options.silent && navigator.clipboard) {
      navigator.clipboard.writeText(command).catch(() => {});
      if (!options.silent) {
        addFeed("COPY", `${command} copied; no headset connected`);
      }
    } else if (!options.silent) {
      addFeed("COMMAND", command);
    }
  }

  function updateMarkerToolUi() {
    const active = state.placementKind;
    document.querySelectorAll("[data-marker-kind]").forEach((button) => {
      const isActive = button.getAttribute("data-marker-kind") === active;
      button.classList.toggle("is-active", isActive);
      button.setAttribute("aria-pressed", isActive ? "true" : "false");
    });
    if (els.finishRoute) {
      els.finishRoute.hidden = active !== "route";
      els.finishRoute.disabled = state.routeDraftPoints.length < 2;
    }
    if (els.cancelMarkerTool) {
      els.cancelMarkerTool.hidden = !active;
    }
    if (els.mapFrame) {
      els.mapFrame.classList.toggle("is-placing", Boolean(active));
      els.mapFrame.classList.toggle("is-route-drawing", state.routeDrawing);
    }
    if (els.markerToolStatus) {
      if (!active) {
        els.markerToolStatus.textContent = "Select Target or Route, then click or drag on the map.";
      } else if (active === "route") {
        const count = state.routeDraftPoints.length;
        els.markerToolStatus.textContent = count >= 2
          ? `ROUTE ${count} points ready • keep clicking or drag, then Finish Route`
          : "ROUTE armed • drag across the map or click points, then Finish Route";
      } else {
        els.markerToolStatus.textContent = `${active.toUpperCase()} armed • click the map to place it`;
      }
    }
  }

  function clearRoutePreview() {
    if (state.routePreview) {
      state.routePreview.remove();
      state.routePreview = null;
    }
  }

  function refreshRoutePreview() {
    clearRoutePreview();
    if (state.routeDraftPoints.length < 2) {
      return;
    }
    state.routePreview = L.polyline(state.routeDraftPoints, {
      color: colors.route,
      weight: 4,
      opacity: 0.9,
      dashArray: "8 8",
      interactive: false
    }).addTo(map);
  }

  function defaultLabelForKind(kind) {
    switch (String(kind || "").toLowerCase()) {
      case "route":
        return `PATH ${state.routeNumber}`;
      case "target":
        return "TARGET";
      case "threat":
        return "THREAT";
      case "gunshot":
        return "GUNSHOT";
      case "direction":
        return "DIRECTION";
      case "hold":
        return "HOLD";
      case "lz":
        return "LANDING ZONE";
      case "medical":
        return "MEDICAL";
      case "location":
        return "LOCATION";
      default:
        return String(kind || "MARKER").toUpperCase();
    }
  }

  function isGeneratedMarkerLabel(value) {
    const label = String(value || "").trim().toUpperCase();
    return !label || label === "RIDGE" ||
      /^(TARGET|THREAT|GUNSHOT|DIRECTION|HOLD|LOCATION|MEDICAL|LANDING ZONE|LZ|PATH|ROUTE)(?:\s+\d+)?$/.test(label);
  }

  function armMarkerTool(kind) {
    const next = String(kind || "target").toLowerCase();
    state.selectedKind = next;
    els.markerKind.value = next === "hold" ? "hold" : next;
    state.placementKind = next;
    state.routeDrawing = false;
    state.routeDraftPoints = [];
    clearRoutePreview();
    if (isGeneratedMarkerLabel(els.markerLabel.value)) {
      els.markerLabel.value = defaultLabelForKind(next);
    }
    if (next === "route") {
      state.routeLabel = els.markerLabel.value.trim().toUpperCase() || defaultLabelForKind("route");
    }
    updateMarkerToolUi();
    addFeed("TOOL", `${next.toUpperCase()} armed; click or drag on the map`);
  }

  function cancelMarkerTool() {
    state.placementKind = null;
    state.routeDrawing = false;
    state.routeDraftPoints = [];
    clearRoutePreview();
    updateMarkerToolUi();
    addFeed("TOOL", "Map tool cancelled");
  }

  function placeArmedMarker(latlng) {
    const kind = state.placementKind;
    if (!kind || kind === "route") {
      return;
    }
    const heading = normalizeNumber(els.markerHeading ? els.markerHeading.value : 0) || 0;
    const label = els.markerLabel.value.trim() || kind.toUpperCase();
    els.markerLat.value = latlng.lat.toFixed(6);
    els.markerLon.value = latlng.lng.toFixed(6);
    sendMarker(kind, latlng.lat, latlng.lng, heading, label);
    state.placementKind = null;
    updateMarkerToolUi();
  }

  function addRoutePoint(latlng) {
    if (state.placementKind !== "route") {
      return;
    }
    const previous = state.routeDraftPoints[state.routeDraftPoints.length - 1];
    if (previous && map.distance(previous, latlng) < 2) {
      return;
    }
    state.routeDraftPoints.push(latlng);
    els.markerLat.value = latlng.lat.toFixed(6);
    els.markerLon.value = latlng.lng.toFixed(6);
    refreshRoutePreview();
    updateMarkerToolUi();
  }

  function finishRoute() {
    if (state.routeDraftPoints.length < 2) {
      addFeed("ROUTE", "Add at least two points before finishing");
      return;
    }
    const label = state.routeLabel || `ROUTE ${state.routeNumber}`;
    const heading = normalizeNumber(els.markerHeading ? els.markerHeading.value : 0) || 0;
    state.routeDraftPoints.forEach((point) => {
      sendMarker("route", point.lat, point.lng, heading, label, { silent: true });
    });
    addFeed("ROUTE", `${label} sent with ${state.routeDraftPoints.length} points`);
    state.routeNumber += 1;
    state.placementKind = null;
    state.routeDrawing = false;
    state.routeDraftPoints = [];
    clearRoutePreview();
    updateMarkerToolUi();
  }

  function routePointFromPointer(event) {
    try {
      return map.mouseEventToLatLng(event);
    } catch (error) {
      return null;
    }
  }

  function startRoutePointer(event) {
    if (state.placementKind !== "route" || event.button === 2) {
      return;
    }
    const point = routePointFromPointer(event);
    if (!point) {
      return;
    }
    state.routeDrawing = true;
    state.routeSuppressClickUntil = Date.now() + 350;
    map.dragging.disable();
    if (mapElement.setPointerCapture && event.pointerId !== undefined) {
      mapElement.setPointerCapture(event.pointerId);
    }
    addRoutePoint(point);
    updateMarkerToolUi();
    event.preventDefault();
  }

  function moveRoutePointer(event) {
    if (!state.routeDrawing) {
      return;
    }
    const point = routePointFromPointer(event);
    if (point) {
      addRoutePoint(point);
    }
    event.preventDefault();
  }

  function endRoutePointer(event) {
    if (!state.routeDrawing) {
      return;
    }
    state.routeDrawing = false;
    map.dragging.enable();
    if (mapElement.releasePointerCapture && event.pointerId !== undefined &&
        mapElement.hasPointerCapture && mapElement.hasPointerCapture(event.pointerId)) {
      mapElement.releasePointerCapture(event.pointerId);
    }
    updateMarkerToolUi();
    event.preventDefault();
  }

  async function sendHeadsetControl(command) {
    const control = String(command || "").trim();
    if (!control) {
      return;
    }
    const liveHeadsets = connectedHeadsets()
      .filter((headset) =>
        headset.socket && headset.socket.readyState === WebSocket.OPEN);
    const snapshotHeadsets = Array.from(state.headsets.entries())
      .filter(([, headset]) => headset.connected)
      .filter(([, headset]) =>
        !headset.socket || headset.socket.readyState !== WebSocket.OPEN);

    if (liveHeadsets.length === 0 && snapshotHeadsets.length === 0) {
      addFeed("CONTROL", `${control} not sent; no headset connected`);
      return;
    }

    liveHeadsets.forEach((headset) => {
      headset.socket.send(JSON.stringify({
        type: "control",
        control
      }));
      requestSnapshotSoon(headset.endpoint, 250);
      requestSnapshotSoon(headset.endpoint, 850);
    });

    let httpSent = 0;
    for (const [endpoint] of snapshotHeadsets) {
      const controlUrl = controlUrlForEndpoint(endpoint, control);
      if (!controlUrl || !canAttemptHttpSnapshot(controlUrl)) {
        continue;
      }
      try {
        const response = await fetch(
          controlUrl,
          localFetchOptions(controlUrl));
        if (response.ok) {
          httpSent++;
          requestSnapshotSoon(endpoint, 250);
          requestSnapshotSoon(endpoint, 850);
        }
      } catch (error) {
        addFeed("CONTROL", `${endpointLabel(endpoint)} blocked ${control}`);
      }
    }

    addFeed(
      "CONTROL",
      `${control} sent to ${liveHeadsets.length + httpSent} headset(s)`);
    if (liveHeadsets.length + httpSent > 0) {
      requestAllSnapshotsSoon(1200);
    }
  }

  function updateMetrics() {
    els.metricHeadsets.textContent = String(connectedHeadsets().length);
    els.metricMarkers.textContent = String(state.markers.size);
    els.metricTargets.textContent = String(
      Array.from(state.markers.values()).filter((marker) => marker.kind === "target").length
    );
  }

  function updateReadouts() {
    const node = state.latestNode;
    if (!node) {
      els.gridReadout.textContent = `${defaultCenter[0].toFixed(5)}, ${defaultCenter[1].toFixed(5)}`;
      els.gpsReadout.textContent = "GPS WAIT";
      els.accuracyReadout.textContent = "ACC --";
      els.meshReadout.textContent = "NO HEADSET";
      return;
    }
    els.gridReadout.textContent = `${node.lat.toFixed(5)}, ${node.lon.toFixed(5)}`;
    els.gpsReadout.textContent = node.source === "browser" ? "GPS LIVE" : "GPS OK";
    els.accuracyReadout.textContent =
      node.accuracyYards === null ? "ACC --" : `ACC ${Math.round(node.accuracyYards)} yd`;
    els.meshReadout.textContent = node.source === "browser"
      ? "THIS DEVICE"
      : endpointLabel(node.endpoint).toUpperCase();
  }

  function pruneExpiredMarkers() {
    const now = Date.now();
    Array.from(state.markers.values()).forEach((marker) => {
      if (!marker.expiresAt || marker.expiresAt > now) {
        return;
      }
      removeMarker(marker.id);
    });
    rebuildRoutes();
    updateMetrics();
  }

  function loadDemo() {
    handleMessage({
      type: "snapshot",
      center: { lat: defaultCenter[0], lon: defaultCenter[1], zoom: defaultZoom },
      nodes: [
        { id: "!alpha", label: "ALPHA", lat: 34.298138, lon: -83.825764, heading: 42, accuracyYards: 12, isLocal: true },
        { id: "!bravo", label: "BRAVO", lat: 34.297530, lon: -83.827040, heading: 88, accuracyYards: 18 },
        { id: "!charlie", label: "CHARLIE", lat: 34.299140, lon: -83.824450, heading: 254, accuracyYards: 9 }
      ],
      markers: [
        { id: "target:square", kind: "target", label: "SQUARE", lat: 34.298900, lon: -83.824900 },
        { id: "threat:demo", kind: "threat", label: "THREAT", lat: 34.298650, lon: -83.825150, heading: 62, coneDegrees: 3, ttlSeconds: 5 },
        { id: "gunshot:demo", kind: "gunshot", label: "GUNSHOT", lat: 34.297760, lon: -83.826400, heading: 312, ttlSeconds: 5 },
        { id: "direction:demo", kind: "direction", label: "MARK DIR", lat: 34.298230, lon: -83.825950, heading: 118, ttlSeconds: 5 },
        { id: "lz:bravo", kind: "lz", label: "LZ BRAVO", lat: 34.297040, lon: -83.827380 },
        { id: "route:a:1", kind: "route", label: "ROUTE ALPHA", lat: 34.297530, lon: -83.827040 },
        { id: "route:a:2", kind: "route", label: "ROUTE ALPHA", lat: 34.298100, lon: -83.825900 },
        { id: "route:a:3", kind: "route", label: "ROUTE ALPHA", lat: 34.299140, lon: -83.824450 }
      ]
    }, "demo");
    addFeed("DEMO", "Loaded Gainesville Square telemetry snapshot");
  }

  document.querySelectorAll("[data-marker-kind]").forEach((button) => {
    button.addEventListener("click", () => {
      armMarkerTool(button.getAttribute("data-marker-kind") || "target");
    });
  });

  document.querySelectorAll("[data-map-action]").forEach((button) => {
    button.addEventListener("click", () => {
      if (button.getAttribute("data-map-action") === "center") {
        const selected = state.selectedNodeId && state.nodes.get(state.selectedNodeId);
        const node = selected || state.latestNode ||
          Array.from(state.nodes.values()).find((candidate) => candidate.isLocal);
        if (node) {
          focusNode(node);
        } else {
          addFeed("CENTER", "No headset position is available yet");
        }
      }
    });
  });

  if (els.finishRoute) {
    els.finishRoute.addEventListener("click", finishRoute);
  }
  if (els.cancelMarkerTool) {
    els.cancelMarkerTool.addEventListener("click", cancelMarkerTool);
  }

  document.querySelectorAll("[data-headset-control]").forEach((button) => {
    button.addEventListener("click", () => {
      sendHeadsetControl(button.getAttribute("data-headset-control"));
    });
  });

  els.markerForm.addEventListener("submit", (event) => {
    event.preventDefault();
    const kind = els.markerKind.value;
    const label = els.markerLabel.value.trim() || kind.toUpperCase();
    const lat = normalizeNumber(els.markerLat.value);
    const lon = normalizeNumber(els.markerLon.value);
    const heading = normalizeNumber(els.markerHeading ? els.markerHeading.value : 0) || 0;
    if (lat === null || lon === null) {
      addFeed("ERROR", "Marker latitude/longitude is invalid");
      return;
    }
    sendMarker(kind, lat, lon, heading, label);
  });

  map.on("click", (event) => {
    if (Date.now() < state.routeSuppressClickUntil) {
      return;
    }
    if (state.placementKind === "route") {
      addRoutePoint(event.latlng);
      return;
    }
    if (state.placementKind) {
      placeArmedMarker(event.latlng);
      return;
    }
    els.markerLat.value = event.latlng.lat.toFixed(6);
    els.markerLon.value = event.latlng.lng.toFixed(6);
    addFeed("POINT", "Marker coordinates set from map click");
  });

  mapElement.addEventListener("pointerdown", startRoutePointer, { passive: false });
  mapElement.addEventListener("pointermove", moveRoutePointer, { passive: false });
  mapElement.addEventListener("pointerup", endRoutePointer, { passive: false });
  mapElement.addEventListener("pointercancel", endRoutePointer, { passive: false });

  els.addHeadset.addEventListener("click", addHeadset);
  els.headsetUrl.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      addHeadset();
    }
  });
  els.connectAll.addEventListener("click", connectAllHeadsets);
  els.disconnectAll.addEventListener("click", disconnectAllHeadsets);
  els.loadDemo.addEventListener("click", loadDemo);

  state.endpoints = uniqueEndpoints([
    ...loadEndpoints(),
    ...discoverDefaultEndpoints()
  ]).filter((endpoint) => !isCurrentPageEndpoint(endpoint));
  saveEndpoints();
  renderHeadsetList();
  updateConnectionState();
  updateReadouts();
  updateMarkerToolUi();
  addFeed("READY", "Connecting to Asset telemetry endpoints");
  state.endpoints.forEach(connectHeadset);
  window.setInterval(pruneExpiredMarkers, 1000);
})();
