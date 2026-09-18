import { afterEach, beforeEach, describe, expect, it } from "vitest"

import {
  isLeaderboardEnabled,
  normaliseUrl,
  recordReview,
  setBoardClient,
  topEntries,
} from "./leaderboard"
import type { BoardClient, ReviewRecord } from "./leaderboard"

/** An in-memory stand-in for the two keys the board uses. */
const fakeRedis = () => {
  const entries = new Map<string, string>()
  const scores = new Map<string, number>()

  const client: BoardClient = {
    hget: async (_key, field) => entries.get(field) ?? null,
    hset: async (_key, value) => {
      for (const [field, raw] of Object.entries(value)) entries.set(field, String(raw))
      return 1
    },
    zadd: async (_key, member) => {
      scores.set(member.member, member.score)
      return 1
    },
    zrange: async (_key, start, stop, options) => {
      const ordered = [...scores.entries()].sort((a, b) =>
        options?.rev ? b[1] - a[1] : a[1] - b[1],
      )
      return ordered.slice(start, stop + 1).map(([member]) => member)
    },
    zremrangebyrank: async (_key, start, stop) => {
      const ordered = [...scores.entries()].sort((a, b) => a[1] - b[1])
      ordered.slice(start, stop + 1).forEach(([member]) => scores.delete(member))
      return 1
    },
    hmget: async (_key, ...fields) =>
      Object.fromEntries(fields.map((field) => [field, entries.get(field) ?? null])),
    zcard: async () => scores.size,
  }

  return { client, entries, scores }
}

const review = (over: Partial<ReviewRecord> = {}): ReviewRecord => ({
  url: "https://example.com/pricing",
  title: "Pricing",
  score: 70,
  band: "Designed",
  screenKind: "pricing",
  fixFirst: "hierarchy",
  elementCount: 120,
  now: 1_700_000_000_000,
  ...over,
})

describe("normaliseUrl", () => {
  const cases = [
    { input: "https://example.com/pricing", output: "example.com/pricing" },
    { input: "https://www.example.com/pricing", output: "example.com/pricing" },
    { input: "https://EXAMPLE.com/Pricing/", output: "example.com/Pricing" },
    { input: "https://example.com", output: "example.com" },
    // A query string is where tokens and tracking ids live. A public board
    // should not hold them, and dropping them gives a page one identity.
    { input: "https://example.com/p?utm_source=x&session=secret", output: "example.com/p" },
    { input: "https://example.com/p#section", output: "example.com/p" },
    { input: "not a url", output: null },
    { input: "ftp://example.com", output: null },
    { input: "javascript:alert(1)", output: null },
  ]

  cases.forEach(({ input, output }) => {
    it(`maps ${input} to ${output}`, () => {
      expect(normaliseUrl({ url: input })).toBe(output)
    })
  })
})

describe("the board without credentials", () => {
  beforeEach(() => {
    setBoardClient({ next: null })
    delete process.env["UPSTASH_REDIS_REST_URL"]
    delete process.env["UPSTASH_REDIS_REST_TOKEN"]
  })

  it("reports itself off", () => {
    expect(isLeaderboardEnabled()).toBe(false)
  })

  it("records nothing rather than throwing", async () => {
    await expect(recordReview({ record: review() })).resolves.toBeNull()
  })

  it("returns an empty board rather than throwing", async () => {
    await expect(topEntries()).resolves.toEqual([])
  })
})

describe("recording reviews", () => {
  let fake: ReturnType<typeof fakeRedis>

  beforeEach(() => {
    process.env["UPSTASH_REDIS_REST_URL"] = "https://fake.upstash.io"
    process.env["UPSTASH_REDIS_REST_TOKEN"] = "fake-token"
    fake = fakeRedis()
    setBoardClient({ next: fake.client })
  })

  afterEach(() => {
    setBoardClient({ next: null })
    delete process.env["UPSTASH_REDIS_REST_URL"]
    delete process.env["UPSTASH_REDIS_REST_TOKEN"]
  })

  it("stores a first review at its own score", async () => {
    const entry = await recordReview({ record: review({ score: 70 }) })
    expect(entry).toMatchObject({ key: "example.com/pricing", score: 70, reviews: 1 })
  })

  it("averages repeat reviews rather than keeping the latest", async () => {
    // The whole point: the model moves a couple of tenths between runs, so
    // keeping the latest would let anyone press until they liked the number.
    await recordReview({ record: review({ score: 40 }) })
    const entry = await recordReview({ record: review({ score: 80 }) })

    expect(entry?.score).toBe(60)
    expect(entry?.reviews).toBe(2)
  })

  it("cannot be walked upward by repeating a high score", async () => {
    await recordReview({ record: review({ score: 20 }) })
    for (let attempt = 0; attempt < 5; attempt += 1) {
      await recordReview({ record: review({ score: 100 }) })
    }
    const entry = await recordReview({ record: review({ score: 100 }) })

    // Seven samples, one of them 20: the mean is held below a perfect score.
    expect(entry?.score).toBeLessThan(90)
    expect(entry?.reviews).toBe(7)
  })

  it("treats the same page under different query strings as one entry", async () => {
    await recordReview({ record: review({ url: "https://example.com/pricing?utm=a", score: 60 }) })
    await recordReview({ record: review({ url: "https://www.example.com/pricing/", score: 80 }) })

    const board = await topEntries()
    expect(board).toHaveLength(1)
    expect(board[0]?.reviews).toBe(2)
    expect(board[0]?.score).toBe(70)
  })

  it("refuses a url it cannot normalise", async () => {
    await expect(recordReview({ record: review({ url: "not a url" }) })).resolves.toBeNull()
  })

  it("truncates a title rather than storing whatever the page claimed", async () => {
    const entry = await recordReview({ record: review({ title: "x".repeat(400) }) })
    expect(entry?.title.length).toBe(120)
  })

  it("keeps the stored total out of what callers see", async () => {
    const entry = await recordReview({ record: review() })
    expect(entry).not.toHaveProperty("total")
  })
})

describe("reading the board", () => {
  beforeEach(() => {
    process.env["UPSTASH_REDIS_REST_URL"] = "https://fake.upstash.io"
    process.env["UPSTASH_REDIS_REST_TOKEN"] = "fake-token"
    setBoardClient({ next: fakeRedis().client })
  })

  afterEach(() => {
    setBoardClient({ next: null })
    delete process.env["UPSTASH_REDIS_REST_URL"]
    delete process.env["UPSTASH_REDIS_REST_TOKEN"]
  })

  it("returns the highest scoring pages first", async () => {
    await recordReview({ record: review({ url: "https://a.com", score: 50 }) })
    await recordReview({ record: review({ url: "https://b.com", score: 90 }) })
    await recordReview({ record: review({ url: "https://c.com", score: 70 }) })

    const board = await topEntries()
    expect(board.map((entry) => entry.key)).toEqual(["b.com", "c.com", "a.com"])
  })

  it("honours the limit", async () => {
    await recordReview({ record: review({ url: "https://a.com", score: 50 }) })
    await recordReview({ record: review({ url: "https://b.com", score: 90 }) })

    expect(await topEntries({ limit: 1 })).toHaveLength(1)
  })

  it("returns nothing for an empty board", async () => {
    expect(await topEntries()).toEqual([])
  })
})
