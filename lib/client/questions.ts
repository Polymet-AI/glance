import type { ChoiceQuestion, NoulQuestion, Rubric, ScoreQuestion } from "./types"

/**
 * Builders for the three question types.
 *
 * They exist to make a malformed question a compile error rather than a 422
 * from the API, and to keep the level count of a score inside the range the
 * endpoint accepts.
 */

export const MIN_SCORE_LEVELS = 2
export const MAX_SCORE_LEVELS = 10
export const MAX_CHOICE_OPTIONS = 255

/**
 * A yes/no question. The answer is a probability, not a boolean, so the
 * caller picks its own threshold.
 *
 * State the instruction positively. The model reads negations literally, so
 * "the page loads without errors" and "the page loads with no errors" do not
 * mean the same thing to it as they do to you.
 */
export const noul = ({
  instructions,
  criteria,
}: {
  instructions: Rubric
  criteria?: { true: Rubric; false: Rubric }
}): NoulQuestion => (criteria ? { type: "noul", instructions, criteria } : { type: "noul", instructions })

/**
 * Pick one of a named set of options.
 *
 * Every option carries a description: the names alone are not enough for the
 * model to tell two neighbouring options apart.
 */
export const choice = ({
  instructions,
  criteria,
}: {
  instructions: Rubric
  criteria: Record<string, Rubric>
}): ChoiceQuestion => {
  const optionCount = Object.keys(criteria).length
  if (optionCount < 1) {
    throw new Error("A choice question needs at least one option.")
  }
  if (optionCount > MAX_CHOICE_OPTIONS) {
    throw new Error(
      `A choice question accepts at most ${MAX_CHOICE_OPTIONS} options, received ${optionCount}.`,
    )
  }
  return { type: "choice", instructions, criteria }
}

/**
 * Rate against an ordered scale. Array position is the score index, so the
 * levels run from worst to best and each one describes a state a reader could
 * recognise.
 */
export const score = ({
  instructions,
  levels,
}: {
  instructions: Rubric
  levels: readonly string[]
}): ScoreQuestion => {
  if (levels.length < MIN_SCORE_LEVELS || levels.length > MAX_SCORE_LEVELS) {
    throw new Error(
      `A score question takes ${MIN_SCORE_LEVELS} to ${MAX_SCORE_LEVELS} levels, received ${levels.length}.`,
    )
  }
  return { type: "score", instructions, criteria: levels }
}
