import { describe, expect, it } from "vitest"

import { buildQuestions, QUESTION_META, QUESTION_ORDER } from "./rubric"

describe("buildQuestions", () => {
  it("asks every kind of question, not only scores", () => {
    const kinds = Object.values(buildQuestions()).map((question) => question.type)
    expect(new Set(kinds)).toEqual(new Set(["choice", "score", "noul"]))
  })

  it("leaves out the brief question when there is no brief to judge against", () => {
    // Asking it anyway returns a probability that reads like an answer.
    expect(buildQuestions()).not.toHaveProperty("brief_delivered")
    expect(buildQuestions({ hasBrief: false })).not.toHaveProperty("brief_delivered")
  })

  it("adds the brief question when a brief was supplied", () => {
    expect(buildQuestions({ hasBrief: true })).toHaveProperty("brief_delivered")
  })

  it("gives every question a label and a section", () => {
    const missing = Object.keys(buildQuestions({ hasBrief: true })).filter(
      (id) => QUESTION_META[id] === undefined,
    )
    expect(missing).toEqual([])
  })

  it("orders every question, so a report needs no sorting", () => {
    const ids = Object.keys(buildQuestions({ hasBrief: true }))
    const unordered = ids.filter((id) => !QUESTION_ORDER.includes(id))
    expect(unordered).toEqual([])
  })

  it("keeps every score inside the 2 to 10 levels the endpoint accepts", () => {
    Object.values(buildQuestions({ hasBrief: true }))
      .filter((question) => question.type === "score")
      .forEach((question) => {
        expect(question.criteria.length).toBeGreaterThanOrEqual(2)
        expect(question.criteria.length).toBeLessThanOrEqual(10)
      })
  })

  it("phrases every instruction positively, since negations read literally", () => {
    const negated = Object.entries(buildQuestions({ hasBrief: true })).filter(([, question]) =>
      /\b(not|never|without|no longer|isn't|doesn't|lacks)\b/i.test(String(question.instructions)),
    )
    expect(negated.map(([id]) => id)).toEqual([])
  })
})
