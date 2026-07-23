# TalleySoft Vision Web Telemetry Protocol

The public Vision page is a static browser client. Realtime data normally
comes from the headset app, because the XIAO/Meshtastic radio is connected to
the headset in the field. The default browser endpoint is:

```text
ws://HEADSET-IP:8787
http://HEADSET-IP:8787/
```

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
  -> XIAO / Meshtastic radio on the headset
  -> MeshtasticRuntime in Talleysoft Vision
  -> headset HTTP/WebSocket telemetry on :8787
  -> public TSV operations page
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

When the headset telemetry bridge is connected, it forwards `command` through
`MeshtasticRuntime.SendText` to the radio text channel with the same open marker
format parsed by the headset HUD. Without a connected bridge, the browser still
previews the marker locally.

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
