import type { Metadata } from "next";
import { pageMetadata } from "../phase-page";
import { FEATURE_GROUPS, FEATURES, featurePath, PLATFORM } from "../platform";
import { TitleBlock, TopLight } from "../sections";
import { SiteFooter } from "../site-footer";
import { SiteHeader } from "../site-header";

export const metadata: Metadata = pageMetadata(PLATFORM.metaTitle, PLATFORM.description);

const H2 = "font-heading text-2xl leading-8 tracking-[-0.02em] md:text-3xl md:leading-10";

/**
 * Every feature page, by group (platform.ts): under each group's heading, a
 * row per feature set off by hairlines, its name in the steps' small type
 * beside its title and line.
 */
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
                <ul className="mt-6 border-border-primary border-b">
                  {FEATURES.filter((feature) => feature.group === group).map(
                    ({ slug, name, title, line }) => (
                      <li key={slug} className="border-border-primary border-t">
                        <a
                          href={featurePath(slug)}
                          className="group grid gap-x-10 gap-y-2 py-6 md:grid-cols-[10rem_minmax(0,1fr)_auto]"
                        >
                          <span className="font-mono text-text-muted text-xs leading-7">
                            {name}
                          </span>
                          <span className="flex flex-col gap-1">
                            <span className="text-balance font-heading text-text-primary text-xl leading-7">
                              {title}
                            </span>
                            <span className="text-pretty text-text-secondary leading-7 transition-colors group-hover:text-text-primary">
                              {line}
                            </span>
                          </span>
                          <svg
                            aria-hidden="true"
                            viewBox="0 0 16 16"
                            fill="none"
                            className="mt-1.5 hidden size-4 text-text-muted transition-transform group-hover:translate-x-0.5 group-hover:text-text-primary md:block"
                          >
                            <path
                              d="M3 8h10M9 4l4 4-4 4"
                              stroke="currentColor"
                              strokeWidth="1.5"
                              strokeLinecap="round"
                              strokeLinejoin="round"
                            />
                          </svg>
                        </a>
                      </li>
                    ),
                  )}
                </ul>
              </div>
            </section>
          );
        })}
      </main>
      <SiteFooter />
    </>
  );
}
