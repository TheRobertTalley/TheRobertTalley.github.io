"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const source = fs.readFileSync(path.join(__dirname, "../../assets/talleysoft-site.js"), "utf8");

// Execute the actual page functions with inert map and transport boundaries.
// No browser, socket, radio, or network connection is opened by this harness.
function production(name) {
  const match = source.match(new RegExp("^  (?:async )?function " + name + "\\([^]*?^  \\}", "m"));
  assert.ok(match, `Production function exists: ${name}`);
  return match[0];
}

function rig(names = []) {
  const events = [], localMarkers = [], queued = [];
  const context = vm.createContext({
    console, URL, Promise, Map, Set, Date,
    WebSocket: { OPEN: 1 }, navigator: {},
    state: { nodes: new Map(), markers: new Map(), headsets: new Map(),
      routeDraftPoints: [], routeLabel: "ROUTE 1", routeNumber: 1 },
    els: { markerHeading: { value: "0" }, markerLat: { value: "" }, markerLon: { value: "" },
      markerKind: { value: "target" }, markerLabel: { value: "TARGET" } },
    addFeed: (kind, message) => events.push({ kind, message }),
    updateMarker: marker => localMarkers.push(marker),
    connectedHeadsets() { return [...context.state.headsets.values()].filter(h => h.connected); },
    markerUrlForEndpoint: endpoint => `http://${endpoint}/marker`,
    controlUrlForEndpoint: (endpoint, command) => `http://${endpoint}/control?command=${command}`,
    endpointLabel: endpoint => endpoint,
    canAttemptHttpSnapshot: () => true, localFetchOptions: () => ({}),
    requestSnapshotSoon: () => {}, requestAllSnapshotsSoon: () => {},
    clearRoutePreview: () => {}, updateMarkerToolUi: () => {},
    fetch: async () => { throw new Error("Unexpected transport request"); }
  });
  const functions = ["normalizeNumber", "hasValidCoordinates", "buildCommand", ...names];
  vm.runInContext([...new Set(functions)].map(production).join("\n"), context);
  return { context, events, localMarkers, queued };
}

let passed = 0;
async function check(name, test) {
  await test(); passed++; console.log(`PASS ${name}`);
}
const endpoint = (name, extra = {}) => ({ endpoint: name, connected: true, supportsCommands: true, ...extra });
const flush = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };

