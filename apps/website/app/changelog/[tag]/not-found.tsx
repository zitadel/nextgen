import { links } from "../../links";
import { SiteFooter } from "../../site-footer";
import { SiteHeader } from "../../site-header";
import { LINK } from "../release";

/** A tag with no release from 0.1.0 on (page.tsx): the changelog and GitHub have the others. */
export default function ReleaseNotFound() {
  return (
    <>
      <SiteHeader current="changelog" />
      <main className="px-6 pt-12 pb-20 md:pt-20 md:pb-28">
        <div className="mx-auto max-w-3xl">
          <h1 className="font-heading text-4xl text-text-primary leading-tight tracking-[-0.025em] md:text-5xl">
            No such release
          </h1>
          <p className="mt-4 text-base text-text-secondary leading-7 md:text-lg md:leading-8">
            The{" "}
            <a href={links.changelog} className={LINK}>
              changelog
            </a>{" "}
            lists the newest releases, and{" "}
            <a href={links.releases} className={LINK}>
              GitHub
            </a>{" "}
            has every one, the alpha previews too.
          </p>
        </div>
      </main>
      <SiteFooter />
    </>
  );
}
