(function () {
  const mapElement = document.getElementById("ops-map");
  const feed = document.getElementById("event-feed");
  if (!mapElement || !window.L) {
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

  const state = {
    selectedKind: "target",
    latestNode: null,
    didAutoCenter: false,
    nodes: new Map(),
    markers: new Map(),
    endpoints: [],
    headsets: new Map()
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
    tracker: "#ffd447"
  };

  function iconFor(kind, label) {
    const safeLabel = escapeHtml(label || kind.toUpperCase());
    const color = colors[kind] || colors.location;
    return L.divIcon({
      className: "tsv-marker",
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

  function normalizeEndpoint(value) {
    let endpoint = String(value || "").trim();
    if (!endpoint) {
      return "";
    }
    if (!/^wss?:\/\//i.test(endpoint)) {
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
      addFeed("HEADSET", "Ignored invalid saved headset list");
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
        ? "No headset live"
        : "No headset";
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
      item.textContent = "No headset endpoints saved.";
      els.headsetList.append(item);
      updateConnectionState();
      return;
    }
    state.endpoints.forEach((endpoint) => {
      const headset = state.headsets.get(endpoint) || { status: "Saved", connected: false };
      const item = document.createElement("li");
      const label = document.createElement("span");
      const status = document.createElement("b");
      const connect = document.createElement("button");
      const remove = document.createElement("button");
      label.textContent = endpointLabel(endpoint);
      status.textContent = headset.status || "Saved";
      status.className = headset.connected ? "good-text" : "warn-text";
      connect.type = "button";
      connect.textContent = headset.connected ? "Reconnect" : "Connect";
      connect.addEventListener("click", () => connectHeadset(endpoint));
      remove.type = "button";
      remove.textContent = "Remove";
      remove.addEventListener("click", () => removeHeadset(endpoint));
      item.append(label, status, connect, remove);
      els.headsetList.append(item);
    });
  }

  function addHeadset() {
    const endpoint = normalizeEndpoint(els.headsetUrl.value);
    if (!endpoint) {
      addFeed("HEADSET", "Enter a headset IP or WebSocket URL");
      return;
    }
    if (!state.endpoints.includes(endpoint)) {
      state.endpoints.push(endpoint);
      saveEndpoints();
      setHeadsetStatus(endpoint, "Saved", false);
      addFeed("HEADSET", `Saved ${endpoint}`);
    }
    els.headsetUrl.value = "";
    renderHeadsetList();
  }

  function removeHeadset(endpoint) {
    disconnectHeadset(endpoint);
    state.endpoints = state.endpoints.filter((item) => item !== endpoint);
    state.headsets.delete(endpoint);
    saveEndpoints();
    renderHeadsetList();
    updateConnectionState();
    addFeed("HEADSET", `Removed ${endpointLabel(endpoint)}`);
  }

  function connectHeadset(endpoint) {
    const normalized = normalizeEndpoint(endpoint);
    if (!normalized) {
      addFeed("HEADSET", "Invalid headset endpoint");
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
        socket,
        status: "Opening",
        connected: false,
        lastSeen: 0
      });
      renderHeadsetList();
      updateConnectionState();
      socket.addEventListener("open", () => {
        setHeadsetStatus(normalized, "Live", true);
        addFeed("HEADSET", `Connected ${endpointLabel(normalized)}`);
        socket.send(JSON.stringify({ type: "hello", client: "talleysoft-vision-web" }));
      });
      socket.addEventListener("message", (event) => {
        try {
          handleMessage(JSON.parse(event.data), normalized);
          setHeadsetStatus(normalized, "Live", true);
        } catch (error) {
          addFeed("HEADSET", `Ignored malformed data from ${endpointLabel(normalized)}`);
        }
      });
      socket.addEventListener("close", () => {
        setHeadsetStatus(normalized, "Closed", false);
        addFeed("HEADSET", `Closed ${endpointLabel(normalized)}`);
      });
      socket.addEventListener("error", () => {
        setHeadsetStatus(normalized, "Error", false);
        addFeed("HEADSET", `Error ${endpointLabel(normalized)}; try http://HEADSET-IP:8787/ directly`);
      });
    } catch (error) {
      setHeadsetStatus(normalized, "Error", false);
      addFeed("HEADSET", error.message);
    }
  }

  function disconnectHeadset(endpoint, quiet) {
    const headset = state.headsets.get(endpoint);
    if (headset && headset.socket) {
      headset.socket.close();
    }
    if (headset) {
      headset.socket = null;
      headset.connected = false;
      headset.status = "Closed";
      state.headsets.set(endpoint, headset);
    }
    if (!quiet) {
      addFeed("HEADSET", `Disconnected ${endpointLabel(endpoint)}`);
    }
    renderHeadsetList();
    updateConnectionState();
  }

  function connectAllHeadsets() {
    if (state.endpoints.length === 0) {
      addFeed("HEADSET", "Add at least one headset endpoint first");
      return;
    }
    state.endpoints.forEach(connectHeadset);
  }

  function disconnectAllHeadsets() {
    state.endpoints.forEach((endpoint) => disconnectHeadset(endpoint, true));
    addFeed("HEADSET", "Disconnected all headset endpoints");
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
    state.latestNode = node;
    if (!state.didAutoCenter) {
      map.setView([lat, lon], Math.max(map.getZoom(), 15));
      state.didAutoCenter = true;
    }

    let layer = layers.nodes.get(id);
    const iconKind = node.isLocal ? "headset" : "tracker";
    if (!layer) {
      layer = L.marker([lat, lon], { icon: iconFor(iconKind, label) })
        .addTo(map);
      layers.nodes.set(id, layer);
    }
    layer
      .setLatLng([lat, lon])
      .setIcon(iconFor(iconKind, label))
      .bindPopup(nodePopup(node));
    updateMetrics();
    updateReadouts();
  }

  function nodePopup(node) {
    const heading = node.heading === null ? "--" : `${Math.round(node.heading)} deg`;
    const accuracy = node.accuracyYards === null ? "--" : `${Math.round(node.accuracyYards)} yd`;
    return `<strong>${escapeHtml(node.label)}</strong><br>Heading ${heading}<br>Accuracy ${accuracy}<br>${escapeHtml(node.source)}<br>${escapeHtml(endpointLabel(node.endpoint))}`;
  }

  function updateMarker(input, endpoint) {
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
      endpoint: endpoint || "local"
    };
    state.markers.set(marker.id, marker);

    let layer = layers.markers.get(marker.id);
    if (!layer) {
      layer = L.marker([lat, lon], { icon: iconFor(kind, label) }).addTo(map);
      layers.markers.set(marker.id, layer);
    }
    layer
      .setLatLng([lat, lon])
      .setIcon(iconFor(kind, label))
      .bindPopup(markerPopup(marker));

    updateDirectionOverlay(marker);
    if (kind === "route") {
      updateRoute(label);
    }
    addFeed(kind.toUpperCase(), `${label} ${lat.toFixed(5)}, ${lon.toFixed(5)}`);
    updateMetrics();
  }

  function markerPopup(marker) {
    const heading = marker.heading === null ? "" : `<br>Heading ${Math.round(marker.heading)} deg`;
    return `<strong>${escapeHtml(marker.label)}</strong><br>${escapeHtml(marker.kind.toUpperCase())}<br>${marker.lat.toFixed(6)}, ${marker.lon.toFixed(6)}${heading}<br>${escapeHtml(endpointLabel(marker.endpoint))}`;
  }

  function updateRoute(label) {
    const routePoints = Array.from(state.markers.values())
      .filter((marker) => marker.kind === "route" && marker.label === label)
      .sort((a, b) => a.updatedAt - b.updatedAt)
      .map((marker) => [marker.lat, marker.lon]);
    if (routePoints.length < 2) {
      return;
    }
    let route = layers.routes.get(label);
    if (!route) {
      route = L.polyline(routePoints, {
        color: colors.route,
        weight: 3,
        opacity: 0.86
      }).addTo(map);
      layers.routes.set(label, route);
      return;
    }
    route.setLatLngs(routePoints);
  }

  function handleMessage(payload, endpoint) {
    if (!payload || typeof payload !== "object") {
      return;
    }
    if (payload.type === "snapshot") {
      (payload.nodes || []).forEach((node) => updateNode(node, endpoint));
      (payload.markers || []).forEach((marker) => updateMarker(marker, endpoint));
      (payload.messages || []).forEach((message) => {
        addFeed(message.kind || "MSG", message.text || JSON.stringify(message));
      });
      if (!state.didAutoCenter && payload.center && payload.center.lat && payload.center.lon) {
        map.setView([payload.center.lat, payload.center.lon], payload.center.zoom || map.getZoom());
        state.didAutoCenter = true;
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
    if (kind === "hold") {
      return `!stop ${lat.toFixed(6)} ${lon.toFixed(6)} ${safeLabel}`;
    }
    if (kind === "direction") {
      return `!markdir ${lat.toFixed(6)} ${lon.toFixed(6)} ${Math.round(heading || 0)} ${safeLabel}`;
    }
    if (kind === "threat" || kind === "gunshot") {
      return `!${kind} ${lat.toFixed(6)} ${lon.toFixed(6)} ${Math.round(heading || 0)} ${safeLabel}`;
    }
    if (kind === "lz") {
      return `!lz ${lat.toFixed(6)} ${lon.toFixed(6)} ${safeLabel}`;
    }
    return `!${kind} ${lat.toFixed(6)} ${lon.toFixed(6)} ${safeLabel}`;
  }

  function sendMarker(kind, lat, lon, heading, label) {
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
      });
      addFeed("SEND", `${command} sent to ${liveHeadsets.length} headset(s)`);
    } else if (navigator.clipboard) {
      navigator.clipboard.writeText(command).catch(() => {});
      addFeed("COPY", `${command} copied; no headset connected`);
    } else {
      addFeed("COMMAND", command);
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
    els.gpsReadout.textContent = "GPS OK";
    els.accuracyReadout.textContent =
      node.accuracyYards === null ? "ACC --" : `ACC ${Math.round(node.accuracyYards)} yd`;
    els.meshReadout.textContent = endpointLabel(node.endpoint).toUpperCase();
  }

  function pruneExpiredMarkers() {
    const now = Date.now();
    Array.from(state.markers.values()).forEach((marker) => {
      if (!marker.expiresAt || marker.expiresAt > now) {
        return;
      }
      state.markers.delete(marker.id);
      const markerLayer = layers.markers.get(marker.id);
      if (markerLayer) {
        markerLayer.remove();
        layers.markers.delete(marker.id);
      }
      clearDirection(marker.id);
    });
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
      state.selectedKind = button.getAttribute("data-marker-kind") || "target";
      els.markerKind.value = state.selectedKind === "hold" ? "hold" : state.selectedKind;
      const centerPoint = map.getCenter();
      els.markerLat.value = centerPoint.lat.toFixed(6);
      els.markerLon.value = centerPoint.lng.toFixed(6);
      if (els.markerHeading && state.latestNode && state.latestNode.heading !== null) {
        els.markerHeading.value = Math.round(state.latestNode.heading);
      }
      addFeed("TOOL", `${state.selectedKind.toUpperCase()} marker armed at map center`);
    });
  });

  document.querySelectorAll("[data-map-action]").forEach((button) => {
    button.addEventListener("click", () => {
      if (button.getAttribute("data-map-action") === "center") {
        if (state.latestNode) {
          map.setView([state.latestNode.lat, state.latestNode.lon], Math.max(map.getZoom(), 15));
          addFeed("CENTER", `Centered on ${state.latestNode.label}`);
        } else {
          map.setView(defaultCenter, defaultZoom);
          addFeed("CENTER", "Centered on Gainesville Square");
        }
      }
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
    els.markerLat.value = event.latlng.lat.toFixed(6);
    els.markerLon.value = event.latlng.lng.toFixed(6);
    addFeed("POINT", "Marker coordinates set from map click");
  });

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

  state.endpoints = Array.from(new Set(loadEndpoints()));
  renderHeadsetList();
  updateConnectionState();
  updateReadouts();
  addFeed("READY", "Gainesville Square loaded; add each headset endpoint for live map data");
  window.setInterval(pruneExpiredMarkers, 1000);
})();
