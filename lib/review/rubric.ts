import { choice, noul, score } from "@/lib/client"
import type { Question } from "@/lib/client"

/**
 * The judged half of a design review.
 *
 * Everything here is a judgment no formula produces. Anything with a right
 * answer lives in `metrics.ts` and is computed instead, because arithmetic is
 * a documented weak spot and a guessed number that looks exact is worse than
 * no number.
 *
 * Every instruction is phrased positively: the model reads negations
 * literally, so "the palette is committed" behaves and "the palette is not
 * timid" does not.
 *
 * All of these go out in one request. A twenty-fourth question costs tokens
 * but almost no time, where twenty-four requests cost twenty-four round trips.
 */

export type SectionId = "reading" | "craft" | "signals" | "direction"

export const SECTION_LABELS: Record<SectionId, string> = {
  reading: "What it reads as",
  craft: "Craft",
  signals: "Signals",
  direction: "Direction",
}

export type QuestionMeta = {
  label: string
  section: SectionId
  /** One line for a details panel, explaining what the answer means. */
  note?: string
}

export const QUESTION_META: Record<string, QuestionMeta> = {
  screen_kind: { label: "Screen kind", section: "reading" },
  sector: { label: "Sector", section: "reading" },
  audience: { label: "Audience", section: "reading" },
  era: { label: "Design era", section: "reading" },

  hierarchy: { label: "Hierarchy", section: "craft" },
  finish: { label: "Finish", section: "craft" },
  coherence: { label: "Coherence", section: "craft" },
  typography: { label: "Typography", section: "craft" },
  colour: { label: "Colour", section: "craft" },
  density: { label: "Density", section: "craft" },
  copy: { label: "Copy", section: "craft" },
  trust: { label: "Credibility", section: "craft" },
  originality: { label: "Originality", section: "craft" },

  default_generated_look: { label: "Default generated look", section: "signals" },
  primary_action_obvious: { label: "Primary action is obvious", section: "signals" },
  value_proposition_clear: { label: "Says what it is", section: "signals" },
  background_depth: { label: "Background has depth", section: "signals" },
  dark_interface: { label: "Dark interface", section: "signals" },
  navigation_crowded: { label: "Navigation is crowded", section: "signals" },
  brief_delivered: { label: "Delivers the brief", section: "signals" },

  fix_first: { label: "Fix first", section: "direction" },
  strongest: { label: "Strongest already", section: "direction" },
}

export const SCREEN_KIND_QUESTION = "screen_kind"
export const FIX_FIRST_QUESTION = "fix_first"
export const STRONGEST_QUESTION = "strongest"

/** Ordered so a report reads top to bottom without sorting. */
export const QUESTION_ORDER: readonly string[] = [
  "screen_kind",
  "sector",
  "audience",
  "era",
  "hierarchy",
  "finish",
  "coherence",
  "typography",
  "colour",
  "density",
  "copy",
  "trust",
  "originality",
  "default_generated_look",
  "primary_action_obvious",
  "value_proposition_clear",
  "background_depth",
  "dark_interface",
  "navigation_crowded",
  "brief_delivered",
  "fix_first",
  "strongest",
]

const IMPROVABLE_DIMENSIONS: Record<string, string> = {
  typography: "Typeface choice and the type scale",
  colour: "Palette commitment and accent use",
  hierarchy: "Emphasis and the order attention travels",
  spacing: "Rhythm, density and breathing room",
  background: "Atmosphere and depth behind the content",
  consistency: "A shared vocabulary across components",
  copy: "The wording and its tone",
  imagery: "Photography, illustration and iconography",
}

/**
 * @param hasBrief whether the caller supplied what the screen was meant to be.
 * Without one, "delivers the brief" has nothing to judge against, and asking it
 * anyway returns a number that reads like an answer.
 */
export const buildQuestions = ({ hasBrief = false }: { hasBrief?: boolean } = {}): Record<
  string,
  Question
