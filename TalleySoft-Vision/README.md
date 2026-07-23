# Sphere Link to Quest 3

Goal: carry the Sphere Link receiver's encoded FPV stream directly over USB to a
Quest 3, without HDMI or a capture device.

## Verified hardware and shipped software

- The receiver is a Radxa Zero 3W running the OpenIPC SBC ground-station image.
- The board has one USB 2.0 OTG port and one USB 3.0 host port.
- The shipped card contains OpenIPC ground-station `v2.0.0 beta 2` on Debian 11.
- Its kernel and Radxa utilities already support USB NCM, ECM, serial, storage,
  and UVC gadget functions.
- Both board DTBs already set the USB 2.0 controller to OTG mode.
- WFB-NG receives encoded FPV video and currently sends it to
  `127.0.0.1:5600`.
- Android PixelPilot can decode an incoming UDP stream on port `5600`.

The applied patch uses this data path:

```text
5.8 GHz RTL8812 receiver
  -> WFB-NG/FEC decode on Sphere Link
  -> encoded H.265 UDP on 127.0.0.1:5601
  -> low-overhead ARM64 relay
      -> local PixelPilot on 127.0.0.1:5600 (preserves HDMI)
      -> SLIP-framed UDP packets over USB ACM
      -> Sphere Bridge service on Quest
      -> PixelPilot on 127.0.0.1:5600
  -> Quest hardware decoder/display
```

This avoids HDMI conversion and avoids decoding/re-encoding on the Sphere Link.

## Sphere Cockpit Quest app

The mixed-reality Quest project is at:

`C:\Users\TALLEY\Documents\VR FPV\quest\SphereCockpit`

It keeps native passthrough active, uses hand-only controls, claims the same
Sphere USB ACM device directly, and renders the hardware-decoded stream through
a persistent low-latency compositor layer. Sphere Link and standard UVC video
receivers such as the Eachine ROTG01 are selected automatically. The default
theater layout preserves peripheral passthrough; explicit gestures select an
upper-right glance monitor or a curved full-field cockpit view. Center video is
rendered at 50% opacity; an active approach alert makes it clearer without ever
dimming the source below that baseline. The
heading-up terrain/team HUD docks in a control quadrant and can expand to
center. Both Quest RGB
camera feeds remain active for computer vision while native passthrough stays
visible, and the app requests boundary suppression. Meshtastic/TAK awareness,
approach warnings, depth ranging, future thermal registration, and optional
Tailscale nodes share the HUD state but are kept out of the primary
flight-video path. Low-light and thermal modes require a real camera source;
the app does not synthesize a night-vision color effect.

The current Quest build is:

`C:\Users\TALLEY\Documents\VR FPV\quest\SphereCockpit\Builds\Talleysoft-Vision-v0.11.45-debug.apk`

### Tactical markers

Send a Meshtastic text message containing a marker command and decimal
coordinates. The marker appears on both the terrain map and compass:

```text
!target 39.123456,-77.123456 RIDGE
!location 39.123456 -77.123456 RALLY
!route 39.123456 -77.123456 ROUTE ALPHA
!lz 39.123456 -77.123456 LZ BRAVO
!medical 39.123456 -77.123456 AID
!threat 39.123456 -77.123456 42 THREAT
!gunshot 39.123456 -77.123456 42 GUNSHOT
!markdir 39.123456 -77.123456 42 MARK DIR
```

Repeated `!route` messages with the same label form a route overlay. ATAK
Cursor-on-Target PLI and point events are accepted on `239.2.3.1:6969`.

The public TSV operations page is:

`https://theroberttalley.github.io/TalleySoft-Vision/`

For live Meshtastic GPS, headset tracks, markers, and browser-to-radio marker
commands, attach the XIAO/Meshtastic radio to the headset and launch
Talleysoft Vision. The headset app hosts telemetry on port `8787`:

```text
ws://HEADSET-IP:8787
http://HEADSET-IP:8787/snapshot
```

Open the public TSV operations page and set the bridge URL to the headset
address. For bench testing over ADB, forward the headset telemetry port with
`adb forward tcp:8787 tcp:8787` and use `ws://127.0.0.1:8787`. The older PC
Python bridge remains available only for PC-attached radio testing. See
`WEB_TELEMETRY_PROTOCOL.md` for the JSON and marker-command contract.

See `quest\SphereCockpit\ARCHITECTURE.md` for the delivery order and latency
rules.

## Patched gadget test

1. Insert the patched microSD and boot the Sphere Link.
2. Connect the computer to the Sphere Link's OTG/power USB-C port, not its
   USB-host port.
3. Run:

```powershell
.\tools\Detect-SphereGadget.ps1 -WaitSeconds 60
```

It should identify as `Sphere Link FPV Bridge` (`VID_1D6B&PID_0104`) with one
CDC-ACM function. Windows exposes it as a COM port for validation. Quest uses
the ACM bulk endpoint directly through the Sphere Bridge app; it does not
depend on Quest Ethernet or DHCP support.

## Quest setup

Connect a developer-enabled Quest 3 to this computer, approve its USB debugging
prompt, and run:

```powershell
.\tools\Install-PixelPilot.ps1
```

Install both PixelPilot and the Sphere Bridge APK. Connect the Sphere Link OTG
port and choose Sphere Bridge in the USB application dialog. The foreground
bridge claims the ACM endpoint, forwards the original encoded packets to
PixelPilot on UDP port `5600`, and launches PixelPilot automatically. No video
decode or re-encode occurs in the bridge.

## Remote Quest ADB

The Quest trusts this computer's Windows ADB key persistently and exposes secure
wireless ADB on the local network. The scheduled task
`Sphere Cockpit - Remote Quest ADB` discovers the current TLS endpoint over
mDNS and reconnects every five minutes without using the USB port.

To connect immediately:

```powershell
.\tools\Connect-QuestRemote.ps1
```

If the headset Library hides Unknown Sources while offline, launch the Quest app
directly over ADB instead:

```powershell
.\tools\Launch-TalleysoftVision.ps1
```

With USB attached, `Connect-QuestRemote.ps1` bootstraps TCP ADB from the headset's
current Wi-Fi address and saves the endpoint for later reconnects. After it
prints an address such as `192.168.1.61:5555`, the USB cable can be unplugged.

## Recovery rule

The readable region of the original card is stored under `backups/` and
SHA-256 verified. The card's GPT claims 31,266,439,168 bytes, while its lower
level capacity report is only 31,264,289,280 bytes. The original DVR partition
therefore extends roughly 2.1 MB beyond the reported media, which explains
Windows' `Full Repair Needed` status. The complete config, boot, and Linux
rootfs partitions were captured before modification.

- Readable stock-card bytes:
  `FFFDF9E2B529BDD36198808BD1AF6AD5C9D3F0512E033A1FD8C1B743874662EB`
- ACM-only USB bridge rootfs image:
  `3226B65B1FA8FEC9582DFD67F951DC394BAAAC5E5B2942B1DD983BCA91408710`

## Upstream baseline

- OpenIPC `sbc-groundstations` commit:
  `4903bdaf13ae84f624a64c484a6ef74639736623`
- OpenIPC PixelPilot commit:
  `2793401f5f2bcfea9ff97829bb0f240204c8dcd6`
- `runcam_wifilink_sdcard.img` snapshot date: 2026-05-29
- Snapshot SHA-256:
  `B9D88F11F657FEEDD7B133B4ADE8C6500DF5A3986382DEA1C7060A27DF5EBB25`
