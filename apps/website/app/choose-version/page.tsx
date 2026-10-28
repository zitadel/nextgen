import type { Metadata } from "next";
import type { ReactNode } from "react";
import { links } from "../links";
import og from "../og.jpg";
import { SiteFooter } from "../site-footer";
import { SiteHeader } from "../site-header";
import {
  AREAS,
  CHOOSE,
  type Feature,
  STATUS_DESCRIPTIONS,
  STATUS_LABELS,
  type Status,
  type Support,
  UPDATED,
} from "./features";

const title = "Choose your Zitadel version";
const description =
  "What the next version of Zitadel has today next to Zitadel v4, and which of the two to start with.";

// The share image is the front page's (layout.tsx): a page's openGraph
// replaces the layout's whole.
export const metadata: Metadata = {
  title,
  description,
  openGraph: {
    type: "website",
    siteName: "Zitadel",
    title,
    description,
    images: [{ url: og.src, width: og.width, height: og.height, alt: "Zitadel" }],
  },
  twitter: { card: "summary_large_image", title, description, images: [og.src] },
};

const LINK =
  "text-text-primary underline decoration-border-secondary underline-offset-4 transition-colors hover:decoration-text-primary";

const DATE = new Intl.DateTimeFormat("en", { dateStyle: "long", timeZone: "UTC" });

const BUTTON =
  "mt-auto inline-flex h-10 items-center self-start rounded-xl px-4 font-semibold text-sm transition-colors";

const STATUS_COLORS: Record<Status, string> = {
  available: "text-success",
  partial: "text-text-secondary",
  next: "text-text-accent",
  roadmap: "text-text-secondary",
  unavailable: "text-text-muted",
};

export default function ChooseVersionPage() {
  return (
    <>
      <SiteHeader />
      <main className="px-6 pt-12 pb-20 md:pt-20 md:pb-28">
        <div className="mx-auto max-w-3xl">
          <h1 className="font-heading text-4xl text-text-primary leading-tight tracking-[-0.025em] md:text-5xl">
            Which Zitadel version is right for you?
          </h1>
          <p className="mt-4 text-base text-text-secondary leading-7 md:text-lg md:leading-8">
            What the next version of Zitadel has today, next to{" "}
            <a href={links.zitadel} className={LINK}>
              Zitadel v4
            </a>
            . If the features you need are already here, go ahead and start with the next version:
            we add more with every release.
          </p>
          <p className="mt-4 text-base text-text-secondary leading-7 md:text-lg md:leading-8">
            If you rely on a feature that is not available yet, we recommend Zitadel v4. Be aware
            that you will migrate to the next version at some point.
          </p>
          <div className="mt-10 grid gap-4 sm:grid-cols-2">
            <Choice
              title="Start with the next version if"
              reasons={CHOOSE.next}
              action={
                <a
                  href={links.quickstart}
                  className={`${BUTTON} bg-text-primary text-background hover:bg-text-secondary`}
                >
                  Open the quickstart
                </a>
              }
            />
            <Choice
              title="Choose Zitadel v4 if"
              reasons={CHOOSE.v4}
              action={
                <a
                  href={links.zitadel}
                  className={`${BUTTON} border border-border-secondary text-text-primary hover:bg-tint/[0.06]`}
                >
                  Go to zitadel.com
                </a>
              }
            />
          </div>
          <p className="mt-4 text-sm text-text-muted leading-6">
            Not sure which fits? Ask in the{" "}
            <a href={links.discord} className={LINK}>
              nextgen channel on Discord
            </a>
            .
          </p>
          <section id="starting-now" className="mt-12 scroll-mt-20">
            <h2 className="font-heading text-2xl text-text-primary leading-tight">
              What starting now means
            </h2>
            <dl className="mt-5 flex flex-col gap-5 text-base text-text-secondary leading-7">
              <div>
                <dt className="font-semibold text-text-primary">Your data carries over.</dt>
                <dd>
                  Each release now upgrades from the one before it and keeps your data: what you
                  build now, you keep building on. Breaking changes can still happen, but we keep
                  them to a minimum, and the{" "}
                  <a href={links.changelog} className={LINK}>
                    changelog
                  </a>{" "}
                  says what each release changes.
                </dd>
              </div>
              <div>
                <dt className="font-semibold text-text-primary">Is it ready for production?</dt>
                <dd>
                  It depends on what you run. For a home lab, a service that is not critical, or an
                  app you build now and launch in a few months, start with the next version. If you
                  need to go live now with an SLA, guaranteed uptime, and backup and recovery,
                  choose Zitadel v4.
                </dd>
              </div>
              <div>
                <dt className="font-semibold text-text-primary">Cloud or self-hosted.</dt>
                <dd>
                  Zitadel Cloud runs the next version, but it does not have full backup and recovery
                  yet, runs in fewer regions, and has no account management, billing or pricing yet.
                  As with Zitadel today: for full control over your data, backups and region, host
                  it yourself.
                </dd>
              </div>
            </dl>
          </section>
          <dl className="mt-12 grid gap-x-6 gap-y-3 text-sm leading-6 sm:grid-cols-[auto_1fr]">
            {STATUS_DESCRIPTIONS.map(([status, meaning]) => (
              <div key={status} className="contents">
                <dt>
                  <StatusLabel status={status} />
                </dt>
                <dd className="text-text-secondary max-sm:-mt-3">{meaning}</dd>
              </div>
            ))}
          </dl>
          <nav aria-label="Areas" className="mt-10 flex flex-wrap gap-2 text-sm">
            {AREAS.map((area) => (
              <a
                key={area.id}
                href={`#${area.id}`}
                className="rounded-full border border-border-primary px-3 py-1 text-text-secondary transition-colors hover:border-border-secondary hover:text-text-primary"
              >
                {area.title}
              </a>
            ))}
          </nav>
          <div className="mt-12 flex flex-col gap-14">
            {AREAS.map((area) => (
              <section key={area.id} id={area.id} className="scroll-mt-20">
                <h2 className="font-heading text-2xl text-text-primary leading-tight">
                  {area.title}
                </h2>
                <table className="mt-5 w-full table-fixed border-collapse text-left text-sm leading-6">
                  <thead>
                    <tr className="border-border-primary border-b font-mono text-text-muted text-xs">
                      <th scope="col" className="w-[40%] py-2 pr-3 font-normal">
                        Feature
                      </th>
                      <th scope="col" className="py-2 pr-3 font-normal">
                        Preview
                      </th>
                      <th scope="col" className="py-2 font-normal">
                        Zitadel v4
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {area.features.map((feature) => (
                      <FeatureRow key={feature.name} feature={feature} />
                    ))}
                  </tbody>
                </table>
              </section>
            ))}
          </div>
          <p className="mt-14 text-sm text-text-muted leading-6">
            Last updated <time dateTime={UPDATED}>{DATE.format(new Date(UPDATED))}</time>. The next
            version changes with every release: the{" "}
            <a href={links.changelog} className={LINK}>
              changelog
            </a>{" "}
            says what each one adds. Missing something? Tell us on{" "}
            <a href={links.discord} className={LINK}>
              Discord
            </a>{" "}
            or in the{" "}
            <a href={links.issues} className={LINK}>
              issues
            </a>
            .
          </p>
        </div>
      </main>
      <SiteFooter />
    </>
  );
}

