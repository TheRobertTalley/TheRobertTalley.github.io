"use strict";
const assert = require("node:assert/strict");
const api = require("../../assets/telemetry-connection.js");

const now = 2000000000000;
assert.equal(api.normalizeEndpoint("headset.local"), "ws://headset.local:8787");
assert.equal(api.normalizeEndpoint("http://192.0.2.1:8787"), "ws://192.0.2.1:8787");
assert.equal(api.normalizeEndpoint("https://private.example.ts.net:9443/"), "wss://private.example.ts.net:9443");
assert.equal(api.normalizeEndpoint("https://relay.example/"), "wss://relay.example");
assert.equal(api.normalizeEndpoint("http://relay.example:80/"), "ws://relay.example");
assert.equal(api.endpointKey("wss://relay.example"), api.endpointKey("wss://relay.example:443"));
assert.notEqual(api.endpointKey("wss://relay.example"), api.endpointKey("wss://relay.example:8787"));
for (const invalid of ["file:///tmp", "javascript:alert(1)", "https://user:secret@relay.example"])
  assert.equal(api.normalizeEndpoint(invalid), "");
const noGps = api.normalizeSnapshot({ type: "snapshot", source: "headset", localHandle: "S1", nodes: [],
  radioStatus: "USB waiting", positionStatus: "GPS waiting", readOnly: true, capabilities: { messages: true } });
assert.equal(noGps.assetLabel, "S1 · Quest headset");
assert.equal(noGps.nodes.length, 0, "Headset identity must not synthesize position");
assert.equal(api.isReadOnly(noGps), true);
assert.equal(noGps.capabilities.messages, true, "Message capability remains independent of read-only controls");
assert.match(api.summary(noGps), /^Read-only/);
assert.equal(api.isReadOnly({ capabilities: { commands: false } }), true);
assert.equal(api.isReadOnly({}), false, "Legacy direct headset control compatibility");
assert.equal(api.positionCurrent({ source: "test-location", positionTimeUnix: now / 1000 }, now), false);
assert.equal(api.positionCurrent({ source: "demo", positionTimeUnix: now / 1000 }, now), false);
assert.match(api.summary({ testLocationActive: true, positionStatus: "GPS current" }), /TEST LOCATION/);
for (const host of ["192.168.1.2", "100.64.0.1", "100.127.255.254", "phone.example.ts.net", "fd7a:115c:a1e0::1"])
  assert.equal(api.addressSpace(host), "local", host);
for (const host of ["100.63.1.1", "100.128.0.1", "8.8.8.8", "192.168.999.2"])
  assert.equal(api.addressSpace(host), "", host);
assert.equal(api.addressSpace("[::1]"), "loopback");
assert.equal(api.positionCurrent({ positionTimeUnix: now / 1000 - 89 }, now), true);
assert.equal(api.positionCurrent({ positionTimeUnix: now / 1000 - 91 }, now), false);
assert.equal(api.positionCurrent({}, now), false, "unknown position age must not become live");
const oldPhone = { relayPort: 8088, cameraFrameVersion: 23, cameraFrameAgeMs: 25,
  hud: { gpsAvailable: true, latitude: 1.25, longitude: 2.5, gpsAgeMs: 92000, accuracyMeters: 5 } };
const snapshot = api.normalizeSnapshot(oldPhone, now);
assert.equal(snapshot.assetLabel, "Mayhamburger");
assert.equal(snapshot.cameraStatus, "Camera live");
assert.equal(snapshot.nodes.length, 1);
assert.equal(snapshot.nodes[0].positionCurrent, false);
assert.equal(snapshot.center, undefined);
assert.equal(api.normalizeSnapshot({ ...oldPhone, hud: { gpsAvailable: false } }, now).nodes.length, 0);
assert.throws(() => api.normalizeSnapshot({}), /Unsupported/);

function rig(fetcher) {
  const jobs = new Map(); let next = 1;
  const timers = {
    setTimeout(fn, ms) { const id = next++; jobs.set(id, { fn, ms, repeat: false }); return id; },
    setInterval(fn, ms) { const id = next++; jobs.set(id, { fn, ms, repeat: true }); return id; },
    clearTimeout(id) { jobs.delete(id); }, clearInterval(id) { jobs.delete(id); }
  };
  const sockets = [], states = [], payloads = [];
  class Socket {
    constructor() { this.handlers = {}; sockets.push(this); }
    addEventListener(name, fn) { this.handlers[name] = fn; }
    send() {}
    close() { this.handlers.close?.(); }
    emit(name, data) { this.handlers[name]?.(data); }
  }
  const manager = api.createManager({ fetch: fetcher, WebSocket: Socket, timers, now: () => now,
    onState: (...args) => states.push(args), onSnapshot: (...args) => payloads.push(args) });
  return { manager, sockets, states, payloads, jobs,
    tick(ms) { for (const [id, job] of [...jobs]) if (job.ms === ms) { if (!job.repeat) jobs.delete(id); job.fn(); } } };
}
const flush = async () => { for (let i = 0; i < 15; i++) await Promise.resolve(); };
const valid = { type: "snapshot", radioStatus: "Mesh ready", nodes: [] };
(async () => {
  // Deliberate disconnect invalidates both in-flight HTTP and late socket data.
  let release;
  const first = rig(() => new Promise(resolve => { release = resolve; }));
  first.manager.connect("ws://192.168.1.2:8787");
  first.manager.disconnect("ws://192.168.1.2:8787");
  first.sockets[0].emit("message", { data: JSON.stringify(valid) });
  release({ ok: true, json: async () => valid }); await flush();
  assert.equal(first.payloads.length, 0);
  assert.equal(first.jobs.size, 0);
  assert.equal(first.states.at(-1)[1], "Disconnected");

  // A reconnect must ignore its predecessor's close and message events.
  const second = rig(async () => ({ ok: true, json: async () => valid }));
  second.manager.connect("ws://192.168.1.2:8787"); await flush();
  second.manager.connect("ws://192.168.1.2:8787"); await flush();
  const count = second.payloads.length;
  second.sockets[0].emit("message", { data: JSON.stringify(valid) });
  second.sockets[0].emit("close"); await flush();
  assert.equal(second.payloads.length, count);

  // Mayhamburger root HTML is not a success. Legacy /status is normalized instead.
  const paths = [];
  const third = rig(async url => {
    paths.push(new URL(url).pathname);
    return { ok: true, json: async () => { if (paths.at(-1) === "/snapshot") throw new SyntaxError("HTML"); return oldPhone; } };
  });
  third.manager.connect("ws://100.77.10.2:8088"); await flush();
  assert.deepEqual(paths, ["/snapshot", "/status"]);
  assert.equal(third.sockets.length, 0);
  assert.equal(third.payloads[0][0].assetLabel, "Mayhamburger");
  assert.equal(third.states.at(-1)[2], true);

  // A stalled HTTP request is aborted and a subsequent polling interval can recover.
  let stalled = true;
  const fourth = rig(async (_url, options) => {
    if (!stalled) return { ok: true, json: async () => valid };
    return new Promise((_resolve, reject) => options.signal.addEventListener("abort", () => reject(new Error("timeout"))));
  });
  fourth.manager.connect("ws://192.168.1.2:8088");
  fourth.tick(4000); await flush(); fourth.tick(4000); await flush();
  assert.equal(fourth.states.at(-1)[2], false);
  stalled = false; fourth.tick(2000); await flush();
  assert.equal(fourth.states.at(-1)[2], true);
  console.log("Telemetry connection and Mayhamburger compatibility: PASS");
})().catch(error => { console.error(error); process.exitCode = 1; });
