/**
 * One element of a rendered screen, reduced to what a design review needs.
 *
 * Deliberately smaller than a description aimed at editing code. Selectors,
 * component ancestry and serialised props say nothing about whether a design
 * is good, and the model's accuracy falls as irrelevant context grows, so
 * carrying them costs twice.
 */
export type DesignElement = {
  /** Lowercase tag name, e.g. "button". */
  tag: string
  /** Visible text, truncated by the extractor. Absent for containers. */
  text?: string
  /** `[x, y, width, height]` in CSS pixels, relative to the document. */
  box: readonly [number, number, number, number]
  /** Resolved text colour, e.g. "#E8EAF0". */
  fg?: string
  /** Resolved background, e.g. "#0B0D12" or "transparent". */
  bg?: string
  /** Compact font summary, e.g. "Inter 16/600". */
  font?: string
  /** Shorthand padding, e.g. "32" or "0 48". */
  pad?: string
  /** Border radius in pixels. */
  radius?: number
  /** Border shorthand, when one is set. */
  border?: string
  /** True for buttons, links and anything with a click handler. */
  interactive?: boolean
  /** True for elements that exist to group others. */
  container?: boolean
  /** True for images and image-like nodes. */
  image?: boolean
}

export type DesignTheme = {
  bg?: string
  fg?: string
  accent?: string
  fonts?: readonly string[]
}

/** Everything the review reads. This is the whole input. */
export type DesignSnapshot = {
  /** What the screen was asked to be. Lets the review judge delivery. */
  brief?: string
  viewport: { w: number; h: number }
  theme?: DesignTheme
  elements: readonly DesignElement[]
}

/**
 * A problem with a right answer, computed rather than judged.
 *
 * One finding covers every element that fails the same way. A page whose muted
 * text colour fails against its background fails it once as a decision and
 * hundreds of times as elements, and listing it hundreds of times buries every
 * other finding under it.
 */
export type DesignFinding = {
  kind: "contrast" | "tap-target" | "type-scale" | "spacing-scale" | "overflow"
  /** Plain sentence naming what is wrong. Self-contained, count included. */
  message: string
  severity: "fail" | "warn"
  /** How many elements fail this way. 1 for a whole-page finding. */
  count: number
  /** A few short labels naming affected elements, for orientation. */
  examples: readonly string[]
  /** Indexes into `DesignSnapshot.elements`, capped. */
  elementIndexes: readonly number[]
}

/**
 * One component of a page, with its own snapshot.
 *
 * Each section is reviewed as its own state rather than as a region named
 * inside the page's. The model takes one state per request and has no way to
 * scope an answer to part of it, so a question about "the header" asked
 * against the whole page is a question it cannot honour.
 */
export type DesignSection = {
  id: string
  /** The section's first heading, its aria-label, or its tag. */
  label: string
  tag: string
  /** `[x, y, width, height]` in page coordinates. */
  box: readonly [number, number, number, number]
  snapshot: DesignSnapshot & { truncated?: boolean }
}

/** A reviewed component. */
export type SectionReview = {
  id: string
  label: string
  tag: string
  box: readonly [number, number, number, number]
  elementCount: number
  /** What kind of component the model takes this to be. */
  kind: string
  kindConfidence: number
  /** The dimension to address first in this section. */
  fixFirst: string
  scores: readonly DesignScore[]
  flags: readonly DesignFlag[]
  /** Mean of this section's scores, 0 to 100, on the same basis as the page. */
  overall: DesignOverall | null
}

/** Shared by every judged answer. */
type JudgedBase = {
  id: string
  /** Human label for the dimension. */
  label: string
  section: string
  /** One line explaining what the answer means, where one helps. */
  note?: string
}

/** A judged dimension. The number came from the model, not from a formula. */
export type DesignScore = JudgedBase & {
  /** Probability-weighted level, 0 to `levels - 1`. */
  value: number
  levels: number
  /** The level description nearest the value. */
  summary: string
  /** Every level with its own probability, in order. */
  distribution: readonly { label: string; probability: number }[]
  /** Distribution concentration. Not a claim that the value is correct. */
  confidence: number
}

export type DesignFlag = JudgedBase & {
  /** Probability the statement holds, 0 to 1. */
  probability: number
}

/**
 * A judged pick from a named set.
 *
 * The full spread is kept, not just the winner. A choice at 0.94 and a choice
 * at 0.34 read identically once the runners-up are discarded, and the spread is
 * the only thing that tells them apart.
 */
export type DesignChoice = JudgedBase & {
  choice: string
  confidence: number
  /** Every option with its probability, highest first. */
  distribution: readonly { option: string; probability: number }[]
}

/**
 * One number for the whole screen.
 *
 * The mean of every craft dimension, each normalised to its own scale first,
 * because the rubrics differ in length and a raw mean would let a four-level
 * dimension outvote a five-level one.
 *
 * Only craft dimensions count. The yes/no signals are deliberately excluded:
 * some are good to be true, some are bad, and one, a dark interface, is
 * neither, so folding them in would need a direction per flag and a reader
 * could not tell which way any of them pushed.
 *
 * `confidence` is carried beside the value rather than folded into it.
 * Weighting by confidence would move the number for reasons that have nothing
 * to do with the design.
 */
export type DesignOverall = {
  /** 0 to 100. */
  value: number
  /** How many dimensions went into the mean. */
  dimensions: number
  /** Mean confidence across those dimensions. Not folded into `value`. */
  confidence: number
  /** A word for the band the value falls in. */
  band: string
}

export type DesignReview = {
  /** One number for the screen, derived from the judged dimensions. */
  overall: DesignOverall | null
  /** What the model thinks this screen is. A canary for a lossy snapshot. */
  screenKind: string
  /** The dimension to address first, per the model. */
  fixFirst: string
  /** The dimension it already handles best. */
  strongest: string
  choices: readonly DesignChoice[]
  scores: readonly DesignScore[]
  flags: readonly DesignFlag[]
  /** Computed, exact, and the only part that can explain itself. */
  findings: readonly DesignFinding[]
  usage: { inputTokens: number; outputTokens: number }
}
