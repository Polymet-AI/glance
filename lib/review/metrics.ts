import type { DesignElement, DesignFinding, DesignSnapshot } from "./types"

/**
 * The half of a design review that has a right answer.
 *
 * None of this goes to the model. Contrast, sizes and scale counts are
 * arithmetic, which is a documented weak spot, and asking a probabilistic
 * model for a number a formula already gives you is how a review ends up
 * confidently wrong about something checkable.
 *
 * It is also the only half that can say *why*, since the model returns a
 * value and a probability but never a reason.
 */

/** Below this, WCAG AA fails for body text. */
const CONTRAST_FLOOR_BODY = 4.5
/** Below this, AA fails for large text: 24px, or 18.66px when bold. */
const CONTRAST_FLOOR_LARGE = 3
const LARGE_TEXT_PX = 24
const LARGE_BOLD_TEXT_PX = 18.66
const BOLD_WEIGHT = 700

/** The smallest comfortable touch target, in CSS pixels. */
const MIN_TAP_TARGET_PX = 44

/** More distinct steps than this and the scale has stopped being a scale. */
const MAX_TYPE_STEPS = 8
const MAX_SPACING_STEPS = 8

export type Rgb = { r: number; g: number; b: number }
export type Rgba = Rgb & { a: number }

const clampChannel = ({ value }: { value: number }): number => Math.min(255, Math.max(0, value))
const clampAlpha = ({ value }: { value: number }): number => Math.min(1, Math.max(0, value))

/**
 * Parses `transparent`, `#rgb`, `#rrggbb`, `#rrggbbaa` and `rgb()` / `rgba()`.
 *
 * Returns null for anything else, including gradients. Null means "cannot be
 * determined", and every caller treats that as a reason to skip a check rather
 * than to guess. A guessed colour produces a contrast number that looks exact
 * and is wrong, which is worse than reporting nothing.
 */
export const parseColor = ({ value }: { value: string }): Rgba | null => {
  const input = value.trim().toLowerCase()

  if (input === "transparent") return { r: 0, g: 0, b: 0, a: 0 }

  const hex = /^#([0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/.exec(input)
  if (hex?.[1]) {
    const digits = hex[1]
    const expanded =
      digits.length <= 4
        ? digits
            .split("")
            .map((character) => character + character)
            .join("")
        : digits
    const alpha = expanded.length === 8 ? Number.parseInt(expanded.slice(6, 8), 16) / 255 : 1
    return {
      r: Number.parseInt(expanded.slice(0, 2), 16),
      g: Number.parseInt(expanded.slice(2, 4), 16),
      b: Number.parseInt(expanded.slice(4, 6), 16),
      a: alpha,
    }
  }

  const rgb = /^rgba?\(\s*([\d.]+)[\s,/]+([\d.]+)[\s,/]+([\d.]+)(?:[\s,/]+([\d.]+%?))?\s*\)/.exec(input)
  if (rgb?.[1] && rgb[2] && rgb[3]) {
    const rawAlpha = rgb[4]
    const alpha = rawAlpha
      ? clampAlpha({
          value: rawAlpha.endsWith("%")
            ? Number.parseFloat(rawAlpha) / 100
            : Number.parseFloat(rawAlpha),
        })
      : 1
    return {
      r: clampChannel({ value: Number.parseFloat(rgb[1]) }),
      g: clampChannel({ value: Number.parseFloat(rgb[2]) }),
      b: clampChannel({ value: Number.parseFloat(rgb[3]) }),
      a: alpha,
    }
  }

  return null
}

/** Paints a translucent colour over an opaque one. Standard source-over. */
export const compositeOver = ({ source, backdrop }: { source: Rgba; backdrop: Rgb }): Rgb => ({
  r: source.r * source.a + backdrop.r * (1 - source.a),
  g: source.g * source.a + backdrop.g * (1 - source.a),
  b: source.b * source.a + backdrop.b * (1 - source.a),
})

