import type { Metadata } from "next";
import { LINK } from "./changelog/entry";
import { links } from "./links";
import { SiteFooter } from "./site-footer";
import { SiteHeader } from "./site-header";

export const metadata: Metadata = { title: "Not found — Zitadel preview" };

/**
 * A path the website has no page for. The cloud sends the website only its
 * own paths (repo-root vercel.json), so a visitor lands here from a
 * changelog entry that does not exist (changelog/[slug]).
 */
export default function NotFound() {
  return (
    <>
      <SiteHeader current="changelog" />
      <main className="px-6 pt-12 pb-20 md:pt-20 md:pb-28">
        <div className="mx-auto max-w-3xl">
          <h1 className="font-heading text-4xl text-text-primary leading-tight tracking-[-0.025em] md:text-5xl">
            Not found
          </h1>
          <p className="mt-4 text-base text-text-secondary leading-7 md:text-lg md:leading-8">
            There is no page here. The{" "}
            <a href={links.changelog} className={LINK}>
              changelog
            </a>{" "}
            has what's new in the preview, and{" "}
            <a href={links.releases} className={LINK}>
              GitHub
            </a>{" "}
            the release notes of every version.
          </p>
        </div>
      </main>
      <SiteFooter />
    </>
  );
}
