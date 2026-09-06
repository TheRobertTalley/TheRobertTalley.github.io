# IoT connection recovery candidate

Based on public Pages main `706f4d5`, retaining the asset selection, label
stacking, route and marker controls from `6c94d18`. The work branch is
`codex/auto-iot-workflow-recovery-20260905`. No Pages deployment has been made.

The connection manager now cancels retired sockets and HTTP requests, keeps a
deliberate disconnect disconnected, connects immediately after Add, bounds each
HTTP request to four seconds and recovers through snapshots when WebSocket
traffic stalls. It accepts actual snapshot JSON and older Mayhamburger status
JSON. Camera relays show as connected assets without inventing a GPS fix.
Current, last-known and unknown-age GPS are visibly distinct; radio status is
shown independently. Headset commands skip camera-only relays, and HTTP command
success requires `ok:true`. The formerly assumed geographic start point and
prefilled marker coordinates are replaced by a neutral map and empty inputs.

The browser attempts explicitly saved LAN or Tailscale endpoints. Browser
Local Network Access and mixed-content policies remain in force. Older
Mayhamburger builds without CORS need the companion phone patch to be readable
from the published HTTPS page; opening the phone's own viewer remains separate.
The companion patch permits only the verified public Operations origin and
loopback QA origins to read telemetry. It does not enable cross-origin controls.

Run `node TalleySoft-Vision/tools/validation/TelemetryConnectionValidation.js`.
The fixture suite passes stale-session, disconnect, timeout/retry, HTML rejection,
legacy `/status`, current/stale/unknown GPS and Tailscale cases. Actual in-app
browser QA passed at desktop and 390x844: Add connects, a no-GPS camera relay is
listed, status and buttons remain readable, Disconnect All stays offline, and
Mesh Connect is not sent to a camera relay. The browser's blocked cross-origin
fixture was shown unavailable independently of a working same-origin fixture.
No actual mesh transmission or phone acceptance is claimed.

Publication should be a reviewed merge of this narrow branch into the Pages
repository's current main, preserving any newer calendar updates. Publishing
the TSV application branch alone will not update this website. Verify the
versioned `telemetry-connection.js` and `talleysoft-site.js` URLs after deployment.