/** Relative luminance, per the WCAG 2 definition. */
export const relativeLuminance = ({ color }: { color: Rgb }): number => {
  const channel = ({ value }: { value: number }): number => {
    const ratio = value / 255
    return ratio <= 0.03928 ? ratio / 12.92 : ((ratio + 0.055) / 1.055) ** 2.4
  }
  return (
    0.2126 * channel({ value: color.r }) +
    0.7152 * channel({ value: color.g }) +
    0.0722 * channel({ value: color.b })
  )
}

/** Contrast ratio between two colours, from 1 to 21. */
export const contrastRatio = ({ foreground, background }: { foreground: Rgb; background: Rgb }): number => {
  const lighter = Math.max(
    relativeLuminance({ color: foreground }),
    relativeLuminance({ color: background }),
  )
  const darker = Math.min(
    relativeLuminance({ color: foreground }),
    relativeLuminance({ color: background }),
  )
  return (lighter + 0.05) / (darker + 0.05)
}

/** Reads the pixel size and weight out of a compact font summary like "Inter 16/600". */
export const parseFont = ({ font }: { font: string }): { size: number; weight: number } | null => {
  const match = /(\d+(?:\.\d+)?)\s*(?:\/\s*([\d.]+))?/.exec(font)
  if (!match?.[1]) return null
  const size = Number.parseFloat(match[1])
  const weightMatch = /\b([1-9]00)\b/.exec(font)
  const weight = weightMatch?.[1] ? Number.parseInt(weightMatch[1], 10) : 400
  return { size, weight }
}

/**
 * Works out what colour actually sits behind an element.
 *
 * A background is rarely one fill. A card at three percent white over a page
 * gradient is nearly the page colour, not nearly white, so every translucent
 * layer between the text and the first opaque surface has to be composited.
 *
 * Returns null when the answer cannot be determined: an unsupported colour
 * notation, a gradient, or a chain that never reaches an opaque surface. The
 * caller skips the check rather than guessing.
 */
export const resolveBackgroundColor = ({
  index,
  snapshot,
}: {
  index: number
  snapshot: DesignSnapshot
}): Rgb | null => {
  const element = snapshot.elements[index]
  if (!element) return null

  const layers: Rgba[] = []
  let reachedOpaque = false
  let undeterminable = false

  /** Adds one painted layer. Absent means nothing is painted, which is fine. */
  const addLayer = ({ value }: { value: string | undefined }): void => {
    if (value === undefined || undeterminable || reachedOpaque) return
    const parsed = parseColor({ value })
    if (!parsed) {
      undeterminable = true
      return
    }
    if (parsed.a === 0) return
    layers.push(parsed)
    if (parsed.a >= 1) reachedOpaque = true
  }

  addLayer({ value: element.bg })

  const [x, y, width, height] = element.box
  for (let candidate = index - 1; candidate >= 0 && !reachedOpaque && !undeterminable; candidate -= 1) {
    const other = snapshot.elements[candidate]
    if (!other || other.bg === undefined) continue
    const [ox, oy, ow, oh] = other.box
    const contains = ox <= x && oy <= y && ox + ow >= x + width && oy + oh >= y + height
    if (contains) addLayer({ value: other.bg })
  }

  addLayer({ value: snapshot.theme?.bg })

  if (undeterminable || !reachedOpaque) return null

  const base = layers[layers.length - 1]
  if (!base) return null

  let resolved: Rgb = { r: base.r, g: base.g, b: base.b }
  for (let layer = layers.length - 2; layer >= 0; layer -= 1) {
    const source = layers[layer]
    if (source) resolved = compositeOver({ source, backdrop: resolved })
  }
  return resolved
}

/** Up to this many element indexes are kept per finding. */
const MAX_INDEXES_PER_FINDING = 50
const MAX_EXAMPLES = 3
const EXAMPLE_LENGTH = 32

const toHex = ({ color }: { color: Rgb }): string =>
  `#${[color.r, color.g, color.b]
    .map((channel) => Math.round(channel).toString(16).padStart(2, "0"))
    .join("")}`

