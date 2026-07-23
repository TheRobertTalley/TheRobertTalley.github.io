# TalleySoft Vision Web Telemetry Protocol

The public Vision page is a static browser client. Realtime data reaches it
through a local or headset-network WebSocket bridge. The default browser
endpoint is:

```text
ws://127.0.0.1:8787
```

Use the Meshtastic bridge on the operator machine with the XIAO radio attached:

```powershell
python tools\TalleySoftVisionMeshtasticBridge.py --port COM3
```

Then open `http://127.0.0.1:8787/`. The bridge serves the same map UI locally
and the page connects to its same-origin WebSocket automatically. The public
GitHub Pages site can still connect to `ws://127.0.0.1:8787` manually when the
browser allows it, but the local URL is the reliable live-ops path. The older
`tools/TalleySoftVisionWebBridge.ps1` remains useful for replaying test JSON,
but it does not open the radio or transmit marker commands.

## Data Path

```text
GPS / Meshtastic node data
  -> XIAO / Meshtastic serial radio on the operator PC
  -> TalleySoftVisionMeshtasticBridge.py
  -> same-origin WebSocket broadcast
  -> http://127.0.0.1:8787/
```

## Snapshot

```json
{
  "type": "snapshot",
  "center": { "lat": 39.123456, "lon": -77.123456, "zoom": 15 },
  "nodes": [
    {
      "id": "!1234abcd",
      "label": "ALPHA",
      "lat": 39.123456,
      "lon": -77.123456,
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
      "lat": 39.1242,
      "lon": -77.1208
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
  "lat": 39.123456,
  "lon": -77.123456,
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
  "lat": 39.123456,
  "lon": -77.123456
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
  "command": "!target 39.123456 -77.123456 RIDGE",
  "marker": {
    "type": "marker",
    "kind": "target",
    "label": "RIDGE",
    "lat": 39.123456,
    "lon": -77.123456
  }
}
```

When the Python Meshtastic bridge is connected, it forwards `command` to the
radio text channel with the same open marker format parsed by the headset HUD.
Without a connected radio, the browser still previews the marker locally.

## Bridge Health

```powershell
Invoke-RestMethod http://127.0.0.1:8787/health
Invoke-RestMethod http://127.0.0.1:8787/snapshot
```

The snapshot endpoint is useful for confirming node GPS and marker payloads
before opening the public page.
