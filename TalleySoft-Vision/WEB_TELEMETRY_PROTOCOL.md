# TalleySoft Vision Web Telemetry Protocol

The public Vision page is a static browser client. Realtime data normally
comes from one or more headset apps on the same local network, because the
XIAO/Meshtastic radio is connected to the headset in the field. Add each
headset endpoint in the page's Headsets panel:

```text
ws://HEADSET-IP:8787
http://HEADSET-IP:8787/
```

The public page starts with a neutral world map and empty marker coordinates.
It remains usable for local marker planning before a headset connects. A
connected headset is listed in Assets using `localHandle` even when `nodes` is
empty and GPS is waiting. A geographic map icon requires an actual position;
no GPS fix is fabricated to make the asset visible.

Endpoints are stored only in that browser. Bare hostnames default to port 8787;
explicit HTTP(S)/WS(S) addresses retain their standard or supplied port. A
private HTTPS relay may therefore use 443 or 9443. Public Pages is a static
client and cannot discover arbitrary headsets or accept headset push messages.

For bench testing from this computer, forward the headset port over wireless
ADB:

```powershell
adb -s 192.168.1.61:5555 forward tcp:8787 tcp:8787
```

Then open `http://127.0.0.1:8787/` for the headset-served same-origin live map
or `http://127.0.0.1:8787/snapshot` to confirm headset data. The older
`TalleySoftVisionMeshtasticBridge.py` remains useful only when the radio is
plugged into the PC instead of the headset.

## Data Path

```text
GPS / Meshtastic node data
  -> XIAO / Meshtastic radio on each headset
  -> MeshtasticRuntime in Talleysoft Vision
  -> each headset HTTP/WebSocket telemetry on :8787
  -> public TSV operations page Headsets panel
```

## Snapshot

```json
{
  "type": "snapshot",
  "center": { "lat": 34.298138, "lon": -83.825764, "zoom": 17 },
  "nodes": [
    {
      "id": "!1234abcd",
      "label": "ALPHA",
      "lat": 34.298138,
      "lon": -83.825764,
      "heading": 42,
      "accuracyYards": 12,
      "source": "meshtastic"
    }
  ],
  "markers": [
    {
      "id": "target:ridge",
      "kind": "target",
      "label": "RIDGE",
      "lat": 34.298900,
      "lon": -83.824900
    }
  ],
  "messages": [
    {
      "kind": "TARGET",
      "text": "RIDGE marker received"
    }
  ]
}
```

## Incremental Node

```json
{
  "type": "node",
  "id": "!1234abcd",
  "label": "ALPHA",
  "lat": 34.298138,
  "lon": -83.825764,
  "heading": 42,
  "accuracyYards": 12,
  "source": "meshtastic"
}
```

## Incremental Marker

```json
{
  "type": "marker",
  "id": "route:alpha:001",
  "kind": "route",
  "label": "ROUTE ALPHA",
  "lat": 34.298138,
  "lon": -83.825764
}
```

Supported marker kinds:

- `target`
- `location`
- `route`
- `lz`
- `medical`
- `threat`
- `gunshot`
- `direction`
- `hold` for stop/halt alerts

Directional event markers may include `heading`, `coneDegrees`, and
`ttlSeconds`. The web map draws threat cones, gunshot lines, and mark-direction
lines from those fields and expires short-lived events locally.

## Browser-To-Bridge Marker Command

When connected, the page sends marker commands back to the bridge:

```json
{
  "type": "marker_command",
  "command": "!target 34.298138 -83.825764 RIDGE",
  "marker": {
    "type": "marker",
    "kind": "target",
    "label": "RIDGE",
    "lat": 34.298138,
    "lon": -83.825764
  }
}
```

When one or more command-capable headsets are connected, the browser requests the
marker command on each of them. Camera relays and read-only connections are
excluded, and `capabilities.markers:false` disables marker writes. Each headset forwards `command` through
`MeshtasticRuntime.SendText` to its radio text channel with the same open marker
format parsed by the headset HUD. Without a connected headset, the browser
still previews the marker locally and copies the command when clipboard access
is available.

The page reports requests queued/accepted by each endpoint, not RF delivery.
An explicitly rejected HTTP marker request is never resent over WebSocket.
Blank and out-of-range coordinates are rejected before any write.

## Ordinary Meshtastic messages

The Messages panel requires `capabilities.messages:true` and a ready `messaging`
snapshot with `sessionId` and explicit channel choices. This capability is
independent of `readOnly` and `capabilities.commands`: an authenticated relay can
allow operator text while withholding headset controls. Ordinary text cannot
start with `!`; tactical commands remain in ATAK Tools and use their existing
privacy policy. Text is limited to 180 UTF-16 characters and 220 UTF-8 bytes.

```json
{
  "capabilities": { "commands": false, "markers": false, "messages": true },
  "readOnly": true,
  "messaging": {
    "ready": true,
    "status": "Ready",
    "sessionId": "example-process-session",
    "channels": [{ "index": 1, "name": "Example channel", "role": "secondary", "isPrivateVerified": true }]
  }
}
```

Only an explicit Send Message action posts `/message` with
`{requestId,sessionId,text,channelIndex}`. A direct headset requires its app-private
bearer token; the private gateway authenticates its Tailscale owner and keeps the
upstream token on the server. No token is exposed to the browser or Pages source.
The selected channel is mandatory and ordinary text uses hop limit 7. The server
returns `submitted`, `rejected`, `cancelled` or `unknown`, with
`deliveryConfirmed:false`; submission is not a delivery receipt.

An unknown response has no automatic retry. Manual retry preserves the original
request ID, payload and headset session for at most ten minutes. A changed
session or channel blocks retry. Repeated snapshot messages are deduplicated in
the event feed by sender, timestamp and content.

## Explicit temporary test locations

Test snapshots declare `testLocationActive`, `testLocationId`,
`testLocationExpiresUnix`, and a separate node with `source:"test-location"`.
The browser displays TEST LOCATION in the map readout and popup, never GPS
CURRENT, and does not copy the synthetic coordinates into the marker form.
Expiry or removal clears the test node and restores the prior map view. Genuine
GPS nodes and messaging readiness remain independent of this diagnostic.

GitHub Pages cannot receive direct push connections from headsets because it is
static hosting. For off-network realtime operation, add a separate HTTPS/WSS
relay service. For field use on one LAN, connect the public page to every
headset endpoint or open `http://HEADSET-IP:8787/` directly.

## Bridge Health

```powershell
Invoke-RestMethod http://HEADSET-IP:8787/health
Invoke-RestMethod http://HEADSET-IP:8787/snapshot

# Or with ADB forwarding:
Invoke-RestMethod http://127.0.0.1:8787/health
Invoke-RestMethod http://127.0.0.1:8787/snapshot
```

The snapshot endpoint is useful for confirming node GPS and marker payloads
before opening the public page.
