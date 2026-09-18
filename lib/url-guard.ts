import { lookup } from "node:dns/promises"

/**
 * Validates a URL the visitor supplied before the server fetches it.
 *
 * A server that fetches whatever it is handed is a request forgery hole: the
 * attacker's target is not the public internet but everything the server can
 * reach and they cannot, which locally means your own dev services and in a
 * cloud means the instance metadata endpoint that hands out credentials.
 *
 * So the host is resolved here and every address it answers with is checked
 * against the ranges that are never a legitimate review target.
 */

export class BlockedUrlError extends Error {
  constructor({ message }: { message: string }) {
    super(message)
    this.name = "BlockedUrlError"
  }
}

/** Ranges that are never a legitimate target, as `[firstAddress, prefixLength]`. */
const BLOCKED_V4_RANGES: readonly (readonly [string, number])[] = [
  ["0.0.0.0", 8], // this network
  ["10.0.0.0", 8], // private
  ["100.64.0.0", 10], // carrier-grade NAT
  ["127.0.0.0", 8], // loopback
  ["169.254.0.0", 16], // link-local, including the cloud metadata endpoint
  ["172.16.0.0", 12], // private
  ["192.0.0.0", 24], // protocol assignments
  ["192.168.0.0", 16], // private
  ["198.18.0.0", 15], // benchmarking
  ["224.0.0.0", 4], // multicast
  ["240.0.0.0", 4], // reserved
]

const toV4Number = ({ address }: { address: string }): number | null => {
  const parts = address.split(".")
  if (parts.length !== 4) return null

  let total = 0
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null
    const octet = Number(part)
    if (octet > 255) return null
    total = total * 256 + octet
  }
  return total
}

const isBlockedV4 = ({ address }: { address: string }): boolean => {
  const value = toV4Number({ address })
  if (value === null) return true // unparseable means unsafe

  return BLOCKED_V4_RANGES.some(([base, prefix]) => {
    const baseValue = toV4Number({ address: base })
    if (baseValue === null) return false
    const mask = prefix === 0 ? 0 : (-1 << (32 - prefix)) >>> 0
    return (value & mask) >>> 0 === (baseValue & mask) >>> 0
  })
}

const isBlockedV6 = ({ address }: { address: string }): boolean => {
  const normalised = address.toLowerCase().split("%")[0] ?? ""

  // An IPv4-mapped address is an IPv4 address wearing a v6 costume.
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(normalised)
  if (mapped?.[1]) return isBlockedV4({ address: mapped[1] })

  if (normalised === "::" || normalised === "::1") return true
  if (/^f[cd]/.test(normalised)) return true // unique local, fc00::/7
  if (/^fe[89ab]/.test(normalised)) return true // link-local, fe80::/10
  if (/^ff/.test(normalised)) return true // multicast
  return false
}

export const isBlockedAddress = ({ address, family }: { address: string; family: number }): boolean =>
  family === 4 ? isBlockedV4({ address }) : isBlockedV6({ address })

/**
 * Checks a URL and returns it alongside every address its host resolves to.
 *
 * The addresses come back because resolving twice is not the same as resolving
 * once: a host that answers with a public address here could answer with a
 * private one when the browser looks it up. The caller pins the connection to
 * these addresses instead of trusting a second lookup.
 */
export const assertSafeUrl = async ({
  input,
}: {
  input: string
}): Promise<{ url: URL; addresses: readonly string[] }> => {
  let url: URL
  try {
    url = new URL(input.trim())
  } catch {
    throw new BlockedUrlError({ message: "That is not a valid URL." })
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new BlockedUrlError({ message: "Only http and https addresses can be reviewed." })
  }

  if (url.username || url.password) {
    throw new BlockedUrlError({ message: "Remove the credentials from the URL." })
  }

  // A literal address is already the answer, so asking DNS about it is both
  // pointless and wrong: `[::1]` is not a name any resolver will accept.
  const hostname = url.hostname.replace(/^\[|\]$/g, "")
  const isLiteralV4 = /^\d{1,3}(?:\.\d{1,3}){3}$/.test(hostname)
  const isLiteralV6 = hostname.includes(":")

  if (isLiteralV4 || isLiteralV6) {
    if (isBlockedAddress({ address: hostname, family: isLiteralV4 ? 4 : 6 })) {
      throw new BlockedUrlError({
        message: `${hostname} is a private address. Only public sites can be reviewed.`,
      })
    }
    return { url, addresses: [hostname] }
  }

  let resolved: { address: string; family: number }[]
  try {
    resolved = await lookup(hostname, { all: true })
  } catch {
    throw new BlockedUrlError({ message: `Could not resolve ${url.hostname}.` })
  }

  if (resolved.length === 0) {
    throw new BlockedUrlError({ message: `Could not resolve ${url.hostname}.` })
  }

  const blocked = resolved.find((entry) => isBlockedAddress(entry))
  if (blocked) {
    throw new BlockedUrlError({
      message: `${url.hostname} resolves to a private address. Only public sites can be reviewed.`,
    })
  }

  return { url, addresses: resolved.map((entry) => entry.address) }
}
