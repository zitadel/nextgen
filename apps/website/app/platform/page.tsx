import type { Metadata } from "next";
import { pageMetadata } from "../phase-page";
import { FEATURE_GROUPS, FEATURES, featurePath, PLATFORM } from "../platform";
import { TitleBlock, TitleRows, TopLight } from "../sections";
import { SiteFooter } from "../site-footer";
import { SiteHeader } from "../site-header";

export const metadata: Metadata = pageMetadata(PLATFORM.metaTitle, PLATFORM.description);

const H2 = "font-heading text-2xl leading-8 tracking-[-0.02em] md:text-3xl md:leading-10";

/** Every feature page, by group (platform.ts): under each group's heading, a row per feature. */
export default function PlatformPage() {
  return (
    <>
      <TopLight />
      <SiteHeader current="platform" />
      <main className="pb-20 md:pb-28">
        <TitleBlock name={PLATFORM.name} title={PLATFORM.title} line={PLATFORM.line} />
        {FEATURE_GROUPS.map((group) => {
          const id = group.toLowerCase();
          return (
            <section
              key={group}
              id={id}
              aria-labelledby={`${id}-title`}
              className="scroll-mt-20 px-6 py-10 md:py-14"
            >
              <div className="mx-auto max-w-5xl">
                <h2 id={`${id}-title`} className={H2}>
                  {group}
                </h2>
                <div className="mt-6">
                  <TitleRows
                    rows={FEATURES.filter((feature) => feature.group === group).map(
                      ({ slug, name, title, line }) => ({
                        label: name,
                        title,
                        line,
                        href: featurePath(slug),
                      }),
                    )}
                  />
                </div>
              </div>
            </section>
          );
        })}
      </main>
      <SiteFooter />
    </>
  );
}
