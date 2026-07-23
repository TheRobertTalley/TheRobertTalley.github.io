# XIAO Sense Meshtastic Firmware Package

This folder documents the flashable Seeed Studio XIAO nRF52840 Sense firmware
that is bundled into the TalleySoft Vision Quest Android plugin.

## Ready-To-Flash Artifact

- UF2:
  `quest/SphereCockpit/Assets/Plugins/Android/SphereCockpitPlugin.androidlib/src/main/assets/firmware/xiao-sense-meshtastic.uf2`
- SHA-256:
  `A47CFCF1C14E390A2728C6C042941262A6EC07859B491CB23236626A4A38311E`
- Size: `1,063,936` bytes.
- UF2 blocks: `2,078`.
- Magic values validated:
  `0A324655`, `9E5D5157`, `0AB16F30`.

## Flash Paths

1. Headset flash path:
   - Connect the XIAO/Meshtastic device to the Quest.
   - Use the TalleySoft Vision firmware action.
   - The Android bridge requests DFU, waits for the XIAO UF2 mass-storage
     bootloader, validates the bundled UF2, and writes it over USB.

2. Manual fallback:
   - Double-tap reset on the XIAO nRF52840 Sense.
   - Wait for the UF2 bootloader drive to mount.
   - Copy `xiao-sense-meshtastic.uf2` to the mounted drive.
   - The board reboots automatically after the copy.

## Event Contract

The firmware should keep audio local and emit only compact tactical events.
The current event vocabulary is intentionally text-compatible with the
Meshtastic transport:

```text
!threat <latitude> <longitude> <headingDeg> <source>
!gunshot <latitude> <longitude> <headingDeg> <source>
!heading <latitude> <longitude> <headingDeg> <source>
!follow <latitude> <longitude> <source>
!stop <latitude> <longitude> <source>
```

Expected behavior:

- `!threat`: yellow 3-degree bearing marker, fade after 5 seconds.
- `!gunshot`: red bearing marker, fade after 5 seconds.
- `!heading`: green bearing marker, fade after 5 seconds.
- `!follow`: breadcrumb route event, accepted only when GPS accuracy is at or
  better than 20 yards.
- `!stop`: bright-red stop alert and warning triangle, fade after 2.5 seconds.

## Detection Scope

The XIAO nRF52840 Sense has a PDM microphone and IMU. The intended firmware
workload is low-rate event detection, not raw audio streaming:

- simple phrase triggers such as `Threat`, `Target`, `Follow me`,
  `Mark Direction`, `Mark Heading`, `Stop`, `Halt`, and `Hold up`;
- transient impulse detection for possible gunshot events;
- stillness gates for gesture-derived events supplied by the headset;
- local confidence thresholding before a Meshtastic event is transmitted.

The firmware package is ready for flashing as a bundled UF2. Firmware source
and model training assets should be added beside this manifest when the next
model build is produced.

