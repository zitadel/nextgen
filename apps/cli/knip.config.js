export default {
  ignore: ["knip.config.js"],
  ignoreBinaries: ["openssl"],
  ignoreIssues: {
    "src/lib/suggestion/index.ts": ["types"],
  },
};
