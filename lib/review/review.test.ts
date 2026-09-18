import { describe, expect, it, vi } from "vitest"

import { reviewDesign } from "./review"
import type { DesignSnapshot } from "./types"

/**
 * The answers below are copied from a live response, not from the published
 * schema. The two disagree on one point that matters: a score's `legend` and
 * `probabilities` come back keyed by the level index as a string, not as
 * arrays. Reading them as arrays yields a level count of `undefined` and an
 * empty summary, which is what these cases pin.
 */
const liveAnswers = {
  screen_kind: {
    type: "choice",
    choice: "pricing",
    confidence: 1,
    probabilities: { pricing: 1, auth: 0 },
  },
  fix_first: {
    type: "choice",
    choice: "typography",
    confidence: 0.64,
    probabilities: { typography: 0.64, colour: 0.2, hierarchy: 0.16 },
  },
  finish: {
    type: "score",
    score: 0.48,
    confidence: 0.6,
    legend: {
      "0": "Raw wireframe",
      "1": "Early draft",
      "2": "Competent template",
      "3": "Deliberately designed",
      "4": "Polished and distinctive",
    },
    probabilities: { "0": 0.53, "1": 0.45, "2": 0.01, "3": 0.01, "4": 0 },
  },
  primary_action_obvious: { type: "noul", noul: 0.15 },
}

const SNAPSHOT: DesignSnapshot = {
  viewport: { w: 1440, h: 900 },
  elements: [{ tag: "h1", text: "Pricing", box: [0, 0, 300, 44], fg: "#000000", font: "Inter 36/700" }],
}

const clientReturning = ({ answers }: { answers: Record<string, unknown> }) => ({
  ask: vi.fn().mockResolvedValue({
    model: "jev-1.13.0",
    answers,
    usage: { input_tokens: 438, output_tokens: 63 },
  }),
})

describe("reviewDesign", () => {
  it("reads the level count and summary from an index-keyed legend", async () => {
    const client = clientReturning({ answers: liveAnswers })
    const review = await reviewDesign({ snapshot: SNAPSHOT, client })

    const finish = review.scores.find((score) => score.id === "finish")
    expect(finish).toMatchObject({
      id: "finish",
      label: "Finish",
      section: "craft",
      value: 0.48,
      levels: 5,
      summary: "Raw wireframe",
      confidence: 0.6,
    })
    expect(finish?.distribution).toEqual([
      { label: "Raw wireframe", probability: 0.53 },
      { label: "Early draft", probability: 0.45 },
      { label: "Competent template", probability: 0.01 },
      { label: "Deliberately designed", probability: 0.01 },
      { label: "Polished and distinctive", probability: 0 },
    ])
  })

  it("rounds to the nearest level for the summary", async () => {
    const answers = {
      ...liveAnswers,
      finish: { ...liveAnswers.finish, score: 3.7 },
    }
    const review = await reviewDesign({ snapshot: SNAPSHOT, client: clientReturning({ answers }) })

    expect(review.scores.find((score) => score.id === "finish")?.summary).toBe(
      "Polished and distinctive",
    )
  })

  it("carries the choices and flags through", async () => {
    const review = await reviewDesign({
      snapshot: SNAPSHOT,
      client: clientReturning({ answers: liveAnswers }),
    })

    expect(review.screenKind).toBe("pricing")
    expect(review.fixFirst).toBe("typography")
    expect(review.flags).toContainEqual({
      id: "primary_action_obvious",
      label: "Primary action is obvious",
      section: "signals",
      probability: 0.15,
    })

    // The full spread is kept, not just the winner: a pick at 0.94 and a pick
    // at 0.34 read identically once the runners-up are discarded.
    const fixFirst = review.choices.find((choice) => choice.id === "fix_first")
    expect(fixFirst?.distribution).toEqual([
      { option: "typography", probability: 0.64 },
      { option: "colour", probability: 0.2 },
      { option: "hierarchy", probability: 0.16 },
    ])
  })

  it("computes the findings itself rather than reading them from the answer", async () => {
    const snapshot: DesignSnapshot = {
      viewport: { w: 1440, h: 900 },
      theme: { bg: "#0B0D12" },
      elements: [
        { tag: "div", box: [0, 0, 400, 200], bg: "#12151E", container: true },
        { tag: "p", text: "Muted copy", box: [10, 10, 300, 20], fg: "#6B7080", font: "Inter 14/400" },
      ],
    }

    const review = await reviewDesign({ snapshot, client: clientReturning({ answers: liveAnswers }) })
    expect(review.findings.filter((finding) => finding.kind === "contrast")).toHaveLength(1)
  })

  it("skips a dimension the model did not answer instead of inventing one", async () => {
    const review = await reviewDesign({
      snapshot: SNAPSHOT,
      client: clientReturning({ answers: { screen_kind: liveAnswers.screen_kind } }),
    })

    expect(review.scores).toEqual([])
    expect(review.flags).toEqual([])
    expect(review.fixFirst).toBe("unknown")
  })

  it("reports the usage the endpoint returned", async () => {
    const review = await reviewDesign({
      snapshot: SNAPSHOT,
      client: clientReturning({ answers: liveAnswers }),
    })

    expect(review.usage).toEqual({ inputTokens: 438, outputTokens: 63 })
  })
})

