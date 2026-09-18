import { createGlanceClient } from "@/lib/client"
import type { Answer, GlanceClient, GlanceClientOptions } from "@/lib/client"

import { computeFindings } from "./metrics"
import {
  buildQuestions,
  buildSectionQuestions,
  FIX_FIRST_QUESTION,
  QUESTION_META,
  QUESTION_ORDER,
  SCREEN_KIND_QUESTION,
  SECTION_FIX_QUESTION,
  SECTION_KIND_QUESTION,
  SECTION_QUESTION_META,
  SECTION_SCORE_IDS,
  STRONGEST_QUESTION,
} from "./rubric"
import type {
  DesignChoice,
  DesignFlag,
  DesignOverall,
  DesignReview,
  DesignScore,
  DesignSection,
  DesignSnapshot,
  SectionReview,
} from "./types"

const metaFor = ({ id }: { id: string }) =>
  QUESTION_META[id] ?? { label: id, section: "craft" as const }

const readChoiceName = ({ answer }: { answer: Answer | undefined }): string =>
  answer?.type === "choice" ? answer.choice : "unknown"

const toChoice = ({ id, answer }: { id: string; answer: Answer | undefined }): DesignChoice | null => {
  if (answer?.type !== "choice") return null
  const meta = metaFor({ id })
  return {
    id,
    label: meta.label,
    section: meta.section,
    ...(meta.note ? { note: meta.note } : {}),
    choice: answer.choice,
    confidence: answer.confidence,
    distribution: Object.entries(answer.probabilities)
      .map(([option, probability]) => ({ option, probability }))
      .sort((a, b) => b.probability - a.probability),
  }
}

const toScore = ({ id, answer }: { id: string; answer: Answer | undefined }): DesignScore | null => {
  if (answer?.type !== "score") return null
  // The legend is keyed by the level index as a string, not an array.
  const keys = Object.keys(answer.legend).sort((a, b) => Number(a) - Number(b))
  const levels = keys.length
  const nearest = Math.min(levels - 1, Math.max(0, Math.round(answer.score)))
  const meta = metaFor({ id })

  return {
    id,
    label: meta.label,
    section: meta.section,
    ...(meta.note ? { note: meta.note } : {}),
    value: answer.score,
    levels,
    summary: answer.legend[String(nearest)] ?? "",
    distribution: keys.map((key) => ({
      label: answer.legend[key] ?? key,
      probability: answer.probabilities[key] ?? 0,
    })),
    confidence: answer.confidence,
  }
}

const toFlag = ({ id, answer }: { id: string; answer: Answer | undefined }): DesignFlag | null => {
  if (answer?.type !== "noul") return null
  const meta = metaFor({ id })
  return {
    id,
    label: meta.label,
    section: meta.section,
    ...(meta.note ? { note: meta.note } : {}),
    probability: answer.noul,
  }
}

const exists = <T,>(value: T | null): value is T => value !== null

/** Bands for the overall value, low to high. Each is `[floor, word]`. */
const BANDS: readonly (readonly [number, string])[] = [
  [0, "Wireframe"],
  [20, "Draft"],
  [40, "Competent"],
  [60, "Designed"],
  [80, "Distinctive"],
]

const bandFor = ({ value }: { value: number }): string => {
  let word = BANDS[0]?.[1] ?? ""
  for (const [floor, candidate] of BANDS) {
    if (value >= floor) word = candidate
  }
  return word
}

/**
 * Folds the craft dimensions into one number.
 *
 * Each is normalised to its own scale before averaging, since the rubrics run
 * to different lengths and a raw mean would let a four-level dimension outvote
 * a five-level one.
 */
const toOverall = ({ scores }: { scores: readonly DesignScore[] }): DesignOverall | null => {
  const craft = scores.filter((score) => score.section === "craft")
  if (craft.length === 0) return null

  const normalised =
    craft.reduce((total, score) => total + score.value / Math.max(1, score.levels - 1), 0) /
    craft.length
  const value = Math.round(normalised * 1000) / 10
  const confidence =
    craft.reduce((total, score) => total + score.confidence, 0) / craft.length

  return {
    value,
    dimensions: craft.length,
    confidence: Math.round(confidence * 100) / 100,
    band: bandFor({ value }),
  }
}

/**
 * Turns a set of answers into a report.
 *
 * Split out so a caller that runs the request itself, a streaming route for
 * instance, can reuse the mapping instead of restating it.
 */
