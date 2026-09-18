import { describe, expect, it } from "vitest"

import { choice, MAX_CHOICE_OPTIONS, noul, score } from "./questions"

describe("noul", () => {
  it("builds a question with no criteria when none is given", () => {
    expect(noul({ instructions: "The page states its price." })).toEqual({
      type: "noul",
      instructions: "The page states its price.",
    })
  })

  it("carries both outcomes when criteria is given", () => {
    const question = noul({
      instructions: "The palette is committed.",
      criteria: { true: "One dominant tone", false: "Evenly spread tones" },
    })
    expect(question.criteria).toEqual({ true: "One dominant tone", false: "Evenly spread tones" })
  })
})

describe("choice", () => {
  it("keeps the option map as given", () => {
    const question = choice({
      instructions: "Pick the screen kind.",
      criteria: { pricing: "Tiers and prices", auth: "A sign-in form" },
    })
    expect(question).toEqual({
      type: "choice",
      instructions: "Pick the screen kind.",
      criteria: { pricing: "Tiers and prices", auth: "A sign-in form" },
    })
  })

  it("rejects an empty option map", () => {
    expect(() => choice({ instructions: "Pick one.", criteria: {} })).toThrow(
      "A choice question needs at least one option.",
    )
  })

  it(`rejects more than ${MAX_CHOICE_OPTIONS} options`, () => {
    const criteria = Object.fromEntries(
      Array.from({ length: MAX_CHOICE_OPTIONS + 1 }, (_, index) => [`option${index}`, "x"]),
    )
    expect(() => choice({ instructions: "Pick one.", criteria })).toThrow(
      `A choice question accepts at most ${MAX_CHOICE_OPTIONS} options, received ${MAX_CHOICE_OPTIONS + 1}.`,
    )
  })
})

describe("score", () => {
  it("puts the levels on criteria in order", () => {
    const question = score({ instructions: "Rate the finish.", levels: ["Raw", "Draft", "Shipped"] })
    expect(question).toEqual({
      type: "score",
      instructions: "Rate the finish.",
      criteria: ["Raw", "Draft", "Shipped"],
    })
  })

  const outOfRange = [
    { levels: ["Only one"], label: "one level" },
    { levels: Array.from({ length: 11 }, (_, index) => `Level ${index}`), label: "eleven levels" },
  ]

  outOfRange.forEach(({ levels, label }) => {
    it(`rejects ${label}`, () => {
      expect(() => score({ instructions: "Rate it.", levels })).toThrow(
        `A score question takes 2 to 10 levels, received ${levels.length}.`,
      )
    })
  })
})
