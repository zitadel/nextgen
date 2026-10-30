import { Config } from "@remotion/cli/config";

// Frames go to the encoder as JPEG, which is quicker than PNG; the video
// carries no transparency.
Config.setVideoImageFormat("jpeg");
Config.setOverwriteOutput(true);

// Fonts go into the bundle as data URLs. As files, the Studio's dev server
// serves them from their path under pnpm's hidden node_modules/.pnpm, which it
// answers with its HTML page, and every face fails to load.
Config.overrideWebpackConfig((config) => ({
  ...config,
  module: {
    ...config.module,
    rules: config.module?.rules?.map((rule) =>
      rule &&
      typeof rule === "object" &&
      rule.test instanceof RegExp &&
      rule.test.test("face.woff2")
        ? { ...rule, type: "asset/inline" }
        : rule,
    ),
  },
}));
