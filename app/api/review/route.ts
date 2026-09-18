import { createGlanceClient, GlanceError } from "@/lib/client"
import { buildQuestions, buildReview } from "@/lib/review"

import { recordReview } from "@/lib/leaderboard"
import type { BoardEntry } from "@/lib/leaderboard"
import { assertSafeUrl, BlockedUrlError } from "@/lib/url-guard"
import { renderPage, rendererName } from "@/lib/renderer"

/** Playwright needs a real Node process, so this route is never edge. */
export const runtime = "nodejs"
export const maxDuration = 60

const MAX_URL_LENGTH = 2_048
const MAX_BRIEF_LENGTH = 300

type ReviewRequest = { url?: unknown; brief?: unknown; publish?: unknown }

const readBody = ({
  body,
}: {
  body: ReviewRequest
}): { url: string; publish: boolean; brief?: string } => {
  if (typeof body.url !== "string" || body.url.trim().length === 0) {
    throw new BlockedUrlError({ message: "Give a URL to review." })
  }
  if (body.url.length > MAX_URL_LENGTH) {
    throw new BlockedUrlError({ message: "That URL is too long." })
  }
  const brief = typeof body.brief === "string" ? body.brief.slice(0, MAX_BRIEF_LENGTH).trim() : ""
  // Anything other than an explicit `true` keeps the review private. Publishing
  // a URL cannot be undone, so it is never the answer to a missing or
  // malformed field.
  return { url: body.url, publish: body.publish === true, ...(brief ? { brief } : {}) }
}

const jsonError = ({ message, status }: { message: string; status: number }): Response =>
  new Response(JSON.stringify({ error: message }), {
    status,
    headers: { "Content-Type": "application/json" },
  })

/**
 * Streams the review as it happens.
 *
 * A render takes a few seconds and a spinner over that is a lie by omission:
 * it hides that the page is being fetched in a real browser, which is the part
 * worth seeing. Each step is announced as it begins, and the screenshot is
 * pushed the moment it exists.
 */
export const POST = async (request: Request): Promise<Response> => {
  // The request is judged before the server's own configuration, so a bad URL
  // always gets the reason it was bad rather than a report about the server.
  let parsed: { url: string; publish: boolean; brief?: string }
  try {
    parsed = readBody({ body: (await request.json()) as ReviewRequest })
    await assertSafeUrl({ input: parsed.url })
  } catch (error) {
    const message = error instanceof BlockedUrlError ? error.message : "Send a JSON body with a url."
    return jsonError({ message, status: 400 })
  }

  if (!process.env["TYPESAFE_API_KEY"]) {
    return jsonError({ message: "The server has no TYPESAFE_API_KEY set.", status: 500 })
  }

  const encoder = new TextEncoder()

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let open = true
      const send = ({ event }: { event: Record<string, unknown> }): void => {
        if (!open) return
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`))
      }

      try {
        const { snapshot, finalUrl, title, image, pageWidth, pageHeight, flattened, sections } =
          await renderPage({
            input: parsed.url,
            ...(parsed.brief ? { brief: parsed.brief } : {}),
            onStage: (stage) => send({ event: stage }),
          })

        if (snapshot.elements.length === 0) {
          send({
            event: {
              stage: "failed",
              error: "Nothing visible was found on that page. It may need a sign-in.",
            },
          })
          return
        }

        const questions = buildQuestions({ hasBrief: Boolean(snapshot.brief) })
        send({
          event: {
            stage: "asking",
            elementCount: snapshot.elements.length,
            truncated: snapshot.truncated === true,
            questionCount: Object.keys(questions).length,
          },
        })

        const started = Date.now()
        const glance = createGlanceClient()
        const response = await glance.ask({ state: snapshot, questions })
        const elapsedMs = Date.now() - started
        const review = buildReview({ snapshot, answers: response.answers, usage: response.usage })

        // Written here, by the server that ran the review, and never accepted
        // from the browser: a score the client could post is a leaderboard
        // anyone can stuff. A board failure must not cost the reader their
        // review, so it is recorded and swallowed.
        //
        // Nothing is written unless this request asked for it. The reader is
        // asked before the review runs rather than after, because a URL on a
        // public board cannot be taken back.
        let board: BoardEntry | null = null
        if (parsed.publish && review.overall) {
          try {
            board = await recordReview({
              record: {
                url: finalUrl,
                title,
                score: review.overall.value,
                band: review.overall.band,
                screenKind: review.screenKind,
                fixFirst: review.fixFirst,
                elementCount: snapshot.elements.length,
                now: Date.now(),
              },
            })
          } catch (boardError) {
            console.error(
              "leaderboard write failed",
              boardError instanceof Error ? boardError.message : boardError,
            )
          }
        }

        // Components ride along unreviewed. Reviewing all of them costs more
        // tokens than the page itself and most readers want the overview
        // first, so the fan-out waits until someone asks for it.
        send({
          event: {
            stage: "done",
            result: {
              url: finalUrl,
              title,
              image,
              pageWidth,
              pageHeight,
              flattened,
              elementCount: snapshot.elements.length,
              truncated: snapshot.truncated === true,
              elapsedMs,
              sections,
              review,
              // Present only when the board is switched on. The page uses it to
              // point at the row this review just moved.
              ...(board ? { board } : {}),
            },
          },
        })

      } catch (error) {
        if (error instanceof BlockedUrlError) {
          send({ event: { stage: "failed", error: error.message } })
        } else if (error instanceof GlanceError) {
          // The vendor's own error text stays in the log and never reaches the page.
          console.error("model call failed", { status: error.status, body: error.body })
          send({
            event: { stage: "failed", error: "The review service did not answer. Try again in a moment." },
          })
        } else {
          // Which browser ran matters when a render fails, and the two fail in
          // different ways, so the log says which one it was.
          console.error("review failed", {
            renderer: rendererName(),
            message: error instanceof Error ? error.message : error,
          })
          send({
            event: {
              stage: "failed",
              error: "That page could not be rendered. It may be slow, blocked, or behind a sign-in.",
            },
          })
        }
      } finally {
        open = false
        controller.close()
      }
    },
  })

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  })
}