(async () => {
  await check("blank, missing and nonnumeric values cannot fabricate zero", () => {
    const { context: c } = rig();
    for (const value of ["", " \t", null, undefined, false, true, [], {}, "NaN", Infinity])
      assert.equal(c.normalizeNumber(value), null);
    assert.equal(c.normalizeNumber("0"), 0);
    assert.equal(c.normalizeNumber(" -83.825764 "), -83.825764);
    assert.equal(c.hasValidCoordinates(0, 0), true, "Explicit zero is a valid coordinate");
    assert.equal(c.hasValidCoordinates(-90, 180), true);
    for (const pair of [[90.01, 0], [0, -180.01], [null, 0], [NaN, 0]])
      assert.equal(c.hasValidCoordinates(...pair), false);
  });

  await check("incoming invalid nodes and markers are ignored before rendering", () => {
    const { context: c } = rig(["updateNode", "nodeKeyFromInput", "updateMarker", "markerKeyFromInput", "markerId"]);
    for (const input of [{ lat: "", lon: "" }, { lat: 91, lon: 0 }, { latitude: 0, longitude: -181 }, { lat: null, lon: null }]) {
      c.updateNode(input, "headset"); c.updateMarker(input, "headset");
      assert.equal(c.nodeKeyFromInput(input, "headset"), "");
      assert.equal(c.markerKeyFromInput(input), "");
    }
    assert.equal(c.state.nodes.size, 0); assert.equal(c.state.markers.size, 0);
    assert.notEqual(c.nodeKeyFromInput({ lat: 0, lon: 0, id: "zero" }, "headset"), "");
    assert.notEqual(c.markerKeyFromInput({ lat: 0, lon: 0, kind: "target" }), "");
  });

  await check("actual blank and invalid marker form submissions do not send", () => {
    const { context: c, events } = rig(); let submitted, sends = 0;
    c.els.markerForm = { addEventListener(_event, callback) { submitted = callback; } };
    c.sendMarker = () => { sends++; };
    const form = source.match(/^  els\.markerForm\.addEventListener\("submit",[^]*?^  \}\);/m);
    assert.ok(form); vm.runInContext(form[0], c);
    submitted({ preventDefault() {} });
    c.els.markerLat.value = "91"; c.els.markerLon.value = "0";
    submitted({ preventDefault() {} });
    assert.equal(sends, 0); assert.equal(events.length, 2);
    c.els.markerLat.value = "0";
    submitted({ preventDefault() {} }); assert.equal(sends, 1);
  });

  await check("public marker send boundary rejects invalid coordinates", async () => {
    const { context: c, localMarkers } = rig(["sendMarker"]);
    const result = await c.sendMarker("target", 91, 0, 0, "TARGET");
    assert.equal(result.valid, false); assert.equal(localMarkers.length, 0);
  });

  await check("explicit HTTP marker rejection is not resent over WebSocket", async () => {
    const { context: c } = rig(["postMarkerToHeadset"]); let sends = 0;
    const h = endpoint("headset", { socket: { readyState: 1, send() { sends++; } } });
    for (const response of [{ ok: false }, { ok: true, json: async () => ({ ok: false }) },
      { ok: true, json: async () => ({}) }]) {
      c.fetch = async () => response;
      assert.equal(await c.postMarkerToHeadset(h, {}), false);
    }
    assert.equal(sends, 0);
    c.fetch = async () => ({ ok: true, json: async () => ({ ok: true }) });
    assert.equal(await c.postMarkerToHeadset(h, {}), true); assert.equal(sends, 0);
  });

  await check("failed WebSocket marker send is contained", async () => {
    const { context: c } = rig(["postMarkerToHeadset"]);
    c.canAttemptHttpSnapshot = () => false;
    const h = endpoint("headset", { socket: { readyState: 1, send() { throw new Error("closed"); } } });
    assert.equal(await c.postMarkerToHeadset(h, {}), false);
  });

  await check("marker summary includes only successful queues and excludes camera relays", async () => {
    const { context: c, events, localMarkers } = rig(["sendMarker"]); const called = [];
    for (const name of ["ok", "rejected", "throws", "camera", "marker-blocked"])
      c.state.headsets.set(name, endpoint(name, { supportsCommands: name !== "camera", supportsMarkers: name !== "marker-blocked" }));
    c.postMarkerToHeadset = async h => { called.push(h.endpoint); if (h.endpoint === "throws") throw new Error("closed"); return h.endpoint === "ok"; };
    const result = await c.sendMarker("target", 0, 0, 0, "ZERO");
    assert.equal(result.attempted, 3); assert.equal(result.queued, 1);
    assert.equal(localMarkers.length, 1); assert.equal(called.includes("camera"), false);
    assert.equal(called.includes("marker-blocked"), false);
    assert.match(events.at(-1).message, /1\/3 headset/);
  });

  await check("clipboard failure does not claim a copied command", async () => {
    const { context: c, events } = rig(["sendMarker"]);
    c.navigator.clipboard = { writeText: async () => { throw new Error("permission"); } };
    const result = await c.sendMarker("target", 0, 0, 0, "ZERO");
    assert.equal(result.queued, 0); assert.match(events.at(-1).message, /clipboard unavailable/);
    assert.equal(events.some(event => event.kind === "COPY"), false);
  });

  await check("offline route remains local and is never reported sent", async () => {
    const { context: c, events, localMarkers } = rig(["sendMarker", "finishRoute"]);
    c.state.routeDraftPoints = [{ lat: 0, lng: 0 }, { lat: 0, lng: 1 }];
    await c.finishRoute();
    assert.equal(localMarkers.length, 2); assert.match(events.at(-1).message, /kept locally.*no headset connected/);
    assert.equal(c.state.routeDraftPoints.length, 0);
  });

  await check("route completion waits for outcomes and preserves a newly started draft", async () => {
    const { context: c, events } = rig(["sendMarker", "finishRoute"]); const pending = [];
    c.state.headsets.set("one", endpoint("one"));
    c.postMarkerToHeadset = () => new Promise(resolve => pending.push(resolve));
    c.state.routeDraftPoints = [{ lat: 0, lng: 0 }, { lat: 0, lng: 1 }];
    const completion = c.finishRoute();
    assert.equal(pending.length, 2); assert.equal(c.state.routeDraftPoints.length, 0);
    await flush(); assert.equal(events.length, 0, "No success reported while requests are pending");
    c.state.routeDraftPoints = [{ lat: 1, lng: 2 }];
    pending[0](true); pending[1](false); await completion;
    assert.match(events.at(-1).message, /1\/2 headset requests queued/);
    assert.equal(c.state.routeDraftPoints.length, 1);
  });

  await check("invalid route is retained for correction without partial sends", async () => {
    const { context: c, localMarkers } = rig(["sendMarker", "finishRoute"]);
    c.state.routeDraftPoints = [{ lat: 0, lng: 0 }, { lat: 91, lng: 0 }];
    await c.finishRoute(); assert.equal(localMarkers.length, 0); assert.equal(c.state.routeDraftPoints.length, 2);
  });

  await check("one control socket failure does not skip other sockets or HTTP headsets", async () => {
    const { context: c, events } = rig(["sendHeadsetControl"]); const called = [];
    c.state.headsets.set("broken", endpoint("broken", { socket: { readyState: 1, send() { throw new Error("closed"); } } }));
    c.state.headsets.set("socket", endpoint("socket", { socket: { readyState: 1, send() { called.push("socket"); } } }));
    c.state.headsets.set("http", endpoint("http"));
    c.state.headsets.set("camera", endpoint("camera", { supportsCommands: false }));
    c.fetch = async url => { called.push(new URL(url).hostname); return { ok: true, json: async () => ({ ok: true }) }; };
    await c.sendHeadsetControl("mesh_connect");
    assert.deepEqual(called, ["socket", "http"]);
    assert.match(events.at(-1).message, /requested on 2\/3 headset/);
    assert.equal(events.some(event => /executed|delivered/.test(event.message)), false);
  });

  console.log(`Marker and command workflow validation: ${passed} checks PASS`);
})().catch(error => { console.error(error); process.exitCode = 1; });
