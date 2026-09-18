/** @type {import("next").NextConfig} */
const nextConfig = {
  // Playwright ships native bindings and expects a browser on disk, neither of
  // which survive being traced into the server bundle. It is imported only when
  // no hosted browser is configured, which in practice means development.
  serverExternalPackages: ["playwright", "playwright-core"],

  // The extractor bundle is read from disk at runtime rather than imported,
  // because it is an IIFE meant to run inside someone else's page. A path built
  // at runtime is invisible to file tracing, so the route that needs it says so
  // explicitly or the file is missing once deployed.
  outputFileTracingIncludes: {
    "/api/review": ["./generated/extractor.js"],
  },
}

export default nextConfig
