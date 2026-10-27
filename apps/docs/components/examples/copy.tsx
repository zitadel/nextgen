"use client";

import { MockedLogin } from "./shared";

export interface CopyExampleProps {
  /** The visitor's language, one the login ships a dictionary for. */
  lang?: "en" | "de" | "it";
  /** The text `locales` sets for `identifier.title` in that language. */
  title?: string;
}

/** `locales` on `<zitadel-login>`, guides/customize-copy.mdx's example. */
export function CopyExample({ lang = "en", title = "Welcome back" }: CopyExampleProps) {
  return <MockedLogin lang={lang} locales={{ [lang]: { "identifier.title": title } }} />;
}
