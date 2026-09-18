import { Redis } from "@upstash/redis"

/**
 * The leaderboard: which pages have been reviewed, and how they scored.
 *
 * Three rules shape everything here.
 *
 * A score is never accepted from the browser. The server writes an entry only
 * after it has run the review itself, so the write path cannot be used to put
 * an arbitrary number on the board.
 *
 * A page's score is the mean of every review it has had, not the latest. The
 * model's answers move by a couple of tenths between runs, so keeping the
 * latest would let anyone press the button until they liked the number. A mean
 * cannot be shopped, and it gets more trustworthy the more samples it has,
 * which is why the sample count is stored beside it.
 *
 * Absence is not an error. With no credentials configured the whole feature
 * reports itself off and the app runs without it, because a contributor who
 * clones this repo has no database and should not meet a crash.
 */

/** The ordering. Member is the normalised key, score is the running mean. */
const BOARD_KEY = "glance:board"
/** The detail behind each member, as JSON. */
const ENTRIES_KEY = "glance:entries"

const MAX_TITLE = 120
const MAX_URL = 300
/** Past this the tail is dropped, so one popular week cannot grow forever. */
const MAX_ENTRIES = 500

export type BoardEntry = {
  /** Normalised host and path. The identity of a page on the board. */
  key: string
  url: string
  title: string
  /** Mean of every review this page has had, 0 to 100. */
  score: number
  band: string
  screenKind: string
  fixFirst: string
  elementCount: number
  /** How many reviews the mean is drawn from. */
  reviews: number
  /** Epoch milliseconds of the most recent review. */
  reviewedAt: number
}

/** What a caller hands in after a review it ran itself. */
export type ReviewRecord = {
  url: string
  title: string
  score: number
  band: string
  screenKind: string
  fixFirst: string
  elementCount: number
  /** Passed in rather than read from the clock, so this stays testable. */
  now: number
}

/**
 * Host and path, lowercased, without the query or the fragment.
 *
 * Two reasons, and the second matters more. Query strings are where session
 * tokens and tracking identifiers live, and a public board should not hold
 * them. Dropping them also means one page has one identity rather than a row
 * per campaign parameter.
 */
export const normaliseUrl = ({ url }: { url: string }): string | null => {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return null
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null

  const host = parsed.hostname.toLowerCase().replace(/^www\./, "")
  const path = parsed.pathname.replace(/\/+$/, "")
  return `${host}${path}`.slice(0, MAX_URL)
}

const clean = ({ text, max }: { text: string; max: number }): string =>
  text.replace(/\s+/g, " ").trim().slice(0, max)

/** The subset of the client this module uses, so a test can stand one in. */
export type BoardClient = {
  hget: (key: string, field: string) => Promise<unknown>
  hset: (key: string, value: Record<string, unknown>) => Promise<unknown>
  zadd: (key: string, member: { score: number; member: string }) => Promise<unknown>
  zrange: (
    key: string,
    start: number,
    stop: number,
    options?: { rev?: boolean },
  ) => Promise<string[]>
  zremrangebyrank: (key: string, start: number, stop: number) => Promise<unknown>
  hmget: (key: string, ...fields: string[]) => Promise<Record<string, unknown> | null>
  zcard: (key: string) => Promise<number>
}

let client: BoardClient | null = null

const hasCredentials = (): boolean =>
  Boolean(process.env["UPSTASH_REDIS_REST_URL"] && process.env["UPSTASH_REDIS_REST_TOKEN"])

/** Whether the board is configured at all. */
export const isLeaderboardEnabled = (): boolean => hasCredentials()

const getClient = (): BoardClient | null => {
  if (!hasCredentials()) return null
  if (!client) client = Redis.fromEnv() as unknown as BoardClient
  return client
}

/** Injected by tests. Passing null restores the real one. */
export const setBoardClient = ({ next }: { next: BoardClient | null }): void => {
  client = next
}

type StoredEntry = BoardEntry & {
  /** Sum of every score recorded, so the mean survives without the samples. */
  total: number
}

const parseStored = ({ raw }: { raw: unknown }): StoredEntry | null => {
  if (raw === null || raw === undefined) return null
  // Upstash decodes JSON values on the way out; a string means it did not.
  const value: unknown = typeof raw === "string" ? safeParse({ text: raw }) : raw
  if (typeof value !== "object" || value === null) return null
  const entry = value as Partial<StoredEntry>
  if (typeof entry.key !== "string" || typeof entry.total !== "number") return null
  return entry as StoredEntry
}

const safeParse = ({ text }: { text: string }): unknown => {
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

/**
 * Records one review and returns the page's standing afterwards.
 *
 * Returns null when the board is switched off, so a caller can treat the
 * feature as optional without branching on configuration itself.
 */
export const recordReview = async ({
  record,
}: {
  record: ReviewRecord
}): Promise<BoardEntry | null> => {
  const redis = getClient()
  if (!redis) return null

  const key = normaliseUrl({ url: record.url })
  if (!key) return null

  const previous = parseStored({ raw: await redis.hget(ENTRIES_KEY, key) })
  const reviews = (previous?.reviews ?? 0) + 1
  const total = (previous?.total ?? 0) + record.score
  const score = Math.round((total / reviews) * 10) / 10

  const stored: StoredEntry = {
    key,
    url: clean({ text: record.url, max: MAX_URL }),
    title: clean({ text: record.title, max: MAX_TITLE }),
    score,
    total,
    reviews,
    band: record.band,
    screenKind: record.screenKind,
    fixFirst: record.fixFirst,
    elementCount: record.elementCount,
    reviewedAt: record.now,
  }

  await redis.hset(ENTRIES_KEY, { [key]: JSON.stringify(stored) })
  await redis.zadd(BOARD_KEY, { score, member: key })

  // Keep the head of the board and drop the tail. zremrangebyrank counts from
  // the lowest score, so this removes the weakest entries beyond the cap.
  const size = await redis.zcard(BOARD_KEY)
  if (size > MAX_ENTRIES) {
    await redis.zremrangebyrank(BOARD_KEY, 0, size - MAX_ENTRIES - 1)
  }

  const { total: _total, ...entry } = stored
  return entry
}

/**
 * The highest scoring pages, best first.
 *
 * Two round trips rather than one per entry: the sorted set gives the order,
 * then a single field read fetches all of their detail.
 */
export const topEntries = async ({ limit = 20 }: { limit?: number } = {}): Promise<BoardEntry[]> => {
  const redis = getClient()
  if (!redis) return []

  const keys = await redis.zrange(BOARD_KEY, 0, Math.max(0, limit - 1), { rev: true })
  if (keys.length === 0) return []

  const raw = await redis.hmget(ENTRIES_KEY, ...keys)
  if (!raw) return []

  return keys
    .map((key) => parseStored({ raw: raw[key] }))
    .filter((entry): entry is StoredEntry => entry !== null)
    .map(({ total: _total, ...entry }) => entry)
}
