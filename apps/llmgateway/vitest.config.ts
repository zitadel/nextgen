import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		name: "@zitadel-nextgen/llmgateway",
		watch: false,
		passWithNoTests: true,
		globals: true,
		environment: "node",
		include: ["tests/**/*.spec.ts"],
		reporters: ["default"],
		clearMocks: true,
		restoreMocks: true,
		testTimeout: 60000,
		hookTimeout: 60000,
		coverage: {
			reportsDirectory: "./test-output/vitest/coverage",
			provider: "v8",
			include: ["src/**/*.ts"],
			exclude: ["src/**/*.spec.ts"],
		},
	},
});
