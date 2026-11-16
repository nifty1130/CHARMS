import { describe, expect, it } from "vitest";
import { isIPv6, isMdns } from "./validate";

describe("isIPv6", () => {
  it("IPv6アドレスの場合にtrueを返す", () => {
    expect(isIPv6("2001:0db8:85a3:0000:0000:8a2e:0370:7334")).toBe(true);
  });
  
  it("IPv6でないアドレスの場合にfalseを返す", () => {
    expect(isIPv6("192.168.1.1")).toBe(false);
    expect(isIPv6("example.local")).toBe(false);
  });
});

describe("isMdns", () => {
  it("mDNSアドレスの場合にtrueを返す", () => {
    expect(isMdns("example.local")).toBe(true);
  });

  it("mDNSでないアドレスの場合にfalseを返す", () => {
    expect(isMdns("192.168.1.1")).toBe(false);
    expect(isMdns("2001:0db8:85a3:0000:0000:8a2e:0370:7334")).toBe(false);
  });
});
