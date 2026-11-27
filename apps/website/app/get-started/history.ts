import type { Change } from "../blocks";

// The change history in /get-started's You decide, each change naming who
// made it. The front page's You decide shows the same window, from here.
export const HISTORY: readonly Change[] = [
  { change: "Add sign-in", agent: true },
  { change: "Add passkeys", agent: true },
  { change: "Use our brand on the login screen", agent: true },
  { change: "Update the logo", agent: false },
];
