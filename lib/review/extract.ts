import type { DesignElement, DesignSection, DesignSnapshot } from "./types"

/**
 * Turns a live page into a snapshot.
 *
 * Runs in the browser, against the rendered result rather than the source.
 * Source holds `bg-primary` and `p-4`; only the rendered page knows what those
 * resolved to once the framework and the CSS variables applied, and it cannot
 * say which branch of a conditional class won.
 *
 * The output is deliberately lean. A description aimed at editing code carries
 * selectors, component ancestry and serialised props, all of which cost tokens
 * and say nothing about whether a design is good. Accuracy falls as irrelevant
 * context grows, so carrying them would cost twice.
 */

const TEXT_LIMIT = 80
const DEFAULT_MAX_ELEMENTS = 400
const MIN_AREA_PX = 24

const INTERACTIVE_TAGS = new Set(["a", "button", "input", "select", "textarea", "summary"])
const SKIP_TAGS = new Set(["script", "style", "meta", "link", "head", "title", "noscript", "br"])
const CONTAINER_TAGS = new Set(["div", "section", "article", "main", "aside", "nav", "header", "footer", "ul", "ol", "form"])

const roundTo = ({ value, places }: { value: number; places: number }): number => {
  const factor = 10 ** places
  return Math.round(value * factor) / factor
}