export const buildReview = ({
  snapshot,
  answers,
  usage,
}: {
  snapshot: DesignSnapshot
  answers: Record<string, Answer>
  usage: { input_tokens: number; output_tokens: number }
}): DesignReview => {
  const scores = QUESTION_ORDER.map((id) => toScore({ id, answer: answers[id] })).filter(exists)

  return {
    overall: toOverall({ scores }),
    scores,
    screenKind: readChoiceName({ answer: answers[SCREEN_KIND_QUESTION] }),
    fixFirst: readChoiceName({ answer: answers[FIX_FIRST_QUESTION] }),
    strongest: readChoiceName({ answer: answers[STRONGEST_QUESTION] }),
    choices: QUESTION_ORDER.map((id) => toChoice({ id, answer: answers[id] })).filter(exists),
    flags: QUESTION_ORDER.map((id) => toFlag({ id, answer: answers[id] })).filter(exists),
    findings: computeFindings({ snapshot }),
    usage: { inputTokens: usage.input_tokens, outputTokens: usage.output_tokens },
  }
}

/**
 * Reviews one rendered screen.
 *
 * Two halves, deliberately kept apart. The findings are computed here, exactly
 * and offline, and are the only part of the report that can explain itself.
 * The scores, flags and choices come from the model, which returns a value and
 * a probability but never a reason.
 *
 * Every question goes in one request, so the whole review is a single round
 * trip of roughly a tenth of a second rather than two dozen.
 */
export const reviewDesign = async ({
  snapshot,
  client,
  clientOptions,
}: {
  snapshot: DesignSnapshot
  /** Reuse a client across reviews. Built from `clientOptions` when absent. */
  client?: GlanceClient
  clientOptions?: GlanceClientOptions
}): Promise<DesignReview> => {
  const glance = client ?? createGlanceClient(clientOptions ?? {})
  const questions = buildQuestions({ hasBrief: Boolean(snapshot.brief) })
  const response = await glance.ask({ state: snapshot, questions })

  return buildReview({ snapshot, answers: response.answers, usage: response.usage })
}

/** Builds one component's review from its answers. */
export const buildSectionReview = ({
  section,
  answers,
}: {
  section: DesignSection
  answers: Record<string, Answer>
}): SectionReview => {
  const meta = ({ id }: { id: string }) =>
    SECTION_QUESTION_META[id] ?? { label: id, section: "craft" as const }

  const scores = SECTION_SCORE_IDS.map((id) => {
    const built = toScore({ id, answer: answers[id] })
    return built ? { ...built, label: meta({ id }).label, section: meta({ id }).section } : null
  }).filter(exists)

  const purpose = toFlag({ id: "purpose_clear", answer: answers["purpose_clear"] })
  const kindAnswer = answers[SECTION_KIND_QUESTION]

  return {
    id: section.id,
    label: section.label,
    tag: section.tag,
    box: section.box,
    elementCount: section.snapshot.elements.length,
    kind: readChoiceName({ answer: kindAnswer }),
    kindConfidence: kindAnswer?.type === "choice" ? kindAnswer.confidence : 0,
    fixFirst: readChoiceName({ answer: answers[SECTION_FIX_QUESTION] }),
    scores,
    flags: purpose
      ? [{ ...purpose, label: meta({ id: "purpose_clear" }).label, section: "signals" }]
      : [],
    overall: toOverall({ scores }),
  }
}

/**
 * Reviews every component of a page, each as its own request.
 *
 * They go out together rather than in turn. Each is its own state, so they
 * cannot share a call, but nothing makes them wait for each other either:
 * eight components is eight requests landing in about the time one takes.
 *
 * A component whose request fails is dropped rather than failing the page. One
 * unreachable footer should not cost the other seven.
 */
export const reviewSections = async ({
  sections,
  client,
  clientOptions,
  onSection,
}: {
  sections: readonly DesignSection[]
  client?: GlanceClient
  clientOptions?: GlanceClientOptions
  /** Called as each component lands, so a caller can stream them. */
  onSection?: (review: SectionReview) => void
}): Promise<SectionReview[]> => {
  const glance = client ?? createGlanceClient(clientOptions ?? {})
  const questions = buildSectionQuestions()

  const settled = await Promise.allSettled(
    sections.map(async (section) => {
      const response = await glance.ask({ state: section.snapshot, questions })
      const review = buildSectionReview({ section, answers: response.answers })
      onSection?.(review)
      return review
    }),
  )

  return settled
    .map((result) => (result.status === "fulfilled" ? result.value : null))
    .filter(exists)
}