describe("overall", () => {
  const scoreAnswer = ({ value, levels }: { value: number; levels: number }) => ({
    type: "score",
    score: value,
    confidence: 0.5,
    legend: Object.fromEntries(Array.from({ length: levels }, (_, i) => [String(i), `level ${i}`])),
    probabilities: Object.fromEntries(Array.from({ length: levels }, (_, i) => [String(i), 1 / levels])),
  })

  it("normalises each dimension to its own scale before averaging", async () => {
    // A 4-level dimension at its top and a 5-level one at its top are both
    // 100%. A raw mean would read 3 and 4 and let the longer scale dominate.
    const review = await reviewDesign({
      snapshot: SNAPSHOT,
      client: clientReturning({
        answers: {
          coherence: scoreAnswer({ value: 3, levels: 4 }),
          finish: scoreAnswer({ value: 4, levels: 5 }),
        },
      }),
    })

    expect(review.overall?.value).toBe(100)
    expect(review.overall?.dimensions).toBe(2)
  })

  it("reports the mean confidence rather than folding it into the value", async () => {
    const review = await reviewDesign({
      snapshot: SNAPSHOT,
      client: clientReturning({
        answers: {
          finish: { ...scoreAnswer({ value: 2, levels: 5 }), confidence: 0.2 },
          copy: { ...scoreAnswer({ value: 2, levels: 5 }), confidence: 0.8 },
        },
      }),
    })

    expect(review.overall?.value).toBe(50)
    expect(review.overall?.confidence).toBe(0.5)
  })

  const bands = [
    { value: 0, levels: 5, band: "Wireframe" },
    { value: 1, levels: 5, band: "Draft" },
    { value: 2, levels: 5, band: "Competent" },
    { value: 3, levels: 5, band: "Designed" },
    { value: 4, levels: 5, band: "Distinctive" },
  ]

  bands.forEach(({ value, levels, band }) => {
    it(`names ${value} of ${levels - 1} as ${band}`, async () => {
      const review = await reviewDesign({
        snapshot: SNAPSHOT,
        client: clientReturning({ answers: { finish: scoreAnswer({ value, levels }) } }),
      })
      expect(review.overall?.band).toBe(band)
    })
  })

  it("leaves the yes/no signals out, since they have no shared direction", async () => {
    // A dark interface is neither good nor bad, so folding it in would move
    // the number for a reason a reader could not interpret.
    const review = await reviewDesign({
      snapshot: SNAPSHOT,
      client: clientReturning({
        answers: {
          finish: scoreAnswer({ value: 4, levels: 5 }),
          dark_interface: { type: "noul", noul: 0 },
          navigation_crowded: { type: "noul", noul: 1 },
        },
      }),
    })

    expect(review.overall?.value).toBe(100)
    expect(review.overall?.dimensions).toBe(1)
  })

  it("has no overall when nothing was scored", async () => {
    const review = await reviewDesign({
      snapshot: SNAPSHOT,
      client: clientReturning({ answers: { screen_kind: liveAnswers.screen_kind } }),
    })
    expect(review.overall).toBeNull()
  })
})