const labelFor = ({ element }: { element: DesignElement }): string =>
  element.text ? `"${element.text.slice(0, EXAMPLE_LENGTH)}"` : `the ${element.tag}`

/** Folds one group of same-cause failures into a single finding. */
const groupOf = ({
  kind,
  severity,
  describe,
  members,
}: {
  kind: DesignFinding["kind"]
  severity: DesignFinding["severity"]
  /** Takes the count so the sentence can read naturally either way. */
  describe: (args: { count: number; examples: readonly string[] }) => string
  members: readonly { index: number; label: string }[]
}): DesignFinding => {
  const examples = members.slice(0, MAX_EXAMPLES).map((member) => member.label)
  return {
    kind,
    severity,
    count: members.length,
    examples,
    elementIndexes: members.slice(0, MAX_INDEXES_PER_FINDING).map((member) => member.index),
    message: describe({ count: members.length, examples }),
  }
}

const listExamples = ({ examples }: { examples: readonly string[] }): string => {
  if (examples.length <= 1) return examples[0] ?? ""
  return `${examples.slice(0, -1).join(", ")} and ${examples[examples.length - 1]}`
}

const checkContrast = ({ snapshot }: { snapshot: DesignSnapshot }): DesignFinding[] => {
  // Keyed on the pair of colours and the floor they missed, because that is
  // the decision a person would change. Two hundred links sharing one grey are
  // one problem, not two hundred.
  const groups = new Map<
    string,
    { foreground: string; background: string; ratio: number; floor: number; members: { index: number; label: string }[] }
  >()

  snapshot.elements.forEach((element, index) => {
    if (!element.text || !element.fg || !element.font) return

    const textColor = parseColor({ value: element.fg })
    const background = resolveBackgroundColor({ index, snapshot })
    const font = parseFont({ font: element.font })
    if (!textColor || !background || !font) return

    // Translucent text takes the colour behind it, same as any other layer.
    const foreground =
      textColor.a >= 1 ? textColor : compositeOver({ source: textColor, backdrop: background })

    const isLarge =
      font.size >= LARGE_TEXT_PX || (font.weight >= BOLD_WEIGHT && font.size >= LARGE_BOLD_TEXT_PX)
    const floor = isLarge ? CONTRAST_FLOOR_LARGE : CONTRAST_FLOOR_BODY
    const ratio = contrastRatio({ foreground, background })
    if (ratio >= floor) return

    const foregroundHex = toHex({ color: foreground })
    const backgroundHex = toHex({ color: background })
    const key = `${foregroundHex}|${backgroundHex}|${floor}`

    const existing = groups.get(key)
    if (existing) {
      existing.members.push({ index, label: labelFor({ element }) })
      return
    }
    groups.set(key, {
      foreground: foregroundHex,
      background: backgroundHex,
      ratio,
      floor,
      members: [{ index, label: labelFor({ element }) }],
    })
  })

  return [...groups.values()]
    .sort((a, b) => b.members.length - a.members.length)
    .map((group) =>
      groupOf({
        kind: "contrast",
        severity: "fail",
        members: group.members,
        describe: ({ count, examples }) =>
          count === 1
            ? `${examples[0]} sits at ${group.ratio.toFixed(2)}:1 against its background, under the ${group.floor}:1 minimum for this size.`
            : `Text in ${group.foreground} on ${group.background} sits at ${group.ratio.toFixed(2)}:1, under the ${group.floor}:1 minimum. ${count} elements, including ${listExamples({ examples })}.`,
      }),
    )
}

