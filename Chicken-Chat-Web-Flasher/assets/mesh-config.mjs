const hex = (s, length) => typeof s === 'string' && new RegExp(`^[0-9a-f]{${length}}$`, 'i').test(s);
export function validateNetwork(n) {
  if (!n || !Number.isInteger(n.network) || n.network < 1 || n.network > 2147483647 ||
      !hex(n.gateway, 16) || /^0+$/.test(n.gateway) || !hex(n.key, 64) || /^0+$/.test(n.key) ||
      !hex(n.token, 64) || !Number.isInteger(n.channel) || n.channel < 1 || n.channel > 11)
    throw Error('Choose a valid Chicken Chat network file.');
  return {network:n.network, gateway:n.gateway.toLowerCase(), key:n.key.toLowerCase(), token:n.token.toLowerCase(), channel:n.channel};
}
export function createNetwork(id, channel, random = globalThis.crypto) {
  const secret = () => Array.from(random.getRandomValues(new Uint8Array(32)), b => b.toString(16).padStart(2, '0')).join('');
  return validateNetwork({network: (random.getRandomValues(new Uint32Array(1))[0] % 2147483647) + 1,
    gateway:id, channel, key:secret(), token:secret()});
}
export function makeConfig(network, boardId, fields) {
  const n = validateNetwork(network);
  if (!hex(boardId,16)) throw Error('Connect a board first.');
  if (!['gateway','repeater','controller','leaf'].includes(fields.role)) throw Error('Choose a firmware role.');
  for (const key of ['name','house','zone']) if (!/^[A-Za-z0-9 _-]{1,24}$/.test(fields[key] || ''))
    throw Error('Names must use 1–24 letters, numbers, spaces, hyphens, or underscores.');
  const gateway = fields.role === 'gateway', sensor = ['repeater','leaf'].includes(fields.role);
  if (gateway !== (boardId.toLowerCase() === n.gateway)) throw Error(gateway ? 'This network belongs to a different gateway board.' : 'This board is the gateway in the loaded network file.');
  if (fields.role === 'controller' && n.channel !== 6) throw Error('Feeder and shaker firmware require channel 6.');
  if (gateway && (!fields.ssid || new TextEncoder().encode(fields.ssid).length > 32)) throw Error('Enter a Wi-Fi name of 1–32 bytes.');
  if (gateway && new TextEncoder().encode(fields.password || '').length > 63) throw Error('Wi-Fi password is too long.');
  const analog = sensor ? Number(fields.analog) : -1, contact = sensor ? Number(fields.contact) : -1;
  if (![-1,32,33,34,35,36,39].includes(analog) || ![-1,18,19,21,22,23,25,26,27,32,33].includes(contact) || (analog >= 0 && analog === contact))
    throw Error('Choose different, supported pins for the two sensor inputs.');
  return {op:'configure', ...n, name:fields.name, house:fields.house, zone:fields.zone,
    forward:fields.role !== 'leaf', analog_pin:analog, contact_pin:contact, interval_ms:30000,
    ssid:gateway ? fields.ssid : '', password:gateway ? fields.password || '' : '', token:gateway ? n.token : ''};
}
