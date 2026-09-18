import { fileURLToPath } from "node:url"
import { defineConfig } from "vitest/config"

/**
 * Vitest does not read the `paths` mapping out of tsconfig, so the `@/` alias
 * is repeated here. Both have to agree or a test resolves a module the type
 * checker never saw.
 */
export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL(".", import.meta.url)),
    },
  },
})
