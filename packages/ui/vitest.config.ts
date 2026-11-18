import { defineConfig } from "vitest/config";
import { baseTestConfig } from "@guidesk/config/vitest";

export default defineConfig({
  ...baseTestConfig,
  esbuild: { jsx: "automatic" },
  test: { ...baseTestConfig.test, include: ["test/**/*.test.{ts,tsx}"] },
});
