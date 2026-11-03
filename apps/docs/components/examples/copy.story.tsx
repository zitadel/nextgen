import { defineStory } from "@/lib/story";

import { CopyExample } from "./copy";

export const story = defineStory({
  displayName: "<zitadel-login>",
  Component: CopyExample,
  args: { initial: { lang: "en", title: "Welcome back" } },
});
