/**
 * IPv4アドレスをバイト列に変換する
 *
 * @param ip IPv4アドレス
 * @returns バイト列
 */
export function IPv4ToByte(ip: string): Uint8Array {
  const parts = ip.split('.').map(Number);
  return new Uint8Array(parts);
}

/**
 * IPv6アドレスをバイト列に変換する
 *
 * @param ip IPv6アドレス
 * @returns バイト列
 */
export function IPv6ToByte(ip: string): Uint8Array {
  const parts = ip.split(':').map(part => parseInt(part, 16));
  const byte = new Uint8Array(16);
  for (let i = 0; i < parts.length; i++) {
    byte[i * 2] = (parts[i] >> 8) & 0xff;
    byte[i * 2 + 1] = parts[i] & 0xff;
  }
  return byte;
}

/**
 * mDNSアドレスをバイト列に変換する
 *
 * @param addr mDNSアドレス
 * @returns バイト列
 */
export function mdnsToByte(addr: string): Uint8Array {
  const encoder = new TextEncoder();
  return encoder.encode(addr.replace('.local', ''));
}

/**
 * バイト列をIPv4アドレスに変換する
 *
 * @param byte バイト列
 * @returns IPv4アドレス
 */
export function byteToIPv4(byte: Uint8Array): string {
  return Array.from(byte).join('.');
}

/**
 * バイト列をIPv6アドレスに変換する
 *
 * @param byte バイト列
 * @returns IPv6アドレス
 */
export function byteToIPv6(byte: Uint8Array): string {
  const parts = [];
  for (let i = 0; i < byte.length; i += 2) {
    const part = (byte[i] << 8) | byte[i + 1];
    parts.push(part.toString(16));
  }
  return parts.join(':');
}

/**
 * バイト列をmDNSアドレスに変換する
 *
 * @param byte バイト列
 * @returns mDNSアドレス
 */
export function byteToMdns(byte: Uint8Array): string {
  const decoder = new TextDecoder();
  return decoder.decode(byte) + '.local';
}
