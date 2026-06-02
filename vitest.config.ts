import { defineConfig } from "vitest/config"

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["plugins/**/*.test.ts"],
    coverage: {
      provider: "v8",
      include: ["plugins/**/*.ts"],
      exclude: ["plugins/**/*.test.ts"],
    },
  },
})