const checkTapTargets = ({ snapshot }: { snapshot: DesignSnapshot }): DesignFinding[] => {
  const members: { index: number; label: string }[] = []
  let smallest: { width: number; height: number } | null = null

  snapshot.elements.forEach((element, index) => {
    if (!element.interactive) return
    const [, , width, height] = element.box
    if (width >= MIN_TAP_TARGET_PX && height >= MIN_TAP_TARGET_PX) return

    members.push({ index, label: labelFor({ element }) })
    const area = width * height
    if (!smallest || area < smallest.width * smallest.height) {
      smallest = { width, height }
    }
  })

  if (members.length === 0) return []

  const tightest = smallest as { width: number; height: number } | null

  return [
    groupOf({
      kind: "tap-target",
      severity: "warn",
      members,
      describe: ({ count, examples }) => {
        const size = tightest
          ? `, the tightest ${Math.round(tightest.width)} by ${Math.round(tightest.height)}`
          : ""
        return count === 1
          ? `${examples[0]} is under the ${MIN_TAP_TARGET_PX} pixel minimum for a touch target${size}.`
          : `${count} interactive elements are under the ${MIN_TAP_TARGET_PX} pixel minimum for a touch target${size}. Including ${listExamples({ examples })}.`
      },
    }),
  ]
}

const collectFontSizes = ({ elements }: { elements: readonly DesignElement[] }): number[] => {
  const sizes = new Set<number>()
  elements.forEach((element) => {
    if (!element.font) return
    const font = parseFont({ font: element.font })
    if (font) sizes.add(font.size)
  })
  return [...sizes].sort((a, b) => a - b)
}

const collectPaddingValues = ({ elements }: { elements: readonly DesignElement[] }): number[] => {
  const values = new Set<number>()
  elements.forEach((element) => {
    if (!element.pad) return
    element.pad
      .split(/\s+/)
      .map((part) => Number.parseFloat(part))
      .filter((part) => Number.isFinite(part) && part > 0)
      .forEach((part) => values.add(part))
  })
  return [...values].sort((a, b) => a - b)
}

const checkScales = ({ snapshot }: { snapshot: DesignSnapshot }): DesignFinding[] => {
  const findings: DesignFinding[] = []

  const fontSizes = collectFontSizes({ elements: snapshot.elements })
  if (fontSizes.length > MAX_TYPE_STEPS) {
    findings.push({
      kind: "type-scale",
      severity: "warn",
      count: 1,
      examples: [],
      elementIndexes: [],
      message: `${fontSizes.length} distinct font sizes are in use (${fontSizes.join(", ")}). A scale of ${MAX_TYPE_STEPS} or fewer reads as deliberate.`,
    })
  }

  const paddings = collectPaddingValues({ elements: snapshot.elements })
  if (paddings.length > MAX_SPACING_STEPS) {
    findings.push({
      kind: "spacing-scale",
      severity: "warn",
      count: 1,
      examples: [],
      elementIndexes: [],
      message: `${paddings.length} distinct spacing values are in use (${paddings.join(", ")}). Fewer steps make the rhythm visible.`,
    })
  }

  return findings
}

const checkOverflow = ({ snapshot }: { snapshot: DesignSnapshot }): DesignFinding[] => {
  const members: { index: number; label: string }[] = []
  let worst = 0

  snapshot.elements.forEach((element, index) => {
    const [x, , width] = element.box
    const past = x + width - snapshot.viewport.w
    if (past <= 0) return
    members.push({ index, label: labelFor({ element }) })
    worst = Math.max(worst, past)
  })

  if (members.length === 0) return []

  return [
    groupOf({
      kind: "overflow",
      severity: "fail",
      members,
      describe: ({ count, examples }) =>
        count === 1
          ? `${examples[0]} extends ${Math.round(worst)} pixels past the ${snapshot.viewport.w} pixel viewport.`
          : `${count} elements extend past the ${snapshot.viewport.w} pixel viewport, the furthest by ${Math.round(worst)} pixels. Including ${listExamples({ examples })}.`,
    }),
  ]
}

/**
 * Every check that has a right answer, run over a snapshot.
 *
 * Pure and offline. No network, no key, no model. A caller can run this alone
 * and get a useful report without ever reaching TypeSafe.
 */
export const computeFindings = ({ snapshot }: { snapshot: DesignSnapshot }): DesignFinding[] => [
  ...checkContrast({ snapshot }),
  ...checkOverflow({ snapshot }),
  ...checkTapTargets({ snapshot }),
  ...checkScales({ snapshot }),
]
