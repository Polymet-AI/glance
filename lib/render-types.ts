import type { DesignSection, DesignSnapshot } from "@/lib/review"

/**
 * The contract both renderers meet.
 *
 * A review needs resolved colours, fonts and boxes, which only exist once
 * something lays the page out. Two things can do that: a browser this process
 * launches, or a browser someone else runs. Everything downstream is written
 * against this shape so it never has to know which one ran.
 */

/** The window the page is laid out in. Every box in a snapshot is relative to it. */
export const VIEWPORT = { width: 1440, height: 900 }
/** Past this the snapshot says so rather than quietly reviewing part of a page. */
export const MAX_ELEMENTS = 400
export const MAX_SECTIONS = 8
/** After load, give late paint and web fonts a moment before measuring. */
export const SETTLE_MS = 1_500

export type RenderStage =
  | { stage: "checking" }
  | { stage: "launching" }
  | { stage: "loading"; url: string }
  /** A browser elsewhere is loading and capturing the page. */
  | { stage: "rendering" }
  | { stage: "settling" }
  | { stage: "glimpse"; image: string }
  | { stage: "captured"; image: string; title: string }
  | { stage: "mapping"; pageImage: string; pageWidth: number; pageHeight: number }
  | { stage: "extracting" }
  | { stage: "sectioning"; sections: number }

export type RenderResult = {
  snapshot: DesignSnapshot & { truncated?: boolean }
  finalUrl: string
  title: string
  /**
   * The viewport, as something an `img` can show. Shown to the person, never
   * sent to the model. A data URL from a local browser, a signed link from a
   * hosted one.
   */
  image: string
  /** The whole page as one image, for the component map. */
  pageImage: string
  pageWidth: number
  pageHeight: number
  /** True when the page had to be unpinned before it could be captured whole. */
  flattened: boolean
  /** The page split into components, each with its own snapshot. */
  sections: DesignSection[]
}

export type RenderPage = (args: {
  input: string
  brief?: string
  /** Called as each step begins, so a caller can stream progress. */
  onStage?: (stage: RenderStage) => void
}) => Promise<RenderResult>