/** Collapses the font longhands into one short string, e.g. "Inter 16/600". */
const summariseFont = ({ style }: { style: CSSStyleDeclaration }): string => {
  const family = style.fontFamily.split(",")[0]?.replace(/["']/g, "").trim() ?? ""
  const size = roundTo({ value: Number.parseFloat(style.fontSize), places: 1 })
  const weight = style.fontWeight || "400"
  return `${family} ${size}/${weight}`.trim()
}

const summarisePadding = ({ style }: { style: CSSStyleDeclaration }): string | undefined => {
  const sides = [style.paddingTop, style.paddingRight, style.paddingBottom, style.paddingLeft].map(
    (side) => Math.round(Number.parseFloat(side) || 0),
  )
  if (sides.every((side) => side === 0)) return undefined
  const [top, right, bottom, left] = sides
  if (top === right && right === bottom && bottom === left) return String(top)
  if (top === bottom && right === left) return `${top} ${right}`
  return sides.join(" ")
}

const isTransparent = ({ color }: { color: string }): boolean =>
  color === "transparent" || color === "rgba(0, 0, 0, 0)"

/** The browser paints white when nothing else does. */
const DEFAULT_CANVAS_BACKGROUND = "#ffffff"

/**
 * The colour actually behind the page.
 *
 * The root element's background propagates to the canvas, and the body's is
 * used when the root paints nothing. Most sites paint neither and rely on the
 * browser's own white, so reporting "transparent" here would leave every
 * contrast check with no opaque surface to resolve against, and the whole
 * computed half would silently do nothing on a real page.
 */
const resolveCanvasBackground = ({
  htmlStyle,
  bodyStyle,
}: {
  htmlStyle: CSSStyleDeclaration
  bodyStyle: CSSStyleDeclaration
}): string => {
  if (!isTransparent({ color: htmlStyle.backgroundColor })) return htmlStyle.backgroundColor
  if (!isTransparent({ color: bodyStyle.backgroundColor })) return bodyStyle.backgroundColor
  return DEFAULT_CANVAS_BACKGROUND
}

/**
 * Whether a viewer could see this element at all.
 *
 * A layout wrapper that paints nothing, holds no text and cannot be clicked is
 * invisible: it shapes the page without being part of its design. On a real
 * site these outnumber everything else, and since the element budget is finite
 * every one kept is a visible element dropped.
 */
const isVisibleToAViewer = ({
  style,
  text,
  tag,
}: {
  style: CSSStyleDeclaration
  text: string
  tag: string
}): boolean => {
  if (text) return true
  if (INTERACTIVE_TAGS.has(tag)) return true
  if (tag === "img" || tag === "svg" || tag === "picture" || tag === "video" || tag === "canvas") {
    return true
  }
  if (!isTransparent({ color: style.backgroundColor })) return true
  if (style.borderTopWidth !== "0px" && style.borderTopStyle !== "none") return true
  if (style.backgroundImage !== "none") return true
  if (style.boxShadow !== "none") return true
  return false
}

/** Direct text of a node, ignoring text that belongs to its children. */
const ownText = ({ element }: { element: Element }): string => {
  let text = ""
  element.childNodes.forEach((node) => {
    if (node.nodeType === 3) text += node.textContent ?? ""
  })
  return text.replace(/\s+/g, " ").trim()
}

const hasClickHandler = ({ element }: { element: Element }): boolean =>
  element.hasAttribute("onclick") ||
  element.getAttribute("role") === "button" ||
  element.getAttribute("role") === "link"

const describeElement = ({
  element,
  style,
  rect,
}: {
  element: Element
  style: CSSStyleDeclaration
  rect: DOMRect
}): DesignElement => {
  const tag = element.tagName.toLowerCase()
  const text = ownText({ element })
  const padding = summarisePadding({ style })
  const radius = Math.round(Number.parseFloat(style.borderTopLeftRadius) || 0)
  const hasBorder = style.borderTopWidth !== "0px" && style.borderTopStyle !== "none"
  const interactive = INTERACTIVE_TAGS.has(tag) || hasClickHandler({ element })

  return {
    tag,
    box: [
      Math.round(rect.x),
      Math.round(rect.y),
      Math.round(rect.width),
      Math.round(rect.height),
    ],
    ...(text ? { text: text.slice(0, TEXT_LIMIT), fg: style.color, font: summariseFont({ style }) } : {}),
    ...(isTransparent({ color: style.backgroundColor }) ? {} : { bg: style.backgroundColor }),
    ...(padding ? { pad: padding } : {}),
    ...(radius > 0 ? { radius } : {}),
    ...(hasBorder
      ? { border: `${style.borderTopWidth} ${style.borderTopStyle} ${style.borderTopColor}` }
      : {}),
    ...(interactive ? { interactive: true } : {}),
    ...(CONTAINER_TAGS.has(tag) && !text ? { container: true } : {}),
    ...(tag === "img" || tag === "svg" || tag === "picture" ? { image: true } : {}),
  }
}

/**
 * Walks a subtree and returns the elements a viewer could see inside it.
 *
 * Skips anything invisible, anything smaller than a few pixels, and anything
 * past `maxElements`. When the cap bites the caller is told, so bounded
 * coverage never reads as complete coverage.
 */
const collectElements = ({
  root,
  view,
  maxElements,
}: {
  root: Element
  view: Window
  maxElements: number
}): { elements: DesignElement[]; truncated: boolean } => {
  const elements: DesignElement[] = []
  let truncated = false

  const visit = ({ element }: { element: Element }): void => {
    if (elements.length >= maxElements) {
      truncated = true
      return
    }

    const tag = element.tagName.toLowerCase()
    if (SKIP_TAGS.has(tag)) return

    const style = view.getComputedStyle(element)
    if (style.display === "none" || style.visibility === "hidden" || style.opacity === "0") return

    const rect = element.getBoundingClientRect()
    const text = ownText({ element })
    if (rect.width * rect.height >= MIN_AREA_PX && isVisibleToAViewer({ style, text, tag })) {
      elements.push(describeElement({ element, style, rect }))
    }

    // An invisible wrapper is skipped but still walked: its children are
    // usually where everything visible lives.
    Array.from(element.children).forEach((child) => visit({ element: child }))
  }

  visit({ element: root })
  return { elements, truncated }
}

const readTheme = ({ view, document }: { view: Window; document: Document }) => {
  const bodyStyle = view.getComputedStyle(document.body)
  const htmlStyle = view.getComputedStyle(document.documentElement)
  return {
    bg: resolveCanvasBackground({ htmlStyle, bodyStyle }),
    fg: bodyStyle.color,
    fonts: [bodyStyle.fontFamily.split(",")[0]?.replace(/["']/g, "").trim() ?? ""],
  }
}

export const extractSnapshot = ({
  root,
  brief,
  maxElements = DEFAULT_MAX_ELEMENTS,
}: {
  root: Element
  /** What the screen was asked to be. Lets the review judge delivery. */
  brief?: string
  maxElements?: number
}): DesignSnapshot & { truncated: boolean } => {
  const view = root.ownerDocument.defaultView
  if (!view) {
    throw new Error("extractSnapshot needs an element attached to a live document.")
  }

  const { elements, truncated } = collectElements({ root, view, maxElements })

  return {
    ...(brief ? { brief } : {}),
    viewport: { w: view.innerWidth, h: view.innerHeight },
    theme: readTheme({ view, document: root.ownerDocument }),
    elements,
    truncated,
  }
}

const SECTION_MIN_HEIGHT_PX = 120
/** A candidate must occupy this share of the page to count as a section. */
const SECTION_MIN_AREA_SHARE = 0.04
const SECTION_LABEL_LENGTH = 48
const DEFAULT_MAX_SECTIONS = 10
const DEFAULT_MAX_SECTION_ELEMENTS = 150
/** How far to descend through single-child wrappers before giving up. */
const MAX_WRAPPER_DEPTH = 4

const LANDMARK_SELECTOR = "header, nav, main, footer, aside"

const isRendered = ({ element, view }: { element: Element; view: Window }): boolean => {
  const style = view.getComputedStyle(element)
  if (style.display === "none" || style.visibility === "hidden") return false
  const rect = element.getBoundingClientRect()
  return rect.width > 0 && rect.height > 0
}

const labelFor = ({ element }: { element: Element }): string => {
  const heading = element.querySelector("h1, h2, h3")
  const headingText = heading?.textContent?.replace(/\s+/g, " ").trim()
  if (headingText) return headingText.slice(0, SECTION_LABEL_LENGTH)
  const aria = element.getAttribute("aria-label")?.trim()
  if (aria) return aria.slice(0, SECTION_LABEL_LENGTH)
  return element.tagName.toLowerCase()
}

/** Descends through single-child wrappers to reach the row of real sections. */
const realChildren = ({
  element,
  view,
  depth,
}: {
  element: Element
  view: Window
  depth: number
}): Element[] => {
  const children = Array.from(element.children).filter((child) => isRendered({ element: child, view }))
  const only = children[0]
  if (children.length === 1 && only && depth < MAX_WRAPPER_DEPTH) {
    return realChildren({ element: only, view, depth: depth + 1 })
  }
  return children
}

/**
 * Splits a page into the components a reader would recognise as separate.
 *
 * Semantic landmarks first, then the large direct children of the main
 * container. Anything nested inside another candidate is dropped, because a
 * section nested in a section is part of it rather than a peer, and because a
 * page header and a section heading are both `<header>`: only containment
 * tells them apart. Without that step a real page yields a dozen phantom
 * sections that are really headings inside the ones above them.
 */
export const extractSections = ({
  root,
  maxSections = DEFAULT_MAX_SECTIONS,
  maxElements = DEFAULT_MAX_SECTION_ELEMENTS,
}: {
  root: Element
  maxSections?: number
  maxElements?: number
}): DesignSection[] => {
  const document = root.ownerDocument
  const view = document.defaultView
  if (!view) {
    throw new Error("extractSections needs an element attached to a live document.")
  }

  const landmarks = Array.from(document.querySelectorAll(LANDMARK_SELECTOR)).filter(
    (element) => element.tagName.toLowerCase() !== "main" && isRendered({ element, view }),
  )

  const main = document.querySelector("main") ?? document.body
  const pageArea = Math.max(1, document.body.scrollWidth * document.body.scrollHeight)

  const children = realChildren({ element: main, view, depth: 0 }).filter((element) => {
    const rect = element.getBoundingClientRect()
    return (
      rect.height >= SECTION_MIN_HEIGHT_PX &&
      (rect.width * rect.height) / pageArea >= SECTION_MIN_AREA_SHARE
    )
  })

  const all = [...landmarks, ...children]
  const outermost = all.filter(
    (element) => !all.some((other) => other !== element && other.contains(element)),
  )

  const theme = readTheme({ view, document })

  return outermost
    .map((element) => ({ element, rect: element.getBoundingClientRect() }))
    .sort((a, b) => a.rect.y - b.rect.y)
    .slice(0, maxSections)
    .map(({ element, rect }, index) => {
      const { elements, truncated } = collectElements({ root: element, view, maxElements })
      return {
        id: `section-${index}`,
        label: labelFor({ element }),
        tag: element.tagName.toLowerCase(),
        box: [
          Math.round(rect.x),
          Math.round(rect.y + view.scrollY),
          Math.round(rect.width),
          Math.round(rect.height),
        ] as [number, number, number, number],
        snapshot: {
          viewport: { w: view.innerWidth, h: view.innerHeight },
          theme,
          elements,
          truncated,
        },
      }
    })
    .filter((section) => section.snapshot.elements.length > 0)
}
