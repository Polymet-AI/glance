import { chromium } from "playwright"
import type { Browser } from "playwright"
import type { DesignSection, DesignSnapshot } from "@/lib/review"

import { getExtractorSource } from "./extractor-source"
import { assertSafeUrl, BlockedUrlError, isBlockedAddress } from "./url-guard"
import { MAX_ELEMENTS, MAX_SECTIONS, SETTLE_MS, VIEWPORT } from "./render-types"
import type { RenderResult, RenderStage } from "./render-types"

/**
 * Renders a URL in a browser this process launches, and reads a design
 * snapshot out of it.
 *
 * This is the development path. It reports every step and pushes a screenshot
 * the moment navigation resolves, which is the richer experience, but it needs
 * a real Chromium on disk and so cannot run on a serverless host. Production
 * uses `render-firecrawl.ts` instead.
 */

const NAVIGATION_TIMEOUT_MS = 20_000
const SCREENSHOT_QUALITY = 62
const PAGE_SCREENSHOT_QUALITY = 50
/**
 * Half the raster scale, same CSS geometry.
 *
 * A full-page capture of a long marketing site runs to about a megabyte once
 * base64-encoded, which is too much to push down a stream. Halving the device
 * scale factor cuts that to roughly a third and leaves every measurement
 * untouched, because it changes how many device pixels a CSS pixel rasterises
 * to and not the layout itself. Verified against real pages: the same element
 * reports the same box at either setting.
 */
const RASTER_SCALE = 0.5

const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 glance/0.1"

/** One browser for the process. Launching per request costs about a second. */
let browserPromise: Promise<Browser> | null = null

const launchBrowser = (): Promise<Browser> => {
  const pending = chromium.launch({ headless: true })
  browserPromise = pending
  // A rejected promise must never stay cached. Hold on to one and a single
  // failed launch, a browser that was not installed yet for instance, becomes
  // a permanent failure for the life of the process even after the cause is
  // fixed.
  pending.catch(() => {
    if (browserPromise === pending) browserPromise = null
  })
  return pending
}

const getBrowser = async (): Promise<Browser> => {
  if (browserPromise) {
    try {
      const existing = await browserPromise
      if (existing.isConnected()) return existing
    } catch {
      // Fall through and launch again.
    }
  }
  return launchBrowser()
}

/**
 * Lets the document grow to its content, so a full-page capture has something
 * to stitch.
 *
 * An app shell that pins html and body to 100% and scrolls an inner container
 * never scrolls the document itself, and Playwright's full-page capture works
 * by scrolling the document. On those pages it silently returns one viewport:
 * measured on a fixture, 800x600 of content that runs to 2,106 pixels. Undoing
 * the pinning first returns the whole page.
 *
 * It runs only when that shape is detected, so an ordinary page is never
 * touched. Flattening a page that did not need it could unfold a carousel or
 * a clipped panel and change what the review sees.
 */
const FLATTEN_SCROLLERS = ({ viewportHeight }: { viewportHeight: number }): number => {
  const documentScroll = document.documentElement.scrollHeight
  const documentScrolls = documentScroll > viewportHeight + 2
  if (documentScrolls) return 0

  const inner = Array.from(document.querySelectorAll("body *")).filter(
    (element): element is HTMLElement => {
      if (!(element instanceof HTMLElement)) return false
      if (element.scrollHeight <= element.clientHeight + 1) return false
      const style = window.getComputedStyle(element)
      return style.overflowY === "auto" || style.overflowY === "scroll"
    },
  )

  const deepest = inner.reduce((best, element) => Math.max(best, element.scrollHeight), 0)
  if (deepest <= viewportHeight * 1.2) return 0

  let touched = 0
  for (const element of [document.documentElement, document.body, ...inner]) {
    element.style.setProperty("height", "auto", "important")
    element.style.setProperty("max-height", "none", "important")
    element.style.setProperty("overflow", "visible", "important")
    touched += 1
  }
  return touched
}

