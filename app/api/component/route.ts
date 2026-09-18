import { createGlanceClient, GlanceError } from "@/lib/client"
import { buildSectionQuestions, buildSectionReview } from "@/lib/review"
import type { DesignSection } from "@/lib/review"

/**
 * Re-reviews one component, on demand.
 *
 * The point of this route is the timing it reports. The page review shows a
 * finished number; this shows how long the model actually took, separately
 * from the network around it, because a blended figure hides the thing worth
 * seeing.
 */
export const runtime = "nodejs"
export const maxDuration = 30

/** The client hands back a snapshot it was given, so it is bounded here. */
const MAX_ELEMENTS = 400
const MAX_LABEL = 120

const jsonError = ({ message, status }: { message: string; status: number }): Response =>
  new Response(JSON.stringify({ error: message }), {
    status,
    headers: { "Content-Type": "application/json" },
  })

type Body = { section?: unknown }

const readSection = ({ body }: { body: Body }): DesignSection => {
  const section = body.section
  if (typeof section !== "object" || section === null) {
    throw new Error("Send a section.")
  }

  const candidate = section as Partial<DesignSection>
  const snapshot = candidate.snapshot

  if (
    typeof snapshot !== "object" ||
    snapshot === null ||
    !Array.isArray(snapshot.elements) ||
    typeof snapshot.viewport !== "object"
  ) {
    throw new Error("That section carries no usable snapshot.")
  }

  // Anything the browser sends is attacker-controlled, and this route spends a
  // paid API call, so the size of what reaches the model is capped here rather
  // than trusted.
  if (snapshot.elements.length === 0) {
    throw new Error("That section is empty.")
  }
  if (snapshot.elements.length > MAX_ELEMENTS) {
    throw new Error("That section is too large to review.")
  }

  return {
    id: String(candidate.id ?? "section").slice(0, 64),
    label: String(candidate.label ?? "").slice(0, MAX_LABEL),
    tag: String(candidate.tag ?? "div").slice(0, 32),
    box: Array.isArray(candidate.box) && candidate.box.length === 4
      ? (candidate.box.map(Number) as unknown as DesignSection["box"])
      : [0, 0, 0, 0],
    snapshot: {
      viewport: snapshot.viewport,
      ...(snapshot.theme ? { theme: snapshot.theme } : {}),
      elements: snapshot.elements.slice(0, MAX_ELEMENTS),
    },
  }
}

export const POST = async (request: Request): Promise<Response> => {
  let section: DesignSection
  try {
    section = readSection({ body: (await request.json()) as Body })
  } catch (error) {
    return jsonError({
      message: error instanceof Error ? error.message : "Send a section.",
      status: 400,
    })
  }

  if (!process.env["TYPESAFE_API_KEY"]) {
    return jsonError({ message: "The server has no TYPESAFE_API_KEY set.", status: 500 })
  }

  try {
    const questions = buildSectionQuestions()
    const glance = createGlanceClient()

    // Timed around the model call alone. Everything outside it is network, and
    // blending the two would attribute our own latency to the model.
    const started = Date.now()
    const response = await glance.ask({ state: section.snapshot, questions })
    const modelMs = Date.now() - started

    return Response.json({
      review: buildSectionReview({ section, answers: response.answers }),
      modelMs,
      questionCount: Object.keys(questions).length,
      inputTokens: response.usage.input_tokens,
    })
  } catch (error) {
    if (error instanceof GlanceError) {
      console.error("component review failed", { status: error.status, body: error.body })
      return jsonError({ message: "The review service did not answer.", status: 502 })
    }
    console.error("component review failed", error instanceof Error ? error.message : error)
    return jsonError({ message: "That component could not be reviewed.", status: 502 })
  }
}
