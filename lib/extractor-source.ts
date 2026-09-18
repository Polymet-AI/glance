import { readFile } from "node:fs/promises"
import path from "node:path"

/**
 * The extractor, as source text.
 *
 * Both renderers need the same bundle: the local one installs it before
 * navigation, the hosted one posts it with the request. Reading it once here
 * means the snapshot is produced by identical code either way, which is the
 * only reason the two paths can be compared at all.
 *
 * The file is written by `pnpm build:extractor` and is not in git. It is read
 * from disk rather than imported, because it is an IIFE meant to run inside
 * someone else's page, not a module for this one. That makes it invisible to
 * the bundler's file tracing, so `next.config.mjs` names it explicitly.
 */

let cached: string | null = null

export const getExtractorSource = async (): Promise<string> => {
  if (cached) return cached

  const file = path.join(process.cwd(), "generated", "extractor.js")
  try {
    cached = await readFile(file, "utf8")
  } catch {
    throw new Error("The extractor bundle is missing. Run `pnpm build:extractor`.")
  }
  return cached
}
