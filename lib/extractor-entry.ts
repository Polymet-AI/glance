/**
 * Browser entry, bundled to an IIFE and injected into the rendered page.
 *
 * It imports the same extractor the review uses rather than restating it, so
 * the snapshot this app reviews is the snapshot the library would produce. A
 * second copy would drift from the first the week after it was written.
 */
import { extractSections, extractSnapshot } from "@/lib/review"

declare global {
  interface Window {
    __glanceExtract: (options: { brief?: string; maxElements?: number }) => unknown
    __glanceSections: (options: { maxSections?: number }) => unknown
  }
}

window.__glanceExtract = (options) =>
  extractSnapshot({
    root: document.body,
    ...(options.brief ? { brief: options.brief } : {}),
    ...(options.maxElements ? { maxElements: options.maxElements } : {}),
  })

window.__glanceSections = (options) =>
  extractSections({
    root: document.body,
    ...(options.maxSections ? { maxSections: options.maxSections } : {}),
  })
