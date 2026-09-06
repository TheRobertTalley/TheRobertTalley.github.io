# Live Operations recovery candidate

The deployed page initially byte-matched Pages main `4a2da16` and still loaded
`talleysoft-site.js?v=20260821-asset-label-lanes-v2`.
`assets/telemetry-connection.js` returned 404. The earlier tested connection
recovery at `a3001e9` had been published only on a work branch, so the live site
did not contain it.

This candidate starts from main `4a2da16` and carries that recovery as `c579cd5`,
preserving newer calendar updates. It also fixes explicit HTTPS/default-port
handling, no-GPS headset identity, blank/range coordinate guards, repeated event
messages, and misleading route/control send status. Camera relays, read-only
connections and marker capabilities are respected. Temporary test positions
have an explicit badge and popup, expire locally, restore the prior map view,
and never become a GPS fix or automatically populate radio marker coordinates.

The Messages panel uses the real authenticated `/message` contract. Operators
select a headset and channel explicitly. Readiness, privacy verification,
submission and unknown delivery are distinct. Unknown requests have no automatic
retry; manual retry preserves request/session identity and is bounded. Browser
code contains no operational key or token. A radio/backend that does not
advertise messaging remains visibly unavailable.

Leaflet 1.9.4 is vendored unchanged from the exact previously used package,
including its BSD license and image assets. The UI no longer needs unpkg to
initialize. Its existing fallback no longer queries a hard-coded headset or
invents a geographic starting position; an unavailable map asks for reload and
does not present unwired controls as usable.

Focused host checks:

```text
node TalleySoft-Vision/tools/validation/TelemetryConnectionValidation.js
node TalleySoft-Vision/tools/validation/MarkerWorkflowValidation.js
node TalleySoft-Vision/tools/validation/OperationsStateValidation.js
node TalleySoft-Vision/tools/validation/MeshMessagingValidation.js
```

These exercise production functions and isolated transport fixtures. No RF test
message is transmitted. Browser QA passed at desktop and 390x844 against the
actual S1 HTTPS endpoint online and then unavailable: asset presence, last-known
GPS and disabled offline controls remain distinct. The labeled loopback fixture
showed TEST LOCATION and an explicit channel choice; its message endpoint
returned a matched rejection with no radio submission. Text and controls were
readable without overflow. The Messages navigation link uses the measured sticky
header height so its destination stays visible at either size. Real RF messaging
and an actual headset-issued temporary test location require separate acceptance.

GitHub Pages currently uses legacy branch publication from main `/`. Its latest
observed successful build was `4a2da16` at 2026-09-06 10:44:04 UTC. Deployment
requires integrating this website-only candidate into the latest Pages main,
preserving intervening calendar commits, then waiting for a successful Pages
build and verifying the versioned live assets and browser workflow. Publishing
the Quest repository alone cannot update this page. No Quest main merge or APK
release-asset replacement is part of website deployment.
