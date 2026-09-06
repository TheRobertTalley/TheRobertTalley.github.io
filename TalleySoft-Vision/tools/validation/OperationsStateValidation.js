"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const api = require("../../assets/telemetry-connection.js");
const source = fs.readFileSync(path.join(__dirname, "../../assets/talleysoft-site.js"), "utf8");
const production = name => {
  const match = source.match(new RegExp("^  (?:async )?function " + name + "\\([^]*?^  \\}", "m"));
  assert.ok(match, name); return match[0];
};
function rig() {
  const classes = new Set();
  const element = () => ({ value: "", textContent: "", classList: { toggle(name, value) {
    if (value) classes.add(name); else classes.delete(name);
  } } });
  const events = [], buttons = [{}, {}], help = {}, submit = {}, messageSnapshots = [];
  let now = 2000000000000, center = { lat: 20, lng: 0 }, zoom = 2;
  const c = vm.createContext({ console, Map, Set, URL, JSON, Number,
    Date: { now: () => now }, window: { TsvTelemetry: api, location: { protocol: "https:", hostname: "pages.example" } },
    document: { querySelectorAll: () => buttons, getElementById: () => help },
    meshMessaging: { updateEndpoint: (...args) => messageSnapshots.push(args) },
    state: { nodes: new Map(), markers: new Map(), headsets: new Map(), endpointSnapshots: new Map(),
      seenMessages: new Map(), testViewRestore: null, didAutoCenter: false, latestNode: null },
    layers: { nodes: new Map(), markers: new Map() }, defaultCenter: [20, 0],
    map: { getCenter: () => center, getZoom: () => zoom, setView(p, z) {
      center = Array.isArray(p) ? { lat: p[0], lng: p[1] } : p; zoom = z;
    } },
    els: { markerLat: element(), markerLon: element(), gpsReadout: element(), gridReadout: element(),
      accuracyReadout: element(), meshReadout: element(), markerForm: { querySelector: () => submit } },
    connectedHeadsets: () => [...c.state.headsets.values()].filter(h => h.connected),
    endpointLabel: value => value, targetAddressSpaceForHost: api.addressSpace,
    addFeed: (kind, text) => events.push({ kind, text }),
    renderHeadsetList() {}, updateMetrics() {}, refreshNodeMarkerPositions() {}, rebuildRoutes() {},
    autoCenterFromFeatures() {}, updateMarker() {}, markerKeyFromInput() { return ""; },
    removeMarker() {}, escapeHtml: value => String(value)
  });
  vm.runInContext(["normalizeNumber", "hasValidCoordinates", "updateNode", "nodeKeyFromInput", "removeNode",
    "reconcileSnapshot", "handleMessage", "receiveMessage", "updateReadouts", "updateControlAvailability",
    "restoreAfterTestLocation", "pruneExpiredMarkers", "nodePopup", "canAttemptHttpSnapshot",
    "loadEndpoints", "saveEndpoints"].map(production).join("\n"), c);
  return { c, events, classes, buttons, help, submit, messageSnapshots, now: () => now, advance: ms => { now += ms; },
    center: () => center, zoom: () => zoom };
}
const endpoint = "wss://private.example.ts.net:9443";
const empty = { type: "snapshot", source: "headset", localHandle: "S1", nodes: [], markers: [], messages: [],
  radioStatus: "USB waiting", positionStatus: "GPS waiting", readOnly: true,
  capabilities: { commands: false, messages: true } };
const r = rig(), c = r.c;
c.state.headsets.set(endpoint, { connected: true });
c.handleMessage(api.normalizeSnapshot(empty), endpoint);
assert.equal(c.state.headsets.get(endpoint).assetLabel, "S1 · Quest headset");
assert.equal(c.state.nodes.size, 0);
assert.equal(c.els.gpsReadout.textContent, "GPS WAIT");
assert.equal(r.buttons.every(button => button.disabled), true);
assert.match(r.help.textContent, /This connection allows viewing only/);
assert.equal(r.submit.textContent, "Preview Marker");
assert.equal(r.messageSnapshots[0][1].capabilities.messages, true);
assert.equal(r.messageSnapshots[0][2].connected, true);
c.state.headsets.get(endpoint).connected = false;
c.updateControlAvailability();
assert.equal(r.buttons.every(button => button.disabled), true, "Offline controls stay disabled");
assert.equal(r.submit.textContent, "Preview Marker", "Offline marker action is local only");
assert.equal(r.help.textContent, "Connect a headset to use controls.");
c.state.headsets.get(endpoint).connected = true;

const test = { ...empty, testLocationActive: true, testLocationId: "explicit-test", testLocationExpiresUnix: r.now() / 1000 + 120,
  center: { lat: 1.25, lon: 2.5, zoom: 16 },
  nodes: [{ id: "test-location:explicit-test", source: "test-location", label: "TEST LOCATION",
    lat: 1.25, lon: 2.5, positionTimeUnix: r.now() / 1000, isLocal: false }] };
c.handleMessage(api.normalizeSnapshot(test), endpoint);
assert.equal(c.els.gpsReadout.textContent, "TEST LOCATION");
assert.equal(r.classes.has("test-location"), true);
assert.equal(c.els.markerLat.value, "", "Synthetic position must not prefill a radio marker");
assert.equal(r.center().lat, 1.25);
assert.match(c.nodePopup([...c.state.nodes.values()][0]), /synthetic position, not a GPS fix/);
r.advance(121000); c.pruneExpiredMarkers(); c.updateReadouts();
assert.equal(c.state.nodes.size, 0);
assert.equal(c.els.gpsReadout.textContent, "GPS WAIT");
assert.equal(r.classes.has("test-location"), false);
assert.equal(r.center().lat, 20); assert.equal(r.zoom(), 2);
c.handleMessage(api.normalizeSnapshot(test), endpoint);
assert.equal(c.state.nodes.size, 0, "Expired snapshots cannot revive the test");

const second = { ...test, testLocationExpiresUnix: r.now() / 1000 + 120 };
c.handleMessage(api.normalizeSnapshot(second), endpoint);
c.handleMessage(api.normalizeSnapshot(empty), endpoint);
assert.equal(c.state.nodes.size, 0, "Server cancellation removes synthetic position immediately");
assert.equal(r.center().lat, 20);
const message = { type: "message", kind: "MESH", from: "test-sender", receivedUnix: 123, text: "Fixture text" };
c.handleMessage({ ...empty, messages: [message] }, endpoint);
c.handleMessage({ ...empty, messages: [message] }, endpoint);
c.handleMessage(message, endpoint);
assert.equal(r.events.filter(e => e.text === "Fixture text").length, 1);
c.handleMessage({ ...message, receivedUnix: 124 }, endpoint);
assert.equal(r.events.filter(e => e.text === "Fixture text").length, 2);
assert.equal(c.canAttemptHttpSnapshot("https://relay.example/snapshot"), true);
assert.equal(c.canAttemptHttpSnapshot("http://public.example/snapshot"), false);
Object.defineProperty(c.window, "localStorage", { get() { throw new Error("Storage denied"); } });
assert.equal(c.loadEndpoints().length, 0); c.saveEndpoints();
assert.match(r.events.at(-1).text, /this session/);
console.log("Operations no-GPS, read-only, synthetic expiry, restoration and feed checks: PASS");
