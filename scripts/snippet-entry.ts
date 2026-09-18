/**
 * Entry for the console snippet.
 *
 * Bundled to an IIFE so it can be pasted into any page's devtools console.
 * It uses the same extractor the app does, so the snapshot you test with is the
 * snapshot a review would see. A hand-copied snippet would drift.
 */
import { computeFindings, extractSnapshot } from "@/lib/review"

declare global {
  interface Window {
    glanceSnapshot: (options?: { brief?: string; maxElements?: number }) => unknown
  }
}

window.glanceSnapshot = (options = {}) => {
  const snapshot = extractSnapshot({
    root: document.body,
    ...(options.brief ? { brief: options.brief } : {}),
    ...(options.maxElements ? { maxElements: options.maxElements } : {}),
  })

  const findings = computeFindings({ snapshot })
  const json = JSON.stringify(snapshot, null, 2)

  console.log(
    `%cglance%c  ${snapshot.elements.length} elements${snapshot.truncated ? " (capped)" : ""} · ${findings.length} computed findings`,
    "background:#FF7A3D;color:#0A0711;padding:2px 6px;border-radius:4px;font-weight:600",
    "color:inherit",
  )
  if (findings.length > 0) console.table(findings)

  void navigator.clipboard
    ?.writeText(json)
    .then(() => console.log("Snapshot copied to the clipboard."))
    .catch(() => console.log("Clipboard blocked. The snapshot is the returned value."))

  return snapshot
}

console.log("Ready. Run glanceSnapshot({ brief: 'what this page is meant to be' })")
