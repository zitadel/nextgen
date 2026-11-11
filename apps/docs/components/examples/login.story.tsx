import { defineStory } from "@/lib/story";

import { LoginExample } from "./login";

export const story = defineStory({
  displayName: "<zitadel-login>",
  Component: LoginExample,
  args: { initial: { purpose: "login" } },
});
