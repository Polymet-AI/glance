import { renderWithFirecrawl } from "./render-firecrawl"
import type { RenderResult, RenderStage } from "./render-types"

/**
 * Picks the browser a review runs in.
 *
 * A Firecrawl key means someone else's browser, which is the only shape that
 * fits a serverless host: a real Chromium is larger than the whole function
 * bundle is allowed to be. No key means the local Playwright browser, which is
 * what you want in development, where a key would cost credits on every save.
 *
 * The local renderer is imported only when it is actually used. Pulling it in
 * unconditionally would drag Playwright into the production bundle, where its
 * browser does not exist and the import fails before any of this runs.
 */

export const usingHostedBrowser = (): boolean => Boolean(process.env["FIRECRAWL_API_KEY"])

/** Names the renderer in a log line, so a puzzling result is traceable. */
export const rendererName = (): string => (usingHostedBrowser() ? "firecrawl" : "playwright")

export const renderPage = async ({
  input,
  brief,
  onStage,
}: {
  input: string
  brief?: string
  onStage?: (stage: RenderStage) => void
}): Promise<RenderResult> => {
  if (usingHostedBrowser()) {
    return renderWithFirecrawl({ input, ...(brief ? { brief } : {}), ...(onStage ? { onStage } : {}) })
  }

  const { renderSnapshot } = await import("./render")
  return renderSnapshot({ input, ...(brief ? { brief } : {}), ...(onStage ? { onStage } : {}) })
}
