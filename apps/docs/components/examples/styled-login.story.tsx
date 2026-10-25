import { defineStory } from "@/lib/story";

import { flatLook } from "./flat-look";
import { StyledLoginExample } from "./styled-login";

export const story = defineStory({
  displayName: "<zitadel-login>",
  Component: StyledLoginExample,
  args: { initial: flatLook },
});
