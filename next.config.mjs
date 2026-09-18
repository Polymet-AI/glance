import { existsSync } from "node:fs"
import path from "node:path"
import process from "node:process"

// Next only looks for an env file beside the app. The terminal runner reads one
// at the repo root, and keeping the same key in two places is how they drift,
// so the root file is loaded here when it exists. A file beside the app still
// wins, because Next loads that afterwards.
const rootEnvFile = path.join(process.cwd(), "..", "..", ".env")
if (existsSync(rootEnvFile)) {
  process.loadEnvFile(rootEnvFile)
}

/** @type {import("next").NextConfig} */
const nextConfig = {
  // Playwright ships a browser and native bindings that must not be traced
  // into the server bundle.
  serverExternalPackages: ["playwright", "playwright-core"],
}

export default nextConfig
