import { describe, expect, it } from "vitest"

import { assertSafeUrl, BlockedUrlError, isBlockedAddress } from "./url-guard"

describe("isBlockedAddress", () => {
  const blockedV4 = [
    { address: "127.0.0.1", why: "loopback" },
    { address: "127.255.255.254", why: "loopback, high end" },
    { address: "10.0.0.1", why: "private class A" },
    { address: "172.16.0.1", why: "private class B, low end" },
    { address: "172.31.255.254", why: "private class B, high end" },
    { address: "192.168.1.1", why: "private class C" },
    { address: "169.254.169.254", why: "the cloud metadata endpoint" },
    { address: "0.0.0.0", why: "this network" },
    { address: "100.64.0.1", why: "carrier-grade NAT" },
    { address: "224.0.0.1", why: "multicast" },
    { address: "255.255.255.255", why: "reserved" },
  ]

  blockedV4.forEach(({ address, why }) => {
    it(`blocks ${address}, ${why}`, () => {
      expect(isBlockedAddress({ address, family: 4 })).toBe(true)
    })
  })

  const allowedV4 = ["1.1.1.1", "8.8.8.8", "93.184.216.34", "172.32.0.1", "11.0.0.1", "192.167.1.1"]

  allowedV4.forEach((address) => {
    it(`allows the public address ${address}`, () => {
      expect(isBlockedAddress({ address, family: 4 })).toBe(false)
    })
  })

  const blockedV6 = [
    { address: "::1", why: "loopback" },
    { address: "::", why: "unspecified" },
    { address: "fc00::1", why: "unique local" },
    { address: "fd12:3456::1", why: "unique local" },
    { address: "fe80::1", why: "link-local" },
    { address: "ff02::1", why: "multicast" },
    { address: "::ffff:127.0.0.1", why: "an IPv4 loopback wearing a v6 costume" },
    { address: "::ffff:169.254.169.254", why: "the metadata endpoint, v4-mapped" },
  ]

  blockedV6.forEach(({ address, why }) => {
    it(`blocks ${address}, ${why}`, () => {
      expect(isBlockedAddress({ address, family: 6 })).toBe(true)
    })
  })

  it("allows a public IPv6 address", () => {
    expect(isBlockedAddress({ address: "2606:4700:4700::1111", family: 6 })).toBe(false)
  })

  it("blocks an address it cannot parse rather than letting it through", () => {
    expect(isBlockedAddress({ address: "not-an-address", family: 4 })).toBe(true)
  })
})

describe("assertSafeUrl", () => {
  const rejected = [
    { input: "file:///etc/passwd", reason: "Only http and https" },
    { input: "ftp://example.com", reason: "Only http and https" },
    { input: "javascript:alert(1)", reason: "Only http and https" },
    { input: "not a url", reason: "not a valid URL" },
    { input: "http://user:pass@example.com", reason: "Remove the credentials" },
  ]

  rejected.forEach(({ input, reason }) => {
    it(`rejects ${input}`, async () => {
      await expect(assertSafeUrl({ input })).rejects.toThrow(BlockedUrlError)
      await expect(assertSafeUrl({ input })).rejects.toThrow(new RegExp(reason, "i"))
    })
  })

  const privateHosts = ["http://localhost", "http://127.0.0.1:3000", "http://[::1]:8080"]

  privateHosts.forEach((input) => {
    it(`rejects ${input} because it resolves to a private address`, async () => {
      await expect(assertSafeUrl({ input })).rejects.toThrow(/private address/i)
    })
  })

  it("rejects a host that does not resolve", async () => {
    await expect(
      assertSafeUrl({ input: "https://this-host-should-not-exist-glance.invalid" }),
    ).rejects.toThrow(/could not resolve/i)
  })
})