function Choice({
  title,
  reasons,
  action,
}: {
  title: string;
  reasons: string[];
  action: ReactNode;
}) {
  return (
    <section className="flex flex-col gap-5 rounded-xl border border-window-border bg-window p-5">
      <h2 className="font-heading text-text-primary text-xl leading-tight">{title}</h2>
      <ul className="flex flex-col gap-2 text-sm text-text-secondary leading-6">
        {reasons.map((reason) => (
          <li key={reason} className="flex gap-2">
            <span aria-hidden="true" className="text-text-muted">
              –
            </span>
            {reason}
          </li>
        ))}
      </ul>
      {action}
    </section>
  );
}

function FeatureRow({ feature }: { feature: Feature }) {
  return (
    <tr className="border-border-primary border-b align-top">
      <th scope="row" className="py-3 pr-3 font-normal text-text-primary">
        {feature.name}
      </th>
      <td className="py-3 pr-3">
        <SupportCell support={feature.preview} />
      </td>
      <td className="py-3">
        <SupportCell support={feature.v4} />
      </td>
    </tr>
  );
}

/** A status as a mark and its word, so it never rests on color alone; under it the note. */
function SupportCell({ support }: { support: Support }) {
  return (
    <>
      <StatusLabel status={support.status} />
      {support.note &&
        (support.href ? (
          <a
            href={support.href}
            className="block text-text-muted text-xs leading-5 underline decoration-border-secondary underline-offset-4 transition-colors hover:text-text-primary hover:decoration-text-primary"
          >
            {support.note}
          </a>
        ) : (
          <span className="block text-text-muted text-xs leading-5">{support.note}</span>
        ))}
    </>
  );
}

function StatusLabel({ status }: { status: Status }) {
  return (
    <span className={`inline-flex items-center gap-1.5 ${STATUS_COLORS[status]}`}>
      <StatusMark status={status} />
      {STATUS_LABELS[status]}
    </span>
  );
}

function StatusMark({ status }: { status: Status }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 16 16" fill="none" className="size-3.5 shrink-0">
      {status === "available" && (
        <path
          d="M3.5 8.5l3 3 6-7"
          stroke="currentColor"
          strokeWidth="1.75"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      )}
      {status === "partial" && (
        <>
          <circle cx="8" cy="8" r="5.5" stroke="currentColor" strokeWidth="1.5" />
          <path d="M8 2.5a5.5 5.5 0 010 11z" fill="currentColor" />
        </>
      )}
      {status === "next" && (
        <>
          <circle cx="8" cy="8" r="5.5" stroke="currentColor" strokeWidth="1.5" />
          <path
            d="M8 5v3l2 1.5"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </>
      )}
      {status === "roadmap" && (
        <circle
          cx="8"
          cy="8"
          r="5.5"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeDasharray="2.5 2"
        />
      )}
      {status === "unavailable" && (
        <path d="M4 8h8" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
      )}
    </svg>
  );
}