> => {
  const questions: Record<string, Question> = {
    // ---- What it reads as -------------------------------------------------

    [SCREEN_KIND_QUESTION]: choice({
      instructions: "Identify what kind of screen this layout describes.",
      criteria: {
        pricing: "Tiers with prices and a purchase action for each",
        landing: "A marketing hero with supporting sections",
        dashboard: "Metrics, charts and data tables",
        settings: "Grouped form controls for configuration",
        auth: "A single sign-in or sign-up form",
        feed: "A repeating list of posts, stories or messages",
        detail: "One record shown in full, with its actions",
        checkout: "A cart, payment details and an order summary",
        docs: "Long-form reference text with navigation beside it",
        editor: "A working surface with tools around it",
        other: "Something outside the options above",
      },
    }),

    sector: choice({
      instructions: "Identify the industry this design presents itself as belonging to.",
      criteria: {
        developer_tools: "Infrastructure, APIs and engineering products",
        fintech: "Payments, banking and financial services",
        ecommerce: "Selling physical goods",
        media: "Publishing, news and entertainment",
        health: "Medical, wellbeing and care",
        enterprise: "Internal business software and operations",
        creative: "Design, agency and portfolio work",
        social: "Community and person-to-person",
        education: "Teaching and courses",
        other: "Something outside the options above",
      },
    }),

    audience: choice({
      instructions: "Identify who this interface is addressing.",
      criteria: {
        developers: "Assumes technical fluency, shows code or terminology",
        business: "Addresses teams and buyers inside a company",
        consumer: "Addresses an individual in everyday language",
        specialist: "Assumes deep domain knowledge outside software",
      },
    }),

    era: choice({
      instructions: "Identify the design era this screen most resembles.",
      criteria: {
        skeuomorphic: "Gradients, bevels, drop shadows imitating real objects",
        flat_2015: "Flat fills, thin icons, wide light sans-serif type",
        material: "Elevation, cards and a strong grid",
        bootstrap_default: "Unmodified framework components and spacing",
        editorial: "Serif headlines, generous measure, print sensibility",
        brutalist: "Hard borders, raw type, deliberate roughness",
        contemporary_saas: "Soft radii, muted palette, a subtle gradient or glow",
        other: "Something outside the options above",
      },
    }),

    // ---- Craft ------------------------------------------------------------

    /**
     * Asks for a first step rather than a single main action.
     *
     * A pricing page has one action per tier; a homepage has a nav bar, a
     * sign-in, a contact-sales and a CTA in every section, all legitimate.
     * Asking which one is "the main action" asks for something such a page
     * does not have, and the model answered from the middle of the scale with
     * low confidence, once at 0.00. Level 3 now describes a page with several
     * routes arranged in an order, which is what a good homepage looks like.
     */
    hierarchy: score({
      instructions:
        "Rate how clearly the layout presents a first step to take. Several routes onward are normal on a page like this, so weigh whether one of them leads and the rest settle into an order beneath it.",
      levels: [
        "Everything carries the same weight, so attention has nowhere to land",
        "A rough order exists, and several elements compete to be the first step",
        "A first step emerges after scanning, while others still pull against it",
        "One first step leads, with the other routes arranged in a clear order beneath it",
        "The first step registers immediately, and the order of everything after it is unmistakable",
      ],
    }),

    finish: score({
      instructions: "Rate how finished this screen looks.",
      levels: [
        "A raw wireframe with placeholder text and browser default styling",
        "An early draft with real text on default components",
        "A competent template, consistent and generic",
        "Deliberately designed, with intentional type, colour and spacing",
        "Polished and distinctive, with a clear point of view",
      ],
    }),

    coherence: score({
      instructions: "Rate how much this screen reads as the work of a single designer.",
      levels: [
        "The pieces look gathered from different sources",
        "Mostly consistent, with visible exceptions",
        "A consistent component vocabulary throughout",
        "One hand is evident in every element",
      ],
    }),

    typography: score({
      instructions:
        "Rate the typeface choices and the type scale on distinctiveness and fit for this product.",
      levels: [
        "Browser defaults at a single size throughout",
        "A common interface sans-serif with a flat scale",
        "A common interface sans-serif with a clear scale",
        "A typeface chosen for this product, with a clear scale",
        "A distinctive typeface pairing that gives the product a voice",
      ],
    }),

    colour: score({
      instructions: "Rate how decisively colour is used.",
      levels: [
        "Greyscale throughout, with colour absent",
        "Several colours at similar strength, none of them leading",
        "One accent, applied consistently against neutral surfaces",
        "A clear lead colour, with accents placed where they do work",
        "A palette with a point of view, recognisable as this product's own",
      ],
    }),

    density: score({
      instructions: "Rate the breathing room between elements.",
      levels: [
        "Cramped, with elements colliding",
        "Tight, with content pressed against its edges",
        "Comfortable and even",
        "Generous, with space used to group and separate",
        "Airy, with space as a deliberate part of the composition",
      ],
    }),

    copy: score({
      instructions: "Rate how specific and useful the wording is.",
      levels: [
        "Placeholder text that says nothing about this product",
        "Generic marketing phrases that would fit any company",
        "Accurate and plain, describing what the product does",
        "Specific, concrete, with real numbers or named capabilities",
        "Specific and distinctive, with a voice of its own",
      ],
    }),

    trust: score({
      instructions: "Rate how credible this screen looks to a first-time visitor.",
      levels: [
        "Reads as a scam or an abandoned page",
        "Reads as an unfinished side project",
        "Reads as a small but real product",
        "Reads as an established company",
        "Reads as a company a cautious buyer would trust with money",
      ],
    }),

    originality: score({
      instructions: "Rate how much this design departs from the common template.",
      levels: [
        "Indistinguishable from a starter template",
        "A template with the colours changed",
        "Familiar patterns assembled with care",
        "Familiar patterns with one genuinely distinctive idea",
        "A design language of its own",
      ],
    }),

    // ---- Signals ----------------------------------------------------------

    default_generated_look: noul({
      instructions: "The screen matches the look common to generated interfaces.",
      criteria: {
        true: "A default interface sans-serif, a flat card grid, an evenly weighted palette and predictable layout choices",
        false: "Choices made specifically for this product, showing context-specific character",
      },
    }),

    primary_action_obvious: noul({
      instructions:
        "A first-time visitor can identify the single action this screen wants from them.",
    }),

    value_proposition_clear: noul({
      instructions: "A first-time visitor can tell what this product does from this screen alone.",
      criteria: {
        true: "The wording names the product's purpose plainly",
        false: "The purpose stays implied or hidden behind jargon",
      },
    }),

    background_depth: noul({
      instructions: "The surfaces behind the content have depth rather than a single flat fill.",
      criteria: {
        true: "Gradients, texture, or surfaces stacked at different tones",
        false: "One flat fill behind everything",
      },
    }),

    dark_interface: noul({
      instructions: "The screen presents light text on dark surfaces.",
    }),

    navigation_crowded: noul({
      instructions: "The navigation offers more choices than a visitor can hold at once.",
      criteria: {
        true: "Many competing links of equal weight across the top",
        false: "A small set of destinations, or a clear order among them",
      },
    }),

    // ---- Direction --------------------------------------------------------

    [FIX_FIRST_QUESTION]: choice({
      instructions:
        "Choose the single dimension that would most improve this screen if it were addressed first.",
      criteria: IMPROVABLE_DIMENSIONS,
    }),

    [STRONGEST_QUESTION]: choice({
      instructions: "Choose the dimension this screen already handles best.",
      criteria: IMPROVABLE_DIMENSIONS,
    }),
  }

  if (hasBrief) {
    questions["brief_delivered"] = noul({
      instructions: "The layout delivers everything the brief describes.",
    })
  }

  return questions
}

