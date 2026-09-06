"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const api = require("../../assets/mesh-messaging.js");

const endpoint = "wss://headset.example.ts.net";
function snapshot(overrides = {}) {
  return { type: "snapshot", nodes: [], readOnly: true,
    capabilities: { controls: false, messages: true },
    messaging: { ready: true, status: "Radio ready", sessionId: "session-1",
      channels: [{ index: 0, name: "Public", role: "PRIMARY", isPrivateVerified: false },
        { index: 2, name: "Team", role: "SECONDARY", isPrivateVerified: true }] }, ...overrides };
}
function rig(custom = {}) {
  const calls = [], changes = []; let ids = 0, now = 1000000;
  const controller = api.createController({
    requestId: () => `request-${++ids}`, now: () => now,
    fetch: async (url, options) => {
      const body = JSON.parse(options.body); calls.push({ url, options, body });
      return { ok: true, json: async () => ({ ok: true, requestId: body.requestId,
        state: "submitted", submitted: true, deliveryConfirmed: false }) };
    }, onChange: state => changes.push(state), ...custom });
  controller.updateEndpoint(endpoint, snapshot(), { connected: true });
  return { controller, calls, changes, advance: ms => { now += ms; } };
}
function choose(controller, channel = "2") {
  controller.selectEndpoint(endpoint); controller.selectChannel(channel); controller.setText("Team check in");
}
let passed = 0;
async function check(name, test) { await test(); passed++; console.log(`PASS ${name}`); }

