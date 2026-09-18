import type { DesignSection, DesignSnapshot } from "@/lib/review"

import { getExtractorSource } from "./extractor-source"
import { assertSafeUrl, BlockedUrlError } from "./url-guard"
import { MAX_ELEMENTS, MAX_SECTIONS, SETTLE_MS, VIEWPORT } from "./render-types"
import type { RenderResult, RenderStage } from "./render-types"

/**
 * Renders a page with Firecrawl instead of a browser this process owns.
 *
 * Serverless hosts cap a function at a few hundred megabytes, and a real
 * Chromium does not fit. Renting the browser removes that problem along with
 * cold starts, memory ceilings and the operational weight of running one.
 *
 * What it costs is the progress the reader sees. The local renderer reports
 * nine steps and pushes a screenshot the moment navigation resolves. This is
 * one request that returns everything at once, so the steps it reports are the
 * honest few it can actually observe, and the page appears only at the end.
 *
 * @see https://docs.firecrawl.dev/api-reference/endpoint/scrape
 */

const SCRAPE_URL = "https://api.firecrawl.dev/v2/scrape"
/** Firecrawl accepts 1000-300000. A long marketing page can take a while. */
const TIMEOUT_MS = 90_000
const SCREENSHOT_QUALITY = 70

/**
 * Lets the document grow to its content, so a full-page capture has something
 * to stitch.
 *
 * An app shell that pins html and body to 100% and scrolls an inner container
 * never scrolls the document itself, and a full-page capture works by scrolling
 * the document. On those pages it silently returns one viewport: measured on a
 * fixture, 800x600 of content that runs to 2,106 pixels. Undoing the pinning
 * first returns the whole page.
 *
 * It runs only when that shape is detected, so an ordinary page is never
 * touched. Flattening a page that did not need it could unfold a carousel or a
 * clipped panel and change what the review sees.
 *
 * Sent as source text because it runs in Firecrawl's browser, not here. It
 * measures that browser's own viewport rather than assuming ours, since the
 * window it renders in is not something this request fully dictates.
 */
const flattenScript = (): string => `
  (() => {
    const viewportHeight = window.innerHeight;
    if (document.documentElement.scrollHeight > viewportHeight + 2) return 0;

    const inner = Array.from(document.querySelectorAll("body *")).filter((element) => {
      if (!(element instanceof HTMLElement)) return false;
      if (element.scrollHeight <= element.clientHeight + 1) return false;
      const style = window.getComputedStyle(element);
      return style.overflowY === "auto" || style.overflowY === "scroll";
    });

    const deepest = inner.reduce((best, element) => Math.max(best, element.scrollHeight), 0);
    if (deepest <= viewportHeight * 1.2) return 0;

    let touched = 0;
    for (const element of [document.documentElement, document.body, ...inner]) {
      element.style.setProperty("height", "auto", "important");
      element.style.setProperty("max-height", "none", "important");
      element.style.setProperty("overflow", "visible", "important");
      touched += 1;
    }
    return touched;
  })()
`

/** The extractor bundle, then one call into it, as one script. */
const extractScript = ({
  source,
  brief,
}: {
  source: string
  brief: string
}): string => `
  (() => {
    ${source}
    return {
      snapshot: window.__glanceExtract(${JSON.stringify({
        ...(brief ? { brief } : {}),
        maxElements: MAX_ELEMENTS,
      })}),
      sections: window.__glanceSections(${JSON.stringify({ maxSections: MAX_SECTIONS })}),
      pageWidth: document.documentElement.scrollWidth,
      pageHeight: document.documentElement.scrollHeight,
    };
  })()
`

type ScrapeResponse = {
  success?: boolean
  error?: string
  data?: {
    screenshot?: string
    metadata?: { title?: string; url?: string; statusCode?: number }
    actions?: {
      screenshots?: string[]
      javascriptReturns?: { type?: string; value?: unknown }[]
    }
  }
}

type Extracted = {
  snapshot: DesignSnapshot & { truncated?: boolean }
  sections: DesignSection[]
  pageWidth: number
  pageHeight: number
}

const readKey = (): string => {
  const key = process.env["FIRECRAWL_API_KEY"]
  if (!key) throw new Error("The server has no FIRECRAWL_API_KEY set.")
  return key
}

/**
 * Pulls the extraction out of the response.
 *
 * The returns arrive in the order the actions were sent, so the flatten result
 * is first and the extraction second. Anything else means the shape changed
 * under us, and failing loudly here beats reviewing an empty snapshot.
 */
