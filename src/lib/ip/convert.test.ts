import { describe, expect, it } from "vitest";
import { byteToIPv4, IPv6ToByte, mdnsToByte, IPv4ToByte, byteToIPv6, byteToMdns } from "./convert";

describe("IPv4ToByte", () => {
  it("IPv4を正しくバイト列に変換できる", () => {
    const ip = "192.168.1.1";
    const result = IPv4ToByte(ip);
    expect(result).toEqual(new Uint8Array([192, 168, 1, 1]));
  });
});

describe("IPv6ToByte", () => {
  it("IPv6を正しくバイト列に変換できる", () => {
    const ip = "2001:0db8:85a3:0000:0000:8a2e:0370:7334";
    const result = IPv6ToByte(ip);
    expect(result).toEqual(new Uint8Array([
      0x20, 0x01, 0x0d, 0xb8,
      0x85, 0xa3, 0x00, 0x00,
      0x00, 0x00, 0x8a, 0x2e,
      0x03, 0x70, 0x73, 0x34
    ]));
  });
});

describe("mdnsToByte", () => {
  it("mDNSアドレスを正しくバイト列に変換できる", () => {
    const addr = "mydevice.local";
    const result = mdnsToByte(addr);
    const encoder = new TextEncoder();
    expect(result).toEqual(encoder.encode("mydevice"));
  });
});

describe("byteToIPv4", () => {
  it("バイト列を正しくIPv4に変換できる", () => {
    const byte = new Uint8Array([192, 168, 1, 1]);
    const result = byteToIPv4(byte);
    expect(result).toBe("192.168.1.1");
  });
});

describe("byteToIPv6", () => {
  it("バイト列を正しくIPv6に変換できる", () => {
    const byte = new Uint8Array([
      0x24, 0x43, 0x6a, 0x3a,
      0xc4, 0xf0, 0xee, 0x23,
      0x3d, 0x94, 0xbb, 0x22,
      0x2f, 0xe2, 0xac, 0x7b
    ]);
    const result = byteToIPv6(byte);
    expect(result).toBe("2443:6a3a:c4f0:ee23:3d94:bb22:2fe2:ac7b");
  });
});

describe("byteToMdns", () => {
  it("バイト列を正しくmDNSアドレスに変換できる", () => {
    const encoder = new TextEncoder();
    const byte = encoder.encode("mydevice");
    const result = byteToMdns(byte);
    expect(result).toBe("mydevice.local");
  });
});
