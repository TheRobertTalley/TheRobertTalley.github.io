# TalleySoft Vision Web Telemetry Protocol

The public Vision page is a static browser client. Realtime data normally
comes from one or more headset apps on the same local network, because the
XIAO/Meshtastic radio is connected to the headset in the field. Add each
headset endpoint in the page's Headsets panel:

```text
ws://HEADSET-IP:8787
http://HEADSET-IP:8787/
```

The public page defaults to Historic Gainesville Square, 301 Main St SW,
Gainesville, GA (`34.2981382, -83.8257640`). It stays usable as a local
marker-planning map even before any headset is connected.

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

When one or more headset telemetry sockets are connected, the browser sends the
marker command to every live headset. Each headset forwards `command` through
`MeshtasticRuntime.SendText` to its radio text channel with the same open marker
format parsed by the headset HUD. Without a connected headset, the browser
still previews the marker locally and copies the command when clipboard access
is available.

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
