import { isLeaderboardEnabled, topEntries } from "@/lib/leaderboard"

/** Reads a database over HTTP, so it never runs on the edge runtime. */
export const runtime = "nodejs"

const MAX_LIMIT = 50
const DEFAULT_LIMIT = 20

/**
 * The board, best first.
 *
 * Read-only by design. Entries are written by the review route after it has
 * run a review itself, so there is no way to put a score here from outside.
 *
 * With no database configured this answers `enabled: false` rather than
 * failing, which lets the page hide the section instead of showing an error to
 * someone who has simply not set it up.
 */
export const GET = async (request: Request): Promise<Response> => {
  if (!isLeaderboardEnabled()) {
    return Response.json({ enabled: false, entries: [] })
  }

  const asked = Number(new URL(request.url).searchParams.get("limit") ?? DEFAULT_LIMIT)
  const limit = Number.isFinite(asked)
    ? Math.min(MAX_LIMIT, Math.max(1, Math.trunc(asked)))
    : DEFAULT_LIMIT

  try {
    return Response.json({ enabled: true, entries: await topEntries({ limit }) })
  } catch (error) {
    // The vendor's message stays in the log; the page gets a plain sentence.
    console.error("leaderboard read failed", error instanceof Error ? error.message : error)
    return Response.json({ enabled: true, entries: [], error: "The board is unavailable." })
  }
}
