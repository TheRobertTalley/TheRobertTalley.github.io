# Chicken Chat mesh hardware validation

Tested September 9, 2026. Release: 2026-09-09-mesh-1.

## Passed on physical hardware

Two original ESP32-D0WD-V3 boards with 4 MB flash were used: a Maker board and a Wemos. Both were backed up before flashing. No sensor or motor outputs were enabled for these tests.

- 40 of 40 encrypted out-and-back radio probes returned through the other physical board, with a recorded hop count of two. The second set of 20 passed after restarting the repeater.
- The repeater forwarded both data and return acknowledgments while also reporting its own readings.
- A probe sent while the repeater was held offline was not falsely delivered.
- All 69 queued gateway records survived a gateway reboot with a new boot session.
- The hub collector saved 86 records over an open 2.4 GHz Wi-Fi network on channel 6 and drained the gateway queue. It commits to SQLite before releasing gateway records.
- The exact production gateway and repeater binaries were then flashed and passed live telemetry, source acknowledgments, and Wi-Fi collection. The production gateway rejects bench-only USB commands.
- The Wemos was restored from its original flash backup, then updated to the current TTS Maker firmware. All three TTS sensor links and the light receiver reconnected; USB diagnostics reported zero transmission failures.

The Maker remains on production Chicken Chat gateway firmware. The bench configuration and original board backups stay private and are absent from the downloads. Release binaries contain no configured network keys or Wi-Fi credentials.

## Scope and remaining acceptance

The radio probe used a test-only synthetic source identity to force a real Maker-to-Wemos-to-Maker RF path. This verifies forwarding with two physical radios; it does not substitute for a source, three independent physical repeaters, and a gateway. Eight-hop and alternate-path routing passed the actual C++ transport tests in simulation.

No chicken-house distance or repeater spacing is claimed. Multiple independent physical repeaters, a 24-hour operating-house soak, sensor calibration, interrupted-write power loss, and installed load capacity remain field acceptance work. Feeder/shaker variants compile and preserve their hardware profiles; they were not flashed onto connected motor equipment during this bench test.

The release carries readings and alarms. Existing equipment control stays local. It does not provide general internet access for phones or cameras.

## Reproducible release checks

All six ESP32 builds passed. Software validation includes 18 C++ transport/codec scenarios, 12 collector/package tests, 12 browser configuration/USB workflow tests, 18 dashboard/API regression files, and repository schema/fixture validation. The package manifest contains each binary's size, flash offset, and SHA-256 hash. Hardware evidence is tied to the exact production gateway and repeater binary hashes before packaging.

Browser QA: desktop and 390-pixel layouts were visually inspected. Role changes, sensor controls, board-profile selection, error messages, and absence of horizontal overflow were checked. USB configuration workflows passed automated stream tests; physical flashing and provisioning used the USB tool. The browser-specific serial-port chooser was not completed during this check.
