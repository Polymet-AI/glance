"use client"

import { useCallback, useRef, useState } from "react"

import { Leaderboard } from "./leaderboard"
import { ProgressModal } from "./progress-modal"
import { ReviewReport } from "./review-report"
import type { ReviewResult } from "./review-report"
import type { BoardEntry } from "@/lib/leaderboard"

const EXAMPLES = ["stripe.com", "linear.app", "news.ycombinator.com", "vercel.com"]

type StreamEvent = {
  stage: string
  steps?: string[]
  url?: string
  image?: string
  title?: string
  elementCount?: number
  truncated?: boolean
  questionCount?: number
  error?: string
  result?: ReviewResult
  pageImage?: string
  pageWidth?: number
  pageHeight?: number
}

/** Reads `data:` lines out of a text/event-stream body. */
const readEvents = async function* ({
  body,
}: {
  body: ReadableStream<Uint8Array>
}): AsyncGenerator<StreamEvent> {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buffer = ""

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })

      const chunks = buffer.split("\n\n")
      // The last piece may be a partial event, so it stays in the buffer.
      buffer = chunks.pop() ?? ""

      for (const chunk of chunks) {
        const line = chunk.split("\n").find((candidate) => candidate.startsWith("data: "))
        if (!line) continue
        yield JSON.parse(line.slice(6)) as StreamEvent
      }
    }
  } finally {
    reader.releaseLock()
  }
}

export const ReviewForm = ({
  boardEnabled,
  initialBoard,
}: {
  /** Without a database there is no board, so there is nothing to ask about. */
  boardEnabled: boolean
  initialBoard: BoardEntry[]
}) => {
  const [url, setUrl] = useState("")
  const [running, setRunning] = useState(false)
  const [step, setStep] = useState<string | null>(null)
  // Named by the server, because only it knows which browser is doing the work.
  const [steps, setSteps] = useState<string[]>([])
  const [detail, setDetail] = useState<string | null>(null)
  const [shot, setShot] = useState<string | null>(null)
  const [pageShot, setPageShot] = useState<{
    image: string
    width: number
    height: number
  } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<ReviewResult | null>(null)
  // Bumped when a review lands, which is the only moment the board changes.
  const [boardVersion, setBoardVersion] = useState(0)
  const [boardKey, setBoardKey] = useState<string | null>(null)
  // Whether this review gets published. Asked before the review rather than
  // after, because there is no taking a URL back off a public board.
  const [share, setShare] = useState(true)
  const abortRef = useRef<AbortController | null>(null)
  // Read inside the stream loop, where state would still be the old value.
  const pageShotRef = useRef<{ image: string; width: number; height: number } | null>(null)

  const close = useCallback(() => {
    abortRef.current?.abort()
    setRunning(false)
    setStep(null)
    setError(null)
  }, [])

  const run = async ({ target, publish }: { target: string; publish: boolean }) => {
    const trimmed = target.trim()
    if (!trimmed || running) return

    const controller = new AbortController()
    abortRef.current = controller
    pageShotRef.current = null

    setRunning(true)
    setStep("checking")
    // Cleared rather than kept: the previous run's list may not describe this
    // one, and the server names the new one before anything else happens.
    setSteps([])
    setDetail(null)
    setShot(null)
    setPageShot(null)
    setError(null)
    setResult(null)

    try {
      const response = await fetch("/api/review", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          url: /^https?:\/\//.test(trimmed) ? trimmed : `https://${trimmed}`,
          publish,
        }),
        signal: controller.signal,
      })

      // A validation failure answers as plain JSON rather than a stream.
      if (!response.ok || !response.body) {
        const body = (await response.json().catch(() => ({}))) as { error?: string }
        setError(body.error ?? "That page could not be reviewed.")
        return
      }

      for await (const event of readEvents({ body: response.body })) {
        if (event.stage === "failed") {
          setError(event.error ?? "That page could not be reviewed.")
          return
        }
        // Not a step itself, just the list of the ones to come.
        if (event.stage === "steps" && event.steps) {
          setSteps(event.steps)
          continue
        }
        // The page result arrives first and the components stream in behind
        // it, so the report is readable while they are still landing.
        if (event.stage === "done" && event.result) {
          // The page capture came down with the mapping stage rather than
          // riding along here a second time; it is the largest thing on the
          // stream and sending it twice would double that.
          setResult(
            pageShotRef.current
              ? { ...event.result, pageImage: pageShotRef.current.image }
              : event.result,
          )
          // A review that was not published changed nothing, so the board is
          // left alone rather than re-read for the same rows.
          if (event.result.board) {
            setBoardKey(event.result.board.key)
            setBoardVersion((version) => version + 1)
          }
          setRunning(false)
          setStep(null)
          continue
        }

        setStep(event.stage)
        if (event.stage === "loading" && event.url) setDetail(event.url)
        if ((event.stage === "glimpse" || event.stage === "captured") && event.image) {
          setShot(event.image)
          if (event.title) setDetail(event.title)
        }
        if (event.stage === "mapping" && event.pageImage && event.pageWidth && event.pageHeight) {
          const captured = {
            image: event.pageImage,
            width: event.pageWidth,
            height: event.pageHeight,
          }
          pageShotRef.current = captured
          setPageShot(captured)
        }
        if (event.stage === "asking") {
          setDetail(
            `${event.elementCount} elements${event.truncated ? " (capped)" : ""}, ${event.questionCount} questions in one request`,
          )
        }
      }
    } catch (failure) {
      if (failure instanceof DOMException && failure.name === "AbortError") return
      setError("The request failed. Is the server still running?")
    } finally {
      abortRef.current = null
    }
  }

  return (
    <>
      <form
        onSubmit={(event) => {
          event.preventDefault()
          void run({ target: url, publish: share })
        }}
      >
        <input
          type="text"
          value={url}
          onChange={(event) => setUrl(event.target.value)}
          placeholder="stripe.com"
          aria-label="Address of the page to review"
          spellCheck={false}
          autoComplete="off"
        />
        <button type="submit" disabled={running}>
          {running ? "Reviewing…" : "Review"}
        </button>
      </form>

      <div className="examples">
        <span>Try</span>
        {EXAMPLES.map((example) => (
          <button
            key={example}
            type="button"
            className="chip"
            disabled={running}
            onClick={() => {
              setUrl(example)
              void run({ target: example, publish: share })
            }}
          >
            {example}
          </button>
        ))}
      </div>

      {boardEnabled ? (
        <label className="publish">
          <input
            type="checkbox"
            checked={share}
            disabled={running}
            onChange={(event) => setShare(event.target.checked)}
          />
          <span>
            Add this score to the public leaderboard
            <span className="publish-note">
              The address and its score become visible to everyone. Leave it off for anything not
              already public, like a staging or preview URL.
            </span>
          </span>
        </label>
      ) : null}

      {error && !running ? <p className="error">{error}</p> : null}

      {/*
        Opened as soon as a review starts, with or without a capture to show.
        A hosted browser returns nothing until the whole render is finished, so
        waiting for an image left the page looking untouched for half a minute.
      */}
      {running || (error && step) ? (
        <ProgressModal
          steps={steps}
          currentStep={step}
          detail={detail}
          image={shot}
          pageImage={pageShot?.image ?? null}
          pageWidth={pageShot?.width ?? null}
          pageHeight={pageShot?.height ?? null}
          error={error}
          onClose={close}
        />
      ) : null}

      {result ? <ReviewReport result={result} /> : null}

      <Leaderboard
        enabled={boardEnabled}
        initialEntries={initialBoard}
        version={boardVersion}
        highlightKey={boardKey}
      />
    </>
  )
}
