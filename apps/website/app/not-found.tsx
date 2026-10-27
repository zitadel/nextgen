import type { Metadata } from "next";
import { LINK } from "./changelog/release";
import { links } from "./links";
import { SiteFooter } from "./site-footer";
import { SiteHeader } from "./site-header";

export const metadata: Metadata = { title: "Not found — Zitadel preview" };

/**
 * A path the website has no page for. The cloud sends the website only its
 * own paths (repo-root vercel.json), so a visitor lands here from a release
 * page that does not exist, such as /changelog/v9.9.9 (changelog/[tag]).
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
            lists every release from 0.1.0 on, and{" "}
            <a href={links.releases} className={LINK}>
              GitHub
            </a>{" "}
            has the alpha previews before it.
          </p>
        </div>
      </main>
      <SiteFooter />
    </>
  );
}
