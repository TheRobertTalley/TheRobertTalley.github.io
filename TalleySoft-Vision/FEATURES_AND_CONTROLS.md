# TalleySoft Vision Features And Controls

This page is the project-wide control map for TalleySoft Vision. It covers the
Quest headset app, Sphere Link bridge, Meshtastic awareness layer, thermal
pipeline, weapon-camera controls, ATAK-style marker workflows, and the IoT web
operations page.

## System Roles

- Quest headset: mixed-reality cockpit, passthrough, HUD, map, video, thermal,
  Meshtastic gateway, and local operator controls.
- Sphere Link receiver: low-latency FPV stream receiver and USB bridge.
- Meshtastic radio: low-rate team position, text, tactical marker, and event
  transport.
- TalleySoft Vision IoT page: browser-based team map, marker board, target
  board, route preview, tactical alerts, and control reference.

## Headset Controls

- Right-hand dominant mode is the default.
- Left-hand dominant mode mirrors left/right controls and docked HUD locations.
- Palm toward headset plus index pinch shows or enlarges the item assigned to
  the active quadrant.
- Palm away from headset plus index pinch shrinks or hides the active quadrant
  item.
- Upper-left controls Meshtastic/map awareness in right-hand mode.
- Upper-right controls FPV video in right-hand mode.
- Lower-left controls thermal: hidden, HUD, center fusion.
- Lower-right is reserved for weapon camera controls: hidden, lower-right HUD,
  center view, full view.
- Palm-up pinky pinch on lower-right cycles available weapon camera streams or
  modes when the camera stack exposes them.

## Display And Menu Settings

- Default color theme drives normal HUD text and map styling where supported.
- HUD color theme can override cockpit HUD elements.
- Compass color theme can override the compass tape.
- Menu opacity controls the menu panel alpha.
- Hand mode switches right-hand and left-hand dominant layouts.
- Clock settings include digital, analog, stopwatch, countdown, 24-hour time,
  and seconds display.
- Each reasonable setting should have a reset path in its relevant menu page.

## Thermal

- Thermal camera input is USB UVC.
- Lower-left gesture control owns thermal visibility.
- Center fusion uses saved calibration profiles.
- Manual thermal calibration supports position, rotation, scale, FOV, crop,
  projective warp, distortion, opacity, palette, timing, and working distance.
- Thermal modes are Balanced, Target, Detail, and Manual.
- Target mode stays aggressive for hot-object pop.
- Detail mode preserves more local background contrast.
- Palette numbering remains stable; Edge is palette 3.

## Map And Meshtastic

- The headset maintains node positions, message traffic, marker overlays, route
  trails, and compass bearings.
- Supported marker commands include `!target`, `!location`, `!route`, `!lz`,
  and `!medical` with decimal coordinates.
- ATAK Cursor-on-Target PLI and point events are accepted on the configured TAK
  multicast path.
- Team breadcrumb trails should only be trusted when source GPS accuracy is at
  or better than 20 yards.
- The IoT page is a browser dashboard for viewing headset tracks, team nodes,
  markers, targets, alerts, and tactical status.
- The IoT page accepts realtime JSON over a local WebSocket bridge. The
  intended path is GPS or Meshtastic position data into the headset/runtime
  bridge, then browser map updates over `ws://127.0.0.1:8787` or another
  operator-selected bridge URL.

## ATAK-Style Event Contract

The Vision website focuses on map operations and marker setup. The expected
event vocabulary for headset, mesh, and browser integration is:

- `!threat <lat> <lon> <heading> <source>`: yellow 3-degree direction marker,
  fading after 5 seconds.
- `!gunshot <lat> <lon> <heading> <source>`: red direction marker, fading after
  5 seconds.
- `!heading <lat> <lon> <heading> <source>`: green mark-direction line.
- `!follow <lat> <lon> <source>`: starts or continues follow-me breadcrumbs
  when GPS accuracy is within 20 yards.
- `!stop <lat> <lon> <source>`: bright-red stop alert and warning triangle.
- `!target <lat> <lon> <label>`: persistent target marker.
- `!location <lat> <lon> <label>`: persistent general map marker.
- `!route <lat> <lon> <label>`: route point; repeated labels create a connected
  route.
- `!lz <lat> <lon> <label>`: landing-zone marker.
- `!medical <lat> <lon> <label>`: medical or aid marker.

## IoT Web Page

The root GitHub Pages entry point is `index.html`. The browser page is designed
as a TalleySoft Vision operations hub:

- team/headset map;
- marker and target board;
- alert feed;
- feature and controls reference;
- import/export placeholders for future live telemetry snapshots.
- realtime WebSocket telemetry snapshots and marker commands.

