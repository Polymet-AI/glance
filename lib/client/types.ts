/**
 * The wire types for TypeSafe's System One endpoint.
 *
 * @see https://docs.typesafe.ai/api
 */

/** Anything the endpoint accepts as a rubric: prose, a list, or structured JSON. */
export type Rubric = string | readonly unknown[] | Record<string, unknown>

/** Yes/no. Answers carry a probability between 0 and 1. */
export type NoulQuestion = {
  type: "noul"
  instructions: Rubric
  /** Optional wording for each outcome. Both sides are stated positively. */
  criteria?: { true: Rubric; false: Rubric }
}

/** Pick one of up to 255 named options. */
export type ChoiceQuestion = {
  type: "choice"
  instructions: Rubric
  /** Option name to its description. At least one option. */
  criteria: Record<string, Rubric>
}

/** Rate against an ordered scale of 2 to 10 levels. Array position is the score. */
export type ScoreQuestion = {
  type: "score"
  instructions: Rubric
  criteria: readonly Rubric[]
}

export type Question = NoulQuestion | ChoiceQuestion | ScoreQuestion

export type NoulAnswer = {
  type: "noul"
  /** Probability the statement holds, 0 to 1. */
  noul: number
}

export type ChoiceAnswer = {
  type: "choice"
  /** The selected option name. */
  choice: string
  /** Every option and its probability. */
  probabilities: Record<string, number>
  /**
   * How concentrated the distribution is. This is not the probability that
   * the answer is correct, and must never be rendered as certainty.
   */
  confidence: number
}

export type ScoreAnswer = {
  type: "score"
  /** Probability-weighted mean of the level indices. */
  score: number
  /**
   * Level index to its description, keyed by the index as a string:
   * `{ "0": "Raw wireframe", "1": "Early draft" }`. An object rather than an
   * array, which is what the endpoint actually returns.
   */
  legend: Record<string, string>
  /** Level index to its probability, keyed the same way as `legend`. */
  probabilities: Record<string, number>
  /** Distribution concentration, not correctness. */
  confidence: number
}

export type Answer = NoulAnswer | ChoiceAnswer | ScoreAnswer

export type Usage = {
  input_tokens: number
  output_tokens: number
}

export type SystemOneResponse = {
  model: string
  answers: Record<string, Answer>
  usage: Usage
}

/** What the caller sends. `state` is the thing being judged. */
export type SystemOneRequest = {
  model: string
  state: unknown
  questions: Record<string, Question>
}