export const renderSnapshot = async ({
  input,
  brief,
  onStage,
}: {
  input: string
  brief?: string
  /** Called as each step begins, so a caller can stream progress. */
  onStage?: (stage: RenderStage) => void
}): Promise<RenderResult> => {
  const report = onStage ?? (() => {})

  report({ stage: "checking" })
  const { url } = await assertSafeUrl({ input })

  report({ stage: "launching" })
  const browser = await getBrowser()
  const context = await browser.newContext({
    viewport: VIEWPORT,
    userAgent: USER_AGENT,
    deviceScaleFactor: RASTER_SCALE,
  })

  // Installed before navigation rather than injected after it. A site with a
  // strict Content Security Policy refuses an inline script tag, and the sites
  // most worth reviewing are exactly the ones that set one. An init script is
  // delivered over the debugger protocol, which the policy does not govern.
  await context.addInitScript({ content: await getExtractorSource() })

  const page = await context.newPage()

  try {
    // The guard resolved the host once. The browser resolves it again, and a
    // host can answer differently the second time, so every request the page
    // makes is checked as it goes rather than trusting that first answer.
    await page.route("**/*", async (route) => {
      const requestUrl = new URL(route.request().url())
      if (requestUrl.protocol !== "http:" && requestUrl.protocol !== "https:") {
        await route.abort()
        return
      }
      const literal = requestUrl.hostname.replace(/^\[|\]$/g, "")
      const family = literal.includes(":") ? 6 : /^\d+\.\d+\.\d+\.\d+$/.test(literal) ? 4 : 0
      if (family !== 0 && isBlockedAddress({ address: literal, family })) {
        await route.abort()
        return
      }
      await route.continue()
    })

    report({ stage: "loading", url: url.toString() })
    const response = await page.goto(url.toString(), {
      waitUntil: "domcontentloaded",
      timeout: NAVIGATION_TIMEOUT_MS,
    })

    if (!response) {
      throw new BlockedUrlError({ message: `${url.hostname} did not respond.` })
    }
    if (response.status() >= 400) {
      throw new BlockedUrlError({ message: `${url.hostname} returned ${response.status()}.` })
    }

    // A redirect can land somewhere the first check never saw.
    await assertSafeUrl({ input: page.url() })

    const glimpse = await page.screenshot({ type: "jpeg", quality: SCREENSHOT_QUALITY })
    report({ stage: "glimpse", image: `data:image/jpeg;base64,${glimpse.toString("base64")}` })

    report({ stage: "settling" })
    await page.waitForTimeout(SETTLE_MS)

    const title = await page.title()
    const shot = await page.screenshot({ type: "jpeg", quality: SCREENSHOT_QUALITY })
    const image = `data:image/jpeg;base64,${shot.toString("base64")}`
    report({ stage: "captured", image, title })

    // The full-page capture scrolls the page to stitch it, which is what makes
    // lazy content load. Taking it before measuring means the boxes describe
    // the page as it finally settles rather than as it first painted.
    const flattened = await page.evaluate(FLATTEN_SCROLLERS, { viewportHeight: VIEWPORT.height })
    if (flattened > 0) await page.waitForTimeout(350)

    const pageShot = await page.screenshot({
      type: "jpeg",
      quality: PAGE_SCREENSHOT_QUALITY,
      fullPage: true,
    })
    await page.evaluate(() => window.scrollTo(0, 0))
    await page.waitForTimeout(250)

    const pageSize = await page.evaluate(() => ({
      width: document.documentElement.scrollWidth,
      height: document.documentElement.scrollHeight,
    }))
    const pageImage = `data:image/jpeg;base64,${pageShot.toString("base64")}`
    report({
      stage: "mapping",
      pageImage,
      pageWidth: pageSize.width,
      pageHeight: pageSize.height,
    })

    report({ stage: "extracting" })
    const snapshot = await page.evaluate(
      ({ pageBrief, maxElements }) =>
        window.__glanceExtract({ ...(pageBrief ? { brief: pageBrief } : {}), maxElements }),
      { pageBrief: brief ?? "", maxElements: MAX_ELEMENTS },
    )

    const sections = (await page.evaluate(
      ({ maxSections }) => window.__glanceSections({ maxSections }),
      { maxSections: MAX_SECTIONS },
    )) as DesignSection[]
    report({ stage: "sectioning", sections: sections.length })

    return {
      snapshot: snapshot as DesignSnapshot & { truncated?: boolean },
      finalUrl: page.url(),
      title,
      image,
      pageImage,
      pageWidth: pageSize.width,
      pageHeight: pageSize.height,
      flattened: flattened > 0,
      sections,
    }
  } finally {
    await context.close()
  }
}