const readReturns = ({
  response,
}: {
  response: ScrapeResponse
}): { flattened: boolean; extracted: Extracted } => {
  const returns = response.data?.actions?.javascriptReturns ?? []
  const flattenValue = returns[0]?.value
  const extractedValue = returns[1]?.value

  if (typeof extractedValue !== "object" || extractedValue === null) {
    throw new Error("Firecrawl returned no extraction.")
  }

  const extracted = extractedValue as Partial<Extracted>
  if (!extracted.snapshot || !Array.isArray(extracted.sections)) {
    throw new Error("Firecrawl returned an extraction in an unexpected shape.")
  }

  return {
    flattened: typeof flattenValue === "number" && flattenValue > 0,
    extracted: {
      snapshot: extracted.snapshot,
      sections: extracted.sections,
      pageWidth: extracted.pageWidth ?? VIEWPORT.width,
      pageHeight: extracted.pageHeight ?? VIEWPORT.height,
    },
  }
}

export const renderWithFirecrawl = async ({
  input,
  brief,
  onStage,
}: {
  input: string
  brief?: string
  onStage?: (stage: RenderStage) => void
}): Promise<RenderResult> => {
  const report = onStage ?? (() => {})

  report({ stage: "checking" })
  const { url } = await assertSafeUrl({ input })
  const key = readKey()
  const source = await getExtractorSource()

  report({ stage: "loading", url: url.toString() })
  report({ stage: "rendering" })

  // One request does the whole render. The actions run in order: unpin the
  // page, capture it whole, then read it. Capturing before extracting matters,
  // because the scroll a full-page capture performs is what makes lazy content
  // load, so the boxes describe the page as it finally settles.
  // v2 has no top-level viewport. The window size is set per screenshot, and
  // the extraction reads whatever window it actually ran in, so the geometry
  // stays self-consistent either way.
  const body = {
    url: url.toString(),
    formats: [
      { type: "screenshot", fullPage: false, quality: SCREENSHOT_QUALITY, viewport: VIEWPORT },
    ],
    onlyMainContent: false,
    waitFor: SETTLE_MS,
    timeout: TIMEOUT_MS,
    actions: [
      { type: "executeJavascript", script: flattenScript() },
      { type: "screenshot", fullPage: true, quality: SCREENSHOT_QUALITY, viewport: VIEWPORT },
      { type: "executeJavascript", script: extractScript({ source, brief: brief ?? "" }) },
    ],
  }

  let response: Response
  try {
    response = await fetch(SCRAPE_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    })
  } catch {
    throw new Error("Firecrawl could not be reached.")
  }

  const parsed = (await response.json().catch(() => ({}))) as ScrapeResponse

  if (!response.ok || parsed.success === false) {
    // The vendor's message stays here and never reaches the page.
    console.error("firecrawl scrape failed", {
      status: response.status,
      error: parsed.error,
    })
    throw new BlockedUrlError({
      message: `${url.hostname} could not be rendered.`,
    })
  }

  const status = parsed.data?.metadata?.statusCode
  if (typeof status === "number" && status >= 400) {
    throw new BlockedUrlError({ message: `${url.hostname} returned ${status}.` })
  }

  // A redirect can land somewhere the first check never saw.
  const finalUrl = parsed.data?.metadata?.url ?? url.toString()
  await assertSafeUrl({ input: finalUrl })

  const { flattened, extracted } = readReturns({ response: parsed })

  // The viewport shot is the page format; the full-page one is the action.
  // Both come back as links rather than inline data, which is why this path
  // streams a fraction of what the local one does.
  const pageImage = parsed.data?.actions?.screenshots?.[0] ?? parsed.data?.screenshot ?? ""
  const image = parsed.data?.screenshot ?? pageImage
  const title = parsed.data?.metadata?.title ?? ""

  report({ stage: "captured", image, title })
  report({
    stage: "mapping",
    pageImage,
    pageWidth: extracted.pageWidth,
    pageHeight: extracted.pageHeight,
  })
  report({ stage: "extracting" })
  report({ stage: "sectioning", sections: extracted.sections.length })

  return {
    snapshot: extracted.snapshot,
    finalUrl,
    title,
    image,
    pageImage,
    pageWidth: extracted.pageWidth,
    pageHeight: extracted.pageHeight,
    flattened,
    sections: extracted.sections,
  }
}
