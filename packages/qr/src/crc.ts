/**
 * CRC-16/CCITT-FALSE — the CRC algorithm mandated by EMVCo QR codes
 * (poly 0x1021, initial 0xFFFF). Computed over the UTF-8 bytes of the entire
 * payload EXCLUDING the CRC field itself.
 */
export function crc16Ccitt(data: Uint8Array): number {
  let crc = 0xffff;
  for (const byte of data) {
    crc ^= byte << 8;
    for (let bit = 0; bit < 8; bit++) {
      crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
    }
  }
  return crc;
}

/** Convert a hex string to bytes. Assumes valid, even-length hex. */
export function hexToBytes(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

/** UTF-8 bytes of a string (TextEncoder; ASCII fallback). */
export function stringToUtf8(s: string): Uint8Array {
  if (typeof TextEncoder !== "undefined") {
    return new TextEncoder().encode(s);
  }
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) {
    out[i] = s.charCodeAt(i) & 0xff;
  }
  return out;
}
