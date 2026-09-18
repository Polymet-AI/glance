import { ReviewForm } from "@/components/review-form"
import { isLeaderboardEnabled, topEntries } from "@/lib/leaderboard"
import type { BoardEntry } from "@/lib/leaderboard"

/**
 * The board is read here so it arrives with the page rather than a moment
 * after it, which costs the landing page its static render.
 *
 * It cannot be cached anyway: the database client sends every command with
 * `no-store`, correctly, since a cached read would hand a stale total to the
 * next review and quietly corrupt the running mean. Saying so here beats
 * leaving a future reader to work out why a `revalidate` had no effect.
 */
export const dynamic = "force-dynamic"

/** A board that will not load costs the reader nothing but the board itself. */
const readBoard = async (): Promise<BoardEntry[]> => {
  if (!isLeaderboardEnabled()) return []
  try {
    return await topEntries()
  } catch (error) {
    console.error("leaderboard read failed", error instanceof Error ? error.message : error)
    return []
  }
}

const Page = async () => (
  <main className="shell">
    <p className="eyebrow">glance</p>
    <h1>Review any page</h1>
    <p className="lede">
      Give a URL. It renders in a real browser, the design is read out as structure, and twenty-one
      questions are answered in one request in about a tenth of a second. Every answer carries the
      probability behind it.
    </p>
    <ReviewForm boardEnabled={isLeaderboardEnabled()} initialBoard={await readBoard()} />
  </main>
)

export default Page
