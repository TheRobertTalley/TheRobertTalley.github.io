"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const api = require("../../assets/telemetry-connection.js");
const query = (...values) => "?" + values.map(value => "asset=" + encodeURIComponent(value)).join("&");
const relay = "https://relay.example:9443";
assert.deepEqual(api.endpointsFromQuery(query(relay)), ["wss://relay.example:9443"]);
assert.deepEqual(api.endpointsFromQuery(query("headset.example", relay)),
  ["ws://headset.example:8787", "wss://relay.example:9443"]);
assert.deepEqual(api.endpointsFromQuery(query("https://relay.example", "wss://relay.example:443/")),
  ["wss://relay.example"]);
assert.deepEqual(api.endpointsFromQuery(query("http://localhost:8787", "ws://127.0.0.1:8787")),
  ["ws://localhost:8787"]);
assert.deepEqual(api.endpointsFromQuery("?other=asset&asset=%E0%A4%A&asset=%ZZ&asset=" + encodeURIComponent(relay)),
  ["wss://relay.example:9443"]);
assert.deepEqual(api.endpointsFromQuery(query("https://operator:secret@relay.example", "ftp://relay.example", "javascript:alert(1)")), []);
assert.deepEqual(api.endpointsFromQuery(query("", "https://user:secret@relay.example", "third.example", "fourth.example", "fifth.example")),
  ["ws://third.example:8787", "ws://fourth.example:8787"], "Only the first four values are inspected, including invalid values");
assert.deepEqual(api.endpointsFromQuery(query("https://relay.example/" + "x".repeat(2048))), []);
assert.deepEqual(api.endpointsFromQuery("?ignored=" + "x".repeat(12288) + "&asset=" + encodeURIComponent(relay)), []);
for (const empty of [undefined, null, "", "?asset", "?unrelated=value"])
  assert.deepEqual(api.endpointsFromQuery(empty), []);

const source = fs.readFileSync(path.join(__dirname, "../../assets/talleysoft-site.js"), "utf8");
const production = name => {
  const match = source.match(new RegExp("^  function " + name + "\\([^]*?^  \\}", "m"));
  assert.ok(match, name); return match[0];
};
const initialize = source.match(/^  state\.endpoints = uniqueEndpoints\(\[[^]*?^  \]\)\.filter\([^\n]+;/m);
assert.ok(initialize, "Production startup endpoint assignment");
function startup(saved, href, defaults = []) {
  const location = new URL(href);
  const context = vm.createContext({ URL, JSON, Set, window: { TsvTelemetry: api, location,
    localStorage: { getItem: () => JSON.stringify(saved) } }, state: {},
    defaultTelemetryEndpoints: defaults, addFeed() {} });
  vm.runInContext(["normalizeEndpoint", "endpointKey", "uniqueEndpoints", "loadEndpoints",
    "discoverDefaultEndpoints", "isCurrentPageEndpoint"].map(production).join("\n") + "\n" + initialize[0], context);
  return Array.from(context.state.endpoints);
}
assert.deepEqual(startup(["https://saved.example:9443", relay], "https://pages.example/" + query(relay, "headset.example")),
  ["wss://saved.example:9443", "wss://relay.example:9443", "ws://headset.example:8787"], "Saved endpoints remain and query duplicates collapse");
assert.deepEqual(startup(["http://127.0.0.1:8787"], "http://localhost:8787/" + query(relay)),
  ["ws://127.0.0.1:8787", "wss://relay.example:9443"], "Discovered default uses existing hostname deduplication");
assert.deepEqual(startup(["https://saved.example:9443"], "http://127.0.0.1:8793/" + query("http://127.0.0.1:8793", relay)),
  ["wss://saved.example:9443", "wss://relay.example:9443"], "Preview page endpoint stays filtered");
assert.deepEqual(startup([], "https://pages.example/" + query("https://user:secret@relay.example", "ftp://relay.example"),
  ["http://default.example:8787"]), ["ws://default.example:8787"], "Malformed linked endpoints do not discard defaults");
assert.deepEqual(startup(["ws://saved.example:8787"], "https://pages.example/"), ["ws://saved.example:8787"],
  "Existing startup behavior is unchanged without asset query");
console.log("Operations deep-link bounds, credential rejection, saved/default dedupe and startup filtering: PASS");
