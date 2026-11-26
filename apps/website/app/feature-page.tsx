import type { Metadata } from "next";
import type { ReactNode } from "react";
import { type Exchange, type Question, Questions, Transcript } from "./blocks";
import { appPath } from "./commands";
import { pageMetadata } from "./phase-page";
import { phaseOf, phasePath } from "./phases";
import { type FeatureSlug, featureOf, featurePath } from "./platform";
import { LinkRows, Part, PointList, TitleBlock, TopLight } from "./sections";
import { SiteFooter } from "./site-footer";
import { SiteHeader } from "./site-header";

/** A feature page's metadata: its title tag, worded as people search, and its description. */
export function featureMetadata(slug: FeatureSlug): Metadata {
  const { metaTitle, description } = featureOf(slug);
  return pageMetadata(metaTitle, description);
}

/**
 * What a feature page says beside its title (platform.ts): three points of
 * what you get, three asks and their replies, one real thing from the
 * repository under the hood, commands that work now, and three questions.
 */
export type FeatureContent = {
  points: readonly [string, string, string];
  asks: readonly Exchange[];
  hood: { line: ReactNode; artifact: ReactNode };
  tryIt: { line?: ReactNode; content: ReactNode };
  questions: readonly Question[];
};

/**
 * A feature page, the same seven parts every time (AGENTS.md): its group, its
 * title and line, What you get, Ask your agent, Under the hood, Try it,
 * Questions, and Related, the phase page it belongs to and two features.
 */
export function FeaturePage({ slug, content }: { slug: FeatureSlug; content: FeatureContent }) {
  const feature = featureOf(slug);
  const { phase } = phaseOf(feature.phase);
  const related = [
    { name: phase.name, line: phase.title, href: phasePath(phase.slug) },
    ...feature.related.map((other) => {
      const { name, title } = featureOf(other);
      return { name, line: title, href: featurePath(other) };
    }),
  ];
  return (
    <>
      <TopLight />
      <SiteHeader current={slug} />
      <main>
        <TitleBlock name={feature.group} title={feature.title} line={feature.line} />

        <Part id="what-you-get" title="What you get">
          <PointList points={content.points} />
        </Part>

        <Part id="ask-your-agent" title="Ask your agent">
          <div className="max-w-3xl">
            <Transcript title={appPath} exchanges={content.asks} />
          </div>
        </Part>

        <Part id="under-the-hood" title="Under the hood" line={content.hood.line} split>
          {content.hood.artifact}
        </Part>

        <Part id="try-it" title="Try it" line={content.tryIt.line}>
          {content.tryIt.content}
        </Part>

        <Part id="questions" title="Questions">
          <Questions questions={content.questions} />
        </Part>

        <Part id="related" title="Related">
          <LinkRows rows={related} />
        </Part>
      </main>
      <SiteFooter />
    </>
  );
}
