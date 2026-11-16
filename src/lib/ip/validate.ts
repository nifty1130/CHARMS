import ipaddr from 'ipaddr.js';

/**
 * IPアドレスがIPv4アドレスかどうかを判定する
 * 
 * @param ip IPアドレス
 * 
 * @return IPアドレスがIPv4アドレスの場合はtrue、そうでない場合はfalse
 */
export function isIPv4(ip: string): boolean {
  return ipaddr.IPv4.isValid(ip);
}

/**
 * IPアドレスがIPv6アドレスかどうかを判定する
 * 
 * @param ip IPアドレス
 * 
 * @return IPアドレスがIPv6アドレスの場合はtrue、そうでない場合はfalse
 */
export function isIPv6(ip: string): boolean {
  return ipaddr.IPv6.isValid(ip);
}

/**
 * IPアドレスがmDNSアドレスかどうかを判定する
 * 
 * @param addr IPアドレス
 * 
 * @return IPアドレスがmDNSアドレスの場合はtrue、そうでない場合はfalse
 */
export function isMdns(addr: string): boolean {
  return addr.endsWith('.local');
}
