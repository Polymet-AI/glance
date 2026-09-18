"use client"

import { useEffect, useState } from "react"

import type { BoardEntry } from "@/lib/leaderboard"

/**
 * Every page that has been reviewed here, best first.
 *
 * The rows come in with the page, rendered on the server, so the board is there
 * on arrival rather than appearing a moment later. Nothing is fetched on mount:
 * the rows are already current, and pulling them again would cost a second
 * database read for every view of the landing page. The board is pulled again
 * only when a review lands here and actually changes it.
 *
 * The board is optional. With no database configured there are no rows from
 * either source and this renders nothing at all, rather than an empty panel or
 * an error, because a contributor who has just cloned the repo has no database
 * and there is nothing for them to fix.
 *
 * A score here is the mean of every review a page has had, so it moves less the
 * more it is pressed. That is said out loud under the table, because a single
 * figure with no sample count invites the reading that it is definitive.
 */

const BAR_FLOOR = 2

type BoardResponse = { enabled: boolean; entries: BoardEntry[]; error?: string }

const Row = ({
  entry,
  rank,
  highlighted,
}: {
  entry: BoardEntry
  rank: number
  highlighted: boolean
}) => (
  <li className={highlighted ? "board-row is-mine" : "board-row"}>
    <span className="board-rank">{rank}</span>

    <span className="board-site">
      <a href={entry.url} target="_blank" rel="noreferrer noopener" className="board-name">
        {entry.title || entry.key}
      </a>
      <span className="board-key">{entry.key}</span>
    </span>

    <span className="board-band">{entry.band}</span>

    <span className="board-track" aria-hidden>
      <span className="board-fill" style={{ width: `${Math.max(BAR_FLOOR, entry.score)}%` }} />
    </span>

    <span className="board-score">{entry.score.toFixed(1)}</span>

    <span className="board-count">
      {entry.reviews} {entry.reviews === 1 ? "review" : "reviews"}
    </span>
  </li>
)

export const Leaderboard = ({
  initialEntries,
  version = 0,
  highlightKey = null,
}: {
  /** Read on the server, so the first paint already has the board in it. */
  initialEntries: BoardEntry[]
  /** Bumped by the page after a review, to pull the board again. */
  version?: number
  /** The entry this reader just moved, if any. */
  highlightKey?: string | null
}) => {
  const [entries, setEntries] = useState<BoardEntry[]>(initialEntries)

  useEffect(() => {
    // Version zero is the server's own rows, already on screen.
    if (version === 0) return

    const controller = new AbortController()

    const load = async () => {
      try {
        const response = await fetch("/api/leaderboard", { signal: controller.signal })
        if (!response.ok) return
        const board = (await response.json()) as BoardResponse
        setEntries(board.entries)
      } catch {
        // A board that will not load is not worth an error on the page; the
        // rows already on screen simply stay as they are.
      }
    }

    void load()
    return () => controller.abort()
  }, [version])

  if (entries.length === 0) return null

  return (
    <section className="section board">
      <div className="section-head">
        <h2>Leaderboard</h2>
        <p className="section-caption">
          Every page reviewed here, best first. A page&rsquo;s score is the mean of all of its
          reviews, so pressing again moves it less each time.
        </p>
      </div>

      <ol className="board-rows">
        {entries.map((entry, index) => (
          <Row
            key={entry.key}
            entry={entry}
            rank={index + 1}
            highlighted={entry.key === highlightKey}
          />
        ))}
      </ol>
    </section>
  )
}
