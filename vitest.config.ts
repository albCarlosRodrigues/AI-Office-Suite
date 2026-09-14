import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  test: {
    coverage: {
      provider: "v8",
      reporter: ["text", "json-summary", "html"],
      reportsDirectory: "coverage",
      include: [
        "src/runtime/**/*.ts",
        "src/orchestration/**/*.ts",
        "src/integrations/prx/**/*.ts",
        "src/integrations/localant/**/*.ts",
        "src/integrations/free-claude/**/*.ts",
      ],
      exclude: ["**/__tests__/**", "**/*.test.ts", "src/orchestration/engine.server.ts"],
      // Slice 3 target, raised after measuring 64.68/47.38/65.10/66.66.
      thresholds: { statements: 55, branches: 40, functions: 55, lines: 55 },
    },
  },
});