(async () => {
  await check("ordinary text boundaries preserve content and reject commands", () => {
    assert.equal(api.validateText("  Team check in  "), "");
    assert.notEqual(api.validateText(" \t\n "), "");
    assert.equal(api.validateText("x".repeat(180)), "");
    assert.notEqual(api.validateText("x".repeat(181)), "");
    assert.equal(api.validateText("界".repeat(73)), "");
    assert.notEqual(api.validateText("界".repeat(74)), "");
    for (const command of ["!target 1 2 HERE", "!stop", " !hello", "!unknown"])
      assert.match(api.validateText(command), /ATAK/);
  });

  await check("only explicit enabled channel indices are offered", () => {
    const data = snapshot();
    data.messaging.channels.push({ index: 1, role: "DISABLED" }, { index: "3", role: "SECONDARY" },
      { index: 2, name: "Duplicate", role: "SECONDARY" }, { index: 8, role: "SECONDARY" });
    assert.deepEqual(api.channelsFrom(data).map(channel => channel.index), [0, 2]);
    assert.equal(api.channelsFrom(data)[1].isPrivateVerified, true);
  });

  await check("no default channel and no GPS requirement; read-only controls are independent", async () => {
    const { controller: c, calls } = rig();
    c.selectEndpoint(endpoint); c.setText("Team check in");
    assert.equal(c.view().canSend, false); assert.match(c.view().status, /Choose a radio channel/);
    await c.send(); assert.equal(calls.length, 0);
    c.selectChannel("0"); assert.equal(c.view().canSend, true);
    await c.send(); assert.equal(calls[0].body.channelIndex, 0);
  });

  await check("disconnected, camera-only and radio-not-ready never invoke fetch", async () => {
    const { controller: c, calls } = rig(); choose(c);
    c.setConnection(endpoint, false); await c.send();
    assert.match(c.view().status, /disconnected/);
    c.updateEndpoint(endpoint, snapshot({ capabilities: { messages: false } }), { connected: true });
    await c.send(); assert.match(c.view().status, /unavailable/);
    const data = snapshot(); data.messaging.ready = false; data.messaging.status = "Waiting for radio configuration";
    c.updateEndpoint(endpoint, data, { connected: true }); await c.send();
    assert.match(c.view().status, /Waiting for radio/); assert.equal(calls.length, 0);
  });

  await check("explicit single-headset POST contains no browser credential or GPS data", async () => {
    const { controller: c, calls } = rig(); choose(c);
    c.setText("  Team check in  ");
    c.updateEndpoint("wss://other.example.ts.net", snapshot(), { connected: true });
    const result = await c.send(); assert.equal(result.state, "submitted"); assert.equal(calls.length, 1);
    assert.equal(calls[0].url, "https://headset.example.ts.net/message");
    assert.equal(calls[0].options.method, "POST");
    assert.deepEqual(Object.keys(calls[0].body).sort(), ["channelIndex", "requestId", "sessionId", "text"]);
    assert.equal(calls[0].body.text, "Team check in"); assert.equal(calls[0].body.channelIndex, 2);
    assert.deepEqual(calls[0].options.headers, { "content-type": "application/json" });
    assert.equal(c.view().text, ""); assert.match(c.view().status, /Delivery is unconfirmed/);
  });

  await check("double submission while pending opens only one request", async () => {
    let release, calls = 0;
    const { controller: c } = rig({ fetch: (_url, options) => { calls++; const body = JSON.parse(options.body);
      return new Promise(resolve => { release = () => resolve({ ok: true, json: async () => ({ ok: true,
        requestId: body.requestId, submitted: true, state: "submitted" }) }); }); } });
    choose(c); const pending = c.send(); assert.equal(c.view().busy, true);
    assert.equal((await c.send()).state, "pending"); assert.equal(calls, 1);
    release(); await pending;
  });

  await check("unknown transport result retries only manually with unchanged ID and payload", async () => {
    const requests = []; let fail = true;
    const { controller: c } = rig({ fetch: async (_url, options) => { const body = JSON.parse(options.body); requests.push(body);
      if (fail) throw new Error("network");
      return { ok: true, json: async () => ({ ok: true, requestId: body.requestId, submitted: true, state: "submitted" }) }; } });
    choose(c); assert.equal((await c.send()).state, "unknown");
    c.setText("Changed text"); c.selectChannel("0"); c.selectEndpoint("wss://other.example.ts.net");
    c.updateEndpoint(endpoint, snapshot(), { connected: true });
    assert.equal(requests.length, 1); assert.equal(c.view().text, "Team check in");
    fail = false; await c.send(); assert.equal(requests.length, 2); assert.deepEqual(requests[0], requests[1]);
  });

  await check("backend unknown is not treated as a rejection or delivered message", async () => {
    const { controller: c } = rig({ fetch: async (_url, options) => ({ ok: false, json: async () => ({
      ok: false, requestId: JSON.parse(options.body).requestId, state: "unknown", submitted: null }) }) });
    choose(c); await c.send(); assert.equal(c.view().unknown, true);
    assert.equal(c.view().buttonLabel, "Retry same request"); assert.match(c.view().status, /unconfirmed/);
  });

  await check("unknown request cannot retry after session restart or retention expiry", async () => {
    let calls = 0;
    const r = rig({ fetch: async () => { calls++; throw new Error("network"); } });
    choose(r.controller); await r.controller.send();
    const restarted = snapshot(); restarted.messaging.sessionId = "session-2";
    r.controller.updateEndpoint(endpoint, restarted, { connected: true });
    assert.equal(r.controller.view().canSend, false); await r.controller.send(); assert.equal(calls, 1);
    r.controller.updateEndpoint(endpoint, snapshot(), { connected: true }); r.advance(600000);
    assert.equal(r.controller.view().canSend, false); await r.controller.send(); assert.equal(calls, 1);
    assert.match(r.controller.view().status, /expired/);
  });

  await check("channel changes invalidate selection and block unknown retries", async () => {
    const { controller: c, calls } = rig(); choose(c);
    const changed = snapshot(); changed.messaging.channels[1].name = "Different team";
    c.updateEndpoint(endpoint, changed, { connected: true });
    assert.equal(c.view().channelIndex, ""); assert.equal(c.view().canSend, false);
    await c.send(); assert.equal(calls.length, 0);
    const r = rig({ fetch: async () => { throw new Error("network"); } }); choose(r.controller); await r.controller.send();
    r.controller.updateEndpoint(endpoint, changed, { connected: true });
    assert.equal(r.controller.view().canSend, false); assert.match(r.controller.view().status, /channel changed/i);
  });

  await check("known rejection retains editable text; new message after unknown never resends old text", async () => {
    const { controller: c } = rig({ fetch: async (_url, options) => ({ ok: false, json: async () => ({
      ok: false, requestId: JSON.parse(options.body).requestId, state: "rejected", submitted: false, status: "Not authorized" }) }) });
    choose(c); await c.send(); assert.equal(c.view().locked, false); assert.equal(c.view().text, "Team check in");
    assert.equal(c.view().status, "Not authorized");
    const r = rig({ fetch: async () => { throw new Error("network"); } }); choose(r.controller); await r.controller.send();
    r.controller.newMessage(); assert.equal(r.controller.view().text, ""); assert.equal(r.controller.view().channelIndex, "");
    assert.equal(r.controller.view().canSend, false); assert.match(r.controller.view().status, /Previous delivery remains unconfirmed/);
  });

  await check("channel changed during a pending submission must be selected again afterwards", async () => {
    let release;
    const { controller: c } = rig({ fetch: (_url, options) => {
      const body = JSON.parse(options.body);
      return new Promise(resolve => { release = () => resolve({ ok: true, json: async () => ({
        ok: true, requestId: body.requestId, submitted: true, state: "submitted" }) }); });
    } });
    choose(c); const pending = c.send();
    const changed = snapshot(); changed.messaging.channels[1].name = "Different team";
    c.updateEndpoint(endpoint, changed, { connected: true });
    release(); await pending;
    c.setText("Next message");
    assert.equal(c.view().channelIndex, ""); assert.equal(c.view().canSend, false);
  });

  await check("unmatched response cannot confirm submission", async () => {
    const { controller: c } = rig({ fetch: async () => ({ ok: true, json: async () => ({
      ok: true, requestId: "someone-elses-request", state: "submitted", submitted: true }) }) });
    choose(c); assert.equal((await c.send()).state, "unknown");
  });

  await check("panel binding preserves text, renders labels as text and prevents native form submission", async () => {
    class Element {
      constructor() { this.dataset = {}; this.children = []; this.value = ""; this.handlers = {}; this.attributes = {}; }
      append(child) { this.children.push(child); } replaceChildren() { this.children = []; }
      addEventListener(name, fn) { this.handlers[name] = fn; } setAttribute(name, value) { this.attributes[name] = value; }
    }
    const selectors = ["form", "asset", "channel", "text", "send", "status", "privacy", "count", "new"];
    const elements = Object.fromEntries(selectors.map(name => [name, new Element()]));
    const root = { ownerDocument: { createElement: () => new Element() },
      querySelector: selector => elements[selector === "form" ? "form" : selector.match(/data-message-(.+)\]/)[1]] };
    const c = api.createPanel({ root, requestId: () => "dom-request", fetch: async () => { throw new Error("No actual network"); } });
    const data = snapshot(); data.assetLabel = "<img src=x onerror=alert(1)>";
    c.updateEndpoint(endpoint, data, { connected: true });
    elements.asset.value = endpoint; elements.asset.handlers.change();
    elements.channel.value = "2"; elements.channel.handlers.change();
    elements.text.value = "Unsent draft"; elements.text.handlers.input();
    c.updateEndpoint(endpoint, snapshot(), { connected: true });
    assert.equal(elements.text.value, "Unsent draft"); assert.equal(elements.send.disabled, false);
    assert.equal(elements.asset.children.some(option => option.innerHTML), false);
    let prevented = false; elements.form.handlers.submit({ preventDefault() { prevented = true; } });
    assert.equal(prevented, true); await new Promise(resolve => setImmediate(resolve));
    assert.equal(elements.new.hidden, false); assert.match(elements.status.textContent, /unconfirmed/);
  });

  await check("HTML supplies accessible labels and module loads before page callbacks", () => {
    const html = fs.readFileSync(path.join(__dirname, "../../index.html"), "utf8");
    for (const id of ["message-asset", "message-channel", "message-text"])
      assert.ok(html.includes(`for="${id}"`), id);
    assert.ok(html.includes('role="status" aria-live="polite"'));
    assert.ok(html.indexOf('src="assets/mesh-messaging.js') < html.indexOf('src="assets/talleysoft-site.js'));
  });
  console.log(`Mesh messaging validation: ${passed} checks PASS; no network or radio used`);
})().catch(error => { console.error(error); process.exitCode = 1; });