/** Dimensions a single component is rated on. Fewer than the page gets. */
export const SECTION_SCORE_IDS = ["hierarchy", "finish", "density"] as const

export const SECTION_KIND_QUESTION = "component_kind"
export const SECTION_FIX_QUESTION = "fix_first"

export const SECTION_QUESTION_META: Record<string, QuestionMeta> = {
  [SECTION_KIND_QUESTION]: { label: "Component", section: "reading" },
  hierarchy: { label: "Hierarchy", section: "craft" },
  finish: { label: "Finish", section: "craft" },
  density: { label: "Density", section: "craft" },
  purpose_clear: { label: "Purpose is clear", section: "signals" },
  [SECTION_FIX_QUESTION]: { label: "Fix first", section: "direction" },
}

/**
 * Questions for one component rather than a whole page.
 *
 * A component gets its own request with its own state. The model takes one
 * state per call and cannot scope an answer to part of it, so asking "rate the
 * header" against a whole-page state asks for something it has no way to
 * honour. Six questions here rather than the page's twenty-three: a footer has
 * no sector and no audience.
 */
export const buildSectionQuestions = (): Record<string, Question> => {
  const page = buildQuestions()
  return {
    [SECTION_KIND_QUESTION]: choice({
      instructions: "Identify what kind of component this is.",
      criteria: {
        header: "A bar across the top carrying the logo and top-level links",
        hero: "The opening statement, with a headline and a first action",
        feature_grid: "Repeating cards or columns describing capabilities",
        pricing: "Tiers with prices",
        testimonial: "Quotes or stories from customers",
        logo_wall: "A row or grid of customer logos",
        form: "Fields to fill in and submit",
        cta_band: "A short strip whose whole job is one action",
        content: "Running prose, articles or documentation",
        footer: "The closing block of links and legal text",
        nav: "A list of destinations on its own",
        other: "Something outside the options above",
      },
    }),

    hierarchy: page["hierarchy"] as Question,
    finish: page["finish"] as Question,
    density: page["density"] as Question,

    purpose_clear: noul({
      instructions: "A visitor can tell what this part of the page is for.",
      criteria: {
        true: "Its job is legible from its own contents alone",
        false: "Its job stays ambiguous without the rest of the page around it",
      },
    }),

    [SECTION_FIX_QUESTION]: choice({
      instructions:
        "Choose the single dimension that would most improve this component if it were addressed first.",
      criteria: IMPROVABLE_DIMENSIONS,
    }),
  }
}
