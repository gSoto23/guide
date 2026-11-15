// Shared Vitest defaults. Packages spread this into their own vitest.config.ts.
export const baseTestConfig = {
  test: {
    include: ["test/**/*.test.ts", "src/**/*.test.ts"],
    exclude: ["test/integration/**", "node_modules/**", "dist/**"],
    passWithNoTests: true,
  },
};
