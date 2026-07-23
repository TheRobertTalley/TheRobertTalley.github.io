(function () {
  const mapElement = document.getElementById("ops-map");
  const feed = document.getElementById("event-feed");
  if (!mapElement || !window.L) {
    return;
  }

  const center = [39.123456, -77.123456];
  const map = L.map(mapElement, {
    zoomControl: true,
    preferCanvas: true
  }).setView(center, 15);

  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution: "&copy; OpenStreetMap contributors"
  }).addTo(map);

  const layers = {
    nodes: new Map(),
    markers: new Map(),
    routes: new Map()
  };

  const state = {
    socket: null,
    connected: false,
    selectedKind: "target",
    latestNode: null,
    nodes: new Map(),
    markers: new Map()
  };

  const els = {
    bridgeUrl: document.getElementById("bridge-url"),
    connect: document.getElementById("connect-bridge"),
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
    loadDemo: document.getElementById("load-demo")
  };

  const colors = {
    headset: "#41f19b",
    target: "#ff4c4c",
    threat: "#ffd447",
    hold: "#ff4c4c",
    route: "#4ddfea",
    lz: "#ffd447",
    medical: "#e4fff3",
    location: "#41f19b"
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
        return "!";
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

  function markerId(marker) {
    if (marker.id) {
      return String(marker.id);
    }
    return `${marker.kind || "location"}:${marker.label || ""}:${marker.lat}:${marker.lon}`;
  }

  function updateNode(input) {
    const lat = normalizeNumber(input.lat ?? input.latitude);
    const lon = normalizeNumber(input.lon ?? input.longitude);
    if (lat === null || lon === null) {
      return;
    }
    const id = String(input.id || input.nodeId || input.nodeNum || "local");
    const label = input.label || input.shortName || input.longName || id;
    const node = {
      id,
      label,
      lat,
      lon,
      heading: normalizeNumber(input.heading ?? input.groundTrackDeg),
      accuracyYards: normalizeNumber(input.accuracyYards),
      source: input.source || "meshtastic"
    };
    state.nodes.set(id, node);
    state.latestNode = node;

    let layer = layers.nodes.get(id);
    if (!layer) {
      layer = L.marker([lat, lon], { icon: iconFor("headset", label) })
        .addTo(map);
      layers.nodes.set(id, layer);
    }
    layer
      .setLatLng([lat, lon])
      .setIcon(iconFor("headset", label))
      .bindPopup(nodePopup(node));
    updateMetrics();
    updateReadouts();
  }

  function nodePopup(node) {
    const heading = node.heading === null ? "--" : `${Math.round(node.heading)}°`;
    const accuracy = node.accuracyYards === null ? "--" : `${Math.round(node.accuracyYards)} yd`;
    return `<strong>${escapeHtml(node.label)}</strong><br>Heading ${heading}<br>Accuracy ${accuracy}<br>${escapeHtml(node.source)}`;
  }

  function updateMarker(input) {
    const lat = normalizeNumber(input.lat ?? input.latitude);
    const lon = normalizeNumber(input.lon ?? input.longitude);
    if (lat === null || lon === null) {
      return;
    }
    const kind = String(input.kind || input.type || "location").toLowerCase();
    const label = input.label || kind.toUpperCase();
    const marker = {
      id: markerId({ ...input, kind, lat, lon, label }),
      kind,
      label,
      lat,
      lon,
      heading: normalizeNumber(input.heading ?? input.headingDeg),
      updatedAt: Date.now()
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

    if (kind === "route") {
      updateRoute(label);
    }
    addFeed(kind.toUpperCase(), `${label} ${lat.toFixed(5)}, ${lon.toFixed(5)}`);
    updateMetrics();
  }

  function markerPopup(marker) {
    return `<strong>${escapeHtml(marker.label)}</strong><br>${escapeHtml(marker.kind.toUpperCase())}<br>${marker.lat.toFixed(6)}, ${marker.lon.toFixed(6)}`;
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

  function handleMessage(payload) {
    if (!payload || typeof payload !== "object") {
      return;
    }
    if (payload.type === "snapshot") {
      (payload.nodes || []).forEach(updateNode);
      (payload.markers || []).forEach(updateMarker);
      (payload.messages || []).forEach((message) => {
        addFeed(message.kind || "MSG", message.text || JSON.stringify(message));
      });
      if (payload.center && payload.center.lat && payload.center.lon) {
        map.setView([payload.center.lat, payload.center.lon], payload.center.zoom || map.getZoom());
      }
      return;
    }
    if (payload.type === "node" || payload.type === "position") {
      updateNode(payload);
      return;
    }
    if (payload.type === "marker" || payload.type === "target") {
      updateMarker(payload);
      return;
    }
    if (payload.type === "message") {
      addFeed(payload.kind || "MSG", payload.text || "Message received");
    }
  }

  function setSocketState(connected, label) {
    state.connected = connected;
    els.socketStatus.textContent = label;
    els.connectionPill.textContent = connected ? "Live" : "Offline";
    els.feedMode.textContent = connected ? "Live" : "Local";
    els.socketStatus.classList.toggle("good", connected);
    els.socketStatus.classList.toggle("warn", !connected);
    els.connectionPill.classList.toggle("good", connected);
    els.connectionPill.classList.toggle("warn", !connected);
    els.metricRadio.textContent = connected ? "Bridge" : "Local";
  }

  function connectBridge() {
    const url = els.bridgeUrl.value.trim();
    if (!url) {
      return;
    }
    if (state.socket) {
      state.socket.close();
      state.socket = null;
    }
    try {
      const socket = new WebSocket(url);
      state.socket = socket;
      setSocketState(false, "Opening");
      socket.addEventListener("open", () => {
        setSocketState(true, "Live");
        addFeed("BRIDGE", `Connected to ${url}`);
        socket.send(JSON.stringify({ type: "hello", client: "talleysoft-vision-web" }));
      });
      socket.addEventListener("message", (event) => {
        try {
          handleMessage(JSON.parse(event.data));
        } catch (error) {
          addFeed("BRIDGE", "Ignored malformed bridge message");
        }
      });
      socket.addEventListener("close", () => {
        setSocketState(false, "Closed");
        addFeed("BRIDGE", "Realtime link closed");
      });
      socket.addEventListener("error", () => {
        setSocketState(false, "Error");
      });
    } catch (error) {
      setSocketState(false, "Error");
      addFeed("BRIDGE", error.message);
    }
  }

  function buildCommand(kind, lat, lon, label) {
    const safeLabel = String(label || kind.toUpperCase()).trim();
    if (kind === "hold") {
      return `!stop ${lat.toFixed(6)} ${lon.toFixed(6)} ${safeLabel}`;
    }
    return `!${kind} ${lat.toFixed(6)} ${lon.toFixed(6)} ${safeLabel}`;
  }

  function sendMarker(kind, lat, lon, label) {
    const marker = { type: "marker", kind, label, lat, lon };
    updateMarker(marker);
    const command = buildCommand(kind, lat, lon, label);
    if (state.socket && state.connected) {
      state.socket.send(JSON.stringify({
        type: "marker_command",
        command,
        marker
      }));
      addFeed("SEND", command);
    } else if (navigator.clipboard) {
      navigator.clipboard.writeText(command).catch(() => {});
      addFeed("COPY", `${command} copied for Meshtastic`);
    } else {
      addFeed("COMMAND", command);
    }
  }

  function updateMetrics() {
    els.metricHeadsets.textContent = String(state.nodes.size);
    els.metricMarkers.textContent = String(state.markers.size);
    els.metricTargets.textContent = String(
      Array.from(state.markers.values()).filter((marker) => marker.kind === "target").length
    );
  }

  function updateReadouts() {
    const node = state.latestNode;
    if (!node) {
      return;
    }
    els.gridReadout.textContent = `${node.lat.toFixed(5)}, ${node.lon.toFixed(5)}`;
    els.gpsReadout.textContent = "GPS OK";
    els.accuracyReadout.textContent =
      node.accuracyYards === null ? "ACC --" : `ACC ${Math.round(node.accuracyYards)} yd`;
    els.meshReadout.textContent = node.source.toUpperCase();
  }

  function loadDemo() {
    handleMessage({
      type: "snapshot",
      center: { lat: 39.123456, lon: -77.123456, zoom: 15 },
      nodes: [
        { id: "!alpha", label: "ALPHA", lat: 39.123456, lon: -77.123456, heading: 42, accuracyYards: 12 },
        { id: "!bravo", label: "BRAVO", lat: 39.1218, lon: -77.1281, heading: 88, accuracyYards: 18 },
        { id: "!charlie", label: "CHARLIE", lat: 39.1252, lon: -77.1198, heading: 254, accuracyYards: 9 }
      ],
      markers: [
        { id: "target:ridge", kind: "target", label: "RIDGE", lat: 39.1261, lon: -77.1179 },
        { id: "lz:bravo", kind: "lz", label: "LZ BRAVO", lat: 39.1199, lon: -77.1308 },
        { id: "route:a:1", kind: "route", label: "ROUTE ALPHA", lat: 39.1211, lon: -77.1274 },
        { id: "route:a:2", kind: "route", label: "ROUTE ALPHA", lat: 39.1228, lon: -77.1241 },
        { id: "route:a:3", kind: "route", label: "ROUTE ALPHA", lat: 39.1242, lon: -77.1213 }
      ]
    });
    addFeed("DEMO", "Loaded local telemetry snapshot");
  }

  document.querySelectorAll("[data-marker-kind]").forEach((button) => {
    button.addEventListener("click", () => {
      state.selectedKind = button.getAttribute("data-marker-kind") || "target";
      els.markerKind.value = state.selectedKind === "hold" ? "hold" : state.selectedKind;
      const centerPoint = map.getCenter();
      els.markerLat.value = centerPoint.lat.toFixed(6);
      els.markerLon.value = centerPoint.lng.toFixed(6);
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
          map.setView(center, 15);
          addFeed("CENTER", "Centered on default operations area");
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
    if (lat === null || lon === null) {
      addFeed("ERROR", "Marker latitude/longitude is invalid");
      return;
    }
    sendMarker(kind, lat, lon, label);
  });

  map.on("click", (event) => {
    els.markerLat.value = event.latlng.lat.toFixed(6);
    els.markerLon.value = event.latlng.lng.toFixed(6);
    addFeed("POINT", "Marker coordinates set from map click");
  });

  els.connect.addEventListener("click", connectBridge);
  els.loadDemo.addEventListener("click", loadDemo);

  setSocketState(false, "Closed");
  loadDemo();
})();
