import {createNetwork, validateNetwork, makeConfig} from './mesh-config.mjs';
const $ = id => document.getElementById(id);
let port, reader, writer, pending, board, network, closing = false;
function notice(text, error = false) { $('setup-status').textContent = text; $('setup-status').dataset.error = String(error); }
function roleChanged() {
  const role = $('mesh-role').value;
  $('gateway-settings').hidden = role !== 'gateway';
  $('mesh-ssid').required = role === 'gateway';
  $('sensor-settings').hidden = !['repeater','leaf'].includes(role);
  $('network-create').disabled = role !== 'gateway';
}
function loaded(n) {
  network = validateNetwork(n); $('mesh-channel').value = network.channel; $('mesh-channel').disabled = true;
  $('network-state').textContent = `Network loaded · channel ${network.channel}`;
}
function download(value) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(value, null, 2)], {type:'application/json'}));
  const link = document.createElement('a'); link.href = url; link.download = 'chicken-chat-network.private.json'; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
async function disconnect() {
  closing = true;
  if (pending) { pending.reject(Error('Board disconnected.')); pending = null; }
  if (reader) { try { await reader.cancel(); } catch {} }
  if (writer) { writer.releaseLock(); writer = null; }
  if (port) { try { await port.close(); } catch {} port = null; }
  board = null; $('board-id').textContent = 'No board connected';
  $('usb-connect').disabled = false; $('usb-disconnect').disabled = true;
}
async function readLoop() {
  const decoder = new TextDecoder(); let buffer = '';
  try {
    while (true) {
      const {value,done} = await reader.read(); if (done) break;
      buffer += decoder.decode(value, {stream:true}); if (buffer.length > 65536) buffer = '';
      let pos;
      while ((pos = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0,pos).trim(); buffer = buffer.slice(pos + 1);
        let obj; try { obj = JSON.parse(line); } catch { continue; }
        if (pending && (obj.error || Object.hasOwn(obj, pending.key))) {
          const waiting = pending; pending = null;
          if (obj.error) waiting.reject(Error(`Board rejected settings: ${obj.error}`)); else waiting.resolve(obj);
        }
      }
    }
  } catch { if (!closing) notice('USB connection lost. Reconnect the board to continue.', true); }
  finally {
    reader.releaseLock(); reader = null;
    if (!closing) {
      await disconnect();
      notice('USB connection lost. Reconnect the board to continue.', true);
    }
  }
}
async function request(value, key) {
  if (!writer || pending) throw Error('Connect a board and wait for the current operation to finish.');
  let timer;
  const response = new Promise((resolve,reject) => {
    pending = {key,resolve,reject};
    timer = setTimeout(() => { pending = null; reject(Error('No response. Install the mesh firmware, close its installer, and reconnect.')); }, 10000);
  });
  try {
    // Observe both promises immediately so a disconnected reader cannot reject unhandled.
    const results = await Promise.all([writer.write(new TextEncoder().encode(JSON.stringify(value) + '\n')), response]);
    return results[1];
  }
  finally { clearTimeout(timer); pending = null; }
}
$('usb-connect').addEventListener('click', async () => {
  if (!navigator.serial) { notice('USB setup requires desktop Chrome or Edge.', true); return; }
  $('usb-connect').disabled = true;
  try {
    closing = false; port = await navigator.serial.requestPort(); await port.open({baudRate:115200});
    await port.setSignals({dataTerminalReady:false, requestToSend:false});
    reader = port.readable.getReader(); writer = port.writable.getWriter(); readLoop();
    board = await request({op:'status'},'id'); $('board-id').textContent = `Board ${board.id}`;
    $('usb-disconnect').disabled = false; notice('Board connected. Create or load its network file.');
  } catch (error) { await disconnect(); notice(error.name === 'NotFoundError' ? 'No board selected.' : error.message, true); }
});
$('usb-disconnect').addEventListener('click', async () => { await disconnect(); notice('Board disconnected.'); });
$('mesh-role').addEventListener('change', roleChanged);
$('network-create').addEventListener('click', () => {
  try {
    if (!board) throw Error('Connect the gateway board first.');
    if (network) throw Error('A network is already loaded. Use that file for the remaining boards; reload this page to create a different network.');
    loaded(createNetwork(board.id, Number($('mesh-channel').value))); download(network);
    notice('Network file downloaded. Keep it private and load it for each remaining board.');
  } catch (error) { notice(error.message, true); }
});
$('network-file').addEventListener('change', async event => {
  const file = event.target.files[0]; if (!file) return;
  try { if (file.size > 4096) throw Error('Network file is too large.'); loaded(JSON.parse(await file.text())); notice('Network loaded. Enter this board’s name and location.'); }
  catch (error) { notice(error instanceof SyntaxError ? 'This file is not valid JSON.' : error.message, true); }
});
$('mesh-form').addEventListener('submit', async event => {
  event.preventDefault(); $('mesh-save').disabled = true;
  try {
    const fields = Object.fromEntries(['role','name','house','zone','ssid','password','analog','contact'].map(key => [key,$(`mesh-${key}`).value.trim()]));
    fields.password = $('mesh-password').value;
    fields.ssid = $('mesh-ssid').value;
    const cfg = makeConfig(network,board?.id,fields);
    const result = await request(cfg,'saved'); if (result.saved !== true) throw Error('The board did not confirm saved settings.');
    $('mesh-password').value = ''; await disconnect(); notice('Settings saved. The board is restarting. Connect the next board when ready.');
  } catch (error) { notice(error.message, true); }
  finally { $('mesh-save').disabled = false; }
});
$('feeder-profile').addEventListener('change', event => {
  $('feeder-installer').setAttribute('manifest',event.target.value);
  const descriptions = {'manifest-feeder-bin-bot.json':'ACEBOTT ESP32 Max prototype shield', 'manifest-feeder-production.json':'Production feeder PCB', 'manifest-feeder-devkit.json':'Original ESP32 DevKit feeder pin map'};
  $('feeder-description').textContent = `${descriptions[event.target.value]}, with mesh telemetry and existing local controls.`;
});
roleChanged();
if (!navigator.serial) notice('Firmware installation and USB setup require desktop Chrome or Edge. Downloads remain available.');
