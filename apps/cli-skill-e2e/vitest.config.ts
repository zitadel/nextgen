// Plain config object (no vite import) so the harness loads cleanly. The eval
// can take tens of minutes with FRESH=1, so the hook timeout is generous.
export default {
  test: {
    globalSetup: ["./vitest.globalSetup.mjs"],
    include: ["tests/**/*.test.ts"],
    testTimeout: 7_200_000,
    hookTimeout: 7_200_000,
    reporters: ["default"],
  },
};
