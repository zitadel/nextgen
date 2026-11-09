import type { Metadata } from "next";
import type { ReactNode } from "react";
import { links } from "../links";
import og from "../og.jpg";
import { SiteFooter } from "../site-footer";
import { SiteHeader } from "../site-header";
import {
  type Catalog,
  capitalize,
  days,
  dollars,
  type Hub,
  hubMeters,
  hubPrice,
  included,
  licensedPrice,
  meterPrice,
  readCatalog,
  sentence,
} from "./catalog";
import { compareGroups, lowestHub } from "./compare";
import { CompareTable, StatusTag } from "./compare-table";
import {
  combine,
  type FeatureStatus,
  featureStatus,
  hubStatus,
  meterStatus,
  works,
} from "./status";

// Built from the repository (catalog.ts), so a deploy brings the prices the
// cloud bills from; nothing is read per visit. Laid out like the pricing
// pages people know: the tiers, the add-ons you turn on, what's coming, the
// lines for scale and support, a capability comparison, then the questions
// for billing details. What
// doesn't work yet carries Choose a version's status (status.ts), and an
// add-on still to come shows no price.
export const dynamic = "force-static";

const title = "Pricing — Zitadel preview";
const description =
  "Pay as you go starts free with users and MFA included. Add-ons cover what your app needs, each with one base fee.";

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

const H2 = "font-heading text-3xl text-text-primary leading-tight tracking-[-0.02em] md:text-4xl";
const BUTTON =
  "flex h-11 items-center justify-center rounded-lg px-5 font-semibold text-sm transition-colors";
const PRIMARY = `${BUTTON} bg-text-primary text-background hover:opacity-85`;
const SECONDARY = `${BUTTON} border border-window-border bg-tint/[0.03] text-text-primary hover:bg-tint/[0.07]`;

export default function PricingPage() {
  const catalog = readCatalog();
  return (
    <>
      <SiteHeader current="pricing" />
      <main className="px-6 pt-12 pb-20 md:pt-20 md:pb-28">
        <div className="mx-auto max-w-6xl">
          <h1 className="max-w-3xl font-heading text-4xl text-text-primary leading-tight tracking-[-0.025em] md:text-6xl">
            Start free. Add what your app needs.
          </h1>
          <p className="mt-4 max-w-2xl text-base text-text-secondary leading-7 md:text-lg md:leading-8">
            Users, MFA and secure defaults are free, with no card. When your app needs more, turn on
            an add-on for one base fee.
          </p>
          <p className="mt-3 max-w-2xl text-sm text-text-muted leading-6">
            In preview: nothing is billed yet, and these prices apply from general availability.{" "}
            <a
              href={links.chooseVersion}
              className="text-text-primary underline underline-offset-4"
            >
              Choose a version
            </a>{" "}
            shows what works today, next to Zitadel v4.
          </p>

          <Tiers catalog={catalog} />

          <section aria-labelledby="add-ons" className="mt-20 md:mt-28">
            <h2 id="add-ons" className={H2}>
              Add-ons
            </h2>
            <EveryHub catalog={catalog} />
            <Hubs catalog={catalog} />
          </section>
          <ScaleAndSupport catalog={catalog} />
          <p className="mt-6 text-center text-text-muted text-xs leading-5">
            All prices in {catalog.currency.toUpperCase()}, before taxes.
          </p>

          <section aria-labelledby="compare" className="mt-20 md:mt-28">
            <h2 id="compare" className={H2}>
              Compare
            </h2>
            <CompareTable
              groups={compareGroups(catalog)}
              prices={{
                payg: `$0, plus add-ons from ${lowestHub(catalog)} / month`,
                enterprise: "Custom",
              }}
            />
          </section>

          <SelfHosted catalog={catalog} />
          <Questions catalog={catalog} />
        </div>
      </main>
      <SiteFooter />
    </>
  );
}

/** The two tiers: Pay as you go, with add-ons on top, and Enterprise. */
function Tiers({ catalog }: { catalog: Catalog }) {
  const { free, pro, enterprise } = catalog.plans;
  const addendum = catalog.licensed.find((line) => line.id === "addendum");
  const keys = catalog.licensed.find((line) => line.id === "private_keys");
  const listed = catalog.hubs.filter((hub) => hub.pricing === "listed");
  const [firstCompliance = "", ...moreCompliance] = enterprise.compliance;
  return (
    <div className="mt-12 grid gap-4 md:grid-cols-2">
      <Card
        name={pro.label}
        price="$0"
        per={`to start, plus add-ons from ${lowestHub(catalog)} / month`}
        line="Build and launch free, no card needed. Turn on add-ons when your app needs them, and pay only for those."
        lists={[
          {
            heading: "Included:",
            items: [
              "Unlimited users, console seats and teams for your customers",
              "Passwords, passkeys and single sign-on",
              ...catalog.core.authentication.filter((label) => /up to|1 free/.test(label)),
              "Active users and API requests never billed",
              "Any available region for each project",
              `${free.limits.requests_per_second_per_project} API requests a second per project, ${pro.limits.requests_per_second_per_project} with any add-on`,
            ],
          },
          {
            heading: "Add-ons:",
            plain: true,
            // Priced while it works; one still to come shows its status instead.
            items: listed.map((hub) => {
              const status = hubStatus(hub);
              if (works(status)) return `${hub.label}: ${hubPrice(hub)} / ${hub.base.interval}`;
              return status === "next"
                ? { text: `${hub.label}: planned ${hubPrice(hub)} / ${hub.base.interval}`, status }
                : { text: hub.label, status };
            }),
          },
        ]}
        action={{ label: "Start building", href: links.quickstart }}
        featured
      />
      <Card
        name={enterprise.label}
        price="Custom"
        line={`The same add-ons on an annual commitment. ${sentence(enterprise.preview)}`}
        lists={[
          {
            heading: `All ${pro.label} add-ons, plus:`,
            items: [
              {
                text: `Compliance: ${[firstCompliance, ...moreCompliance.map(lowerFirst)].join(", ")}`,
                status: combine(enterprise.compliance.map(featureStatus)),
              },
              ...(enterprise.sla
                ? [
                    `${enterprise.sla.target_percent}% uptime SLA with service credits, 99.99% on request`,
                  ]
                : []),
              capitalize(enterprise.support),
              ...(keys ? [keys.label] : []),
              `${days(enterprise.event_retention_days)} of audit events`,
              "Dedicated infrastructure and self-hosted, on request",
              ...(addendum ? [addendum.label] : []),
            ],
          },
        ]}
        action={{ label: "Contact us", href: links.contact }}
      />
    </div>
  );
}

/**
 * A card per add-on that works today, at least in part, then what's coming:
 * an add-on still to come shows what it will do and asks who needs it, with
 * no price until it is Coming next.
 */
function Hubs({ catalog }: { catalog: Catalog }) {
  const working = catalog.hubs.filter((hub) => works(hubStatus(hub)));
  const coming = catalog.hubs.filter((hub) => !works(hubStatus(hub)));
  return (
    <>
      <div className="mt-4 grid gap-4 md:grid-cols-2">
        {working.map((hub) => (
          <HubCard key={hub.id} hub={hub} catalog={catalog} />
        ))}
      </div>
      <p className="mt-4 text-sm text-text-secondary leading-6">
        {sentence(catalog.conventions.roadmap)}
      </p>
      {coming.length > 0 && (
        <div className="mt-12">
          <h3 className="font-heading text-2xl text-text-primary leading-tight">What's coming</h3>
          <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {coming.map((hub) => (
              <ComingCard key={hub.id} hub={hub} />
            ))}
          </div>
        </div>
      )}
    </>
  );
}

/** An add-on still to come: what it will do, its status, and who to tell. */
function ComingCard({ hub }: { hub: Hub }) {
  const status = hubStatus(hub);
  return (
    <article className="flex flex-col rounded-2xl border border-window-border border-dashed p-5">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <h4 className="font-semibold text-sm text-text-primary leading-5">{hub.label}</h4>
        <StatusTag status={status} />
      </div>
      <p className="mt-3 text-sm text-text-secondary leading-6">{hub.line}</p>
      <ul className="mt-4 flex flex-col gap-1.5 text-text-muted text-xs leading-5">
        {hub.features.map((feature) => (
          <li key={feature}>{feature}</li>
        ))}
      </ul>
      {(hub.pricing === "quoted" || (status === "next" && hub.base.amount !== null)) && (
        <p className="mt-4 text-text-muted text-xs leading-5">
          {hub.pricing === "quoted"
            ? "Enterprise only"
            : `Planned: ${hubPrice(hub)} / ${hub.base.interval}`}
        </p>
      )}
      <div className="mt-auto pt-6">
        <a href={links.contact} className={SECONDARY}>
          Get early access
        </a>
      </div>
    </article>
  );
}

/** One add-on that works today: its base fee, what it adds and its meters, each with its status. */
function HubCard({ hub, catalog }: { hub: Hub; catalog: Catalog }) {
  const meters = hubMeters(catalog, hub.id);
  const quoted = hub.pricing === "quoted";
  return (
    <article className="flex flex-col rounded-2xl border border-window-border bg-window p-6 shadow-(--window-shadow)">
      <h3 className="font-semibold text-sm text-text-secondary leading-5">{hub.label}</h3>
      <div>
        <p className="mt-3 flex items-baseline gap-1.5">
          <span className="font-heading text-3xl text-text-primary leading-none tracking-[-0.02em]">
            {hubPrice(hub)}
          </span>
          <span className="text-sm text-text-muted">
            {quoted ? "Enterprise only" : `/ ${hub.base.interval}`}
          </span>
        </p>
        <p className="mt-3 min-h-12 text-sm text-text-secondary leading-6">{hub.line}</p>
        <ul className="mt-5 flex flex-col gap-2 text-sm text-text-secondary leading-6">
          {hub.features.map((feature) => (
            <Feature key={feature} text={feature} status={featureStatus(feature)} />
          ))}
        </ul>
        {meters.length > 0 && (
          <dl className="mt-6 flex flex-col gap-3 border-border-primary border-t pt-5 text-sm leading-5">
            {meters.map((meter) => {
              const [price = ""] = meterPrice(meter);
              const status = meterStatus(meter, catalog);
              return (
                <div key={meter.id}>
                  <dt className="flex flex-wrap items-center gap-x-2 gap-y-1 text-text-primary">
                    <span className={works(status) ? undefined : "opacity-55"}>{meter.label}</span>
                    {status !== "available" && <StatusTag status={status} />}
                  </dt>
                  <dd
                    className={`mt-0.5 text-text-muted text-xs leading-5 ${works(status) ? "" : "opacity-55"}`}
                  >
                    {meter.allowance ? `${included(meter, meter.allowance)}, then ` : ""}
                    {price}
                  </dd>
                </div>
              );
            })}
          </dl>
        )}
      </div>
      <div className="mt-auto pt-8">
        <a href={quoted ? links.contact : links.console} className={SECONDARY}>
          {quoted ? "Contact us" : "Turn it on"}
        </a>
      </div>
    </article>
  );
}

/** The production basics: what every add-on includes, whichever is turned on. */
function EveryHub({ catalog }: { catalog: Catalog }) {
  return (
    <div className="mt-8 rounded-2xl border border-window-border border-dashed p-6">
      <h3 className="font-semibold text-sm text-text-secondary leading-5">
        Production basics, with any add-on
      </h3>
      <ul className="mt-4 grid gap-x-6 gap-y-2 text-sm text-text-secondary leading-6 sm:grid-cols-2 lg:grid-cols-3">
        {catalog.hub_includes.map((feature) => (
          <Feature key={feature} text={feature} status={featureStatus(feature)} />
        ))}
      </ul>
    </div>
  );
}

/**
 * The lines on top of the add-ons: capacity and support anyone with an add-on
 * can take at a listed price, and those an Enterprise contract prices.
 */
function ScaleAndSupport({ catalog }: { catalog: Catalog }) {
  const listed = catalog.licensed.filter((line) => line.plans.includes("pro"));
  const contract = catalog.licensed.filter((line) => !line.plans.includes("pro"));
  return (
    <section aria-labelledby="scale" className="mt-20 md:mt-28">
      <h2 id="scale" className={H2}>
        Scale and support
      </h2>
      <p className="mt-4 max-w-2xl text-sm text-text-secondary leading-6">
        {sentence(catalog.conventions.capacity)}
      </p>
      <div className="mt-8 grid gap-4 md:grid-cols-2">
        <article className="rounded-2xl border border-window-border bg-window p-6 shadow-(--window-shadow)">
          <h3 className="font-semibold text-sm text-text-secondary leading-5">With any add-on</h3>
          <dl className="mt-5 flex flex-col gap-4 text-sm leading-6">
            {listed.map((line) => (
              <div key={line.id}>
                <dt className="text-text-primary">{line.label}</dt>
                <dd className="mt-0.5 text-text-muted text-xs leading-5">
                  {capitalize(licensedPrice(line))}
                  {line.note && line.amount !== null ? `. ${sentence(line.note)}` : ""}
                </dd>
              </div>
            ))}
          </dl>
        </article>
        <article className="rounded-2xl border border-window-border bg-window p-6 shadow-(--window-shadow)">
          <h3 className="font-semibold text-sm text-text-secondary leading-5">
            {catalog.plans.enterprise.label}, in the contract
          </h3>
          <ul className="mt-5 flex flex-col gap-2 text-sm text-text-secondary leading-6">
            {contract.map((line) => (
              <Feature key={line.id} text={line.label} status="available" />
            ))}
          </ul>
        </article>
      </div>
    </section>
  );
}

/** A feature with a check, greyed out with its tag while it doesn't work yet. */
function Feature({ text, status }: { text: string; status: FeatureStatus }) {
  return (
    <li className="flex gap-3">
      <span className={`flex gap-3 ${works(status) ? "" : "opacity-55"}`}>
        <Check />
      </span>
      <span>
        <span className={works(status) ? undefined : "opacity-55"}>{text}</span>
        {status !== "available" && (
          <span className="ml-2 align-middle">
            <StatusTag status={status} />
          </span>
        )}
      </span>
    </li>
  );
}

function Check() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 16 16"
      fill="none"
      className="mt-1 size-4 shrink-0 text-success"
    >
      <path
        d="M3.5 8.5l3 3 6-7"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function Card({
  name,
  price,
  per,
  line,
  lists,
  action,
  featured = false,
}: {
  name: string;
  price: string;
  per?: string;
  line: string;
  /**
   * The card's features, in lists each with an optional heading; a plain list,
   * such as prices to choose from, has no check marks.
   */
  lists: {
    heading?: string;
    plain?: boolean;
    items: (string | { text: string; status: FeatureStatus })[];
  }[];
  action: { label: string; href: string };
  featured?: boolean;
}) {
  return (
    <article
      className={`flex flex-col rounded-2xl border bg-window p-6 shadow-(--window-shadow) ${featured ? "border-text-accent/40" : "border-window-border"}`}
    >
      <h3 className="font-semibold text-sm text-text-secondary leading-5">{name}</h3>
      <p className="mt-3 flex items-baseline gap-1.5">
        <span className="font-heading text-4xl text-text-primary leading-none tracking-[-0.02em]">
          {price}
        </span>
        {per && <span className="text-sm text-text-muted">{per}</span>}
      </p>
      <p className="mt-3 min-h-12 text-sm text-text-secondary leading-6">{line}</p>
      {lists.map(({ heading, plain = false, items }) => (
        <div key={heading ?? String(items.length)} className="mt-6">
          {heading && <p className="font-mono text-text-muted text-xs leading-4">{heading}</p>}
          <ul
            className={`flex flex-col ${plain ? "gap-2" : "gap-3"} text-sm text-text-secondary leading-6 ${heading ? "mt-3" : ""}`}
          >
            {items.map((item) => {
              const { text, status } =
                typeof item === "string" ? { text: item, status: "available" as const } : item;
              return (
                <li key={text} className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <span className={`flex gap-3 ${works(status) ? "" : "opacity-55"}`}>
                    {!plain && <Check />}
                    {text}
                  </span>
                  <StatusTag status={status} />
                </li>
              );
            })}
          </ul>
        </div>
      ))}
      <div className="mt-auto pt-8">
        <a href={action.href} className={featured ? PRIMARY : SECONDARY}>
          {action.label}
        </a>
      </div>
    </article>
  );
}

/** Self-hosting works like the cloud: Pay as you go and Enterprise, the same hubs. */
function SelfHosted({ catalog }: { catalog: Catalog }) {
  const { free, hubs, support, enterprise } = catalog.self_hosted;
  return (
    <section aria-labelledby="self-hosted" className="mt-20 md:mt-28">
      <h2 id="self-hosted" className={H2}>
        Self-hosted
      </h2>
      <div className="mt-8 grid gap-4 md:grid-cols-2">
        <Card
          name={`Self-hosted ${catalog.plans.pro.label}`}
          price="$0"
          per={`to start, plus add-ons from ${lowestHub(catalog)} / month`}
          line="The same tier on your own servers, at the cloud's prices."
          lists={[
            {
              heading: `Free under ${free.license}:`,
              items: [
                "Everything Pay as you go includes before an add-on",
                "Unlimited users and installations",
                `${capitalize(free.support)} support`,
              ],
            },
            {
              heading: `Add-ons, ${hubs.license} license, metered by ${hubs.metering}:`,
              items: hubs.includes,
            },
            {
              heading: `${support.label}, a line of their own:`,
              items: [
                `${dollars(support.amount)} a ${support.interval} per ${support.per}`,
                ...(support.note ? [support.note] : []),
              ],
            },
          ]}
          action={{ label: "View on GitHub", href: links.github }}
          featured
        />
        <Card
          name="Self-hosted Enterprise"
          price="Custom"
          line="Contract terms for running it yourself."
          lists={[{ heading: "All self-hosted add-ons, plus:", items: enterprise.includes }]}
          action={{ label: "Contact us", href: links.contact }}
        />
      </div>
    </section>
  );
}

function lowerFirst(text: string): string {
  return text.charAt(0).toLowerCase() + text.slice(1);
}

/** Only what the cards and the table can't say, as questions. */
function Questions({ catalog }: { catalog: Catalog }) {
  const { conventions, plans } = catalog;
  const hub = (id: string) => catalog.hubs.find((entry) => entry.id === id)?.label ?? id;
  const agents = catalog.hubs.find((entry) => entry.id === "agentic");
  const link = "text-text-primary underline underline-offset-4";
  const questions: { question: string; answer: ReactNode }[] = [
    {
      question: "Which add-ons does my app need?",
      answer: (
        <p>
          Consumer apps turn on {hub("consumer")}, business apps {hub("multi_tenancy")}. An app that
          does both turns on both.{" "}
          {agents && works(hubStatus(agents))
            ? `Agents that act for your users turn on ${agents.label}; services need none.`
            : `Services need none, and agents run on the free core until ${hub("agentic")} ships.`}
        </p>
      ),
    },
    {
      question: "Why are users and MFA free?",
      answer: (
        <p>
          A per-user fee for MFA would push apps to build it themselves, and CISA's{" "}
          <a
            href="https://www.cisa.gov/securebydesign"
            className="text-text-primary underline underline-offset-4"
          >
            Secure by Design
          </a>{" "}
          principles call that a hidden tax. Active users and API requests never change your bill.
        </p>
      ),
    },
    {
      question: "How are SSO and social login priced?",
      answer: (
        <p>
          SSO is priced per connection, never per user: an identity provider linked to a team counts
          once a month, whatever its protocol. Social login is priced per user: a user who signs in
          through a provider set up on a project, and not linked to a team, counts once a month in
          that project. Passwords, passkeys, magic links and one-time codes never count, and an SSO
          user never also counts as a social user.
        </p>
      ),
    },
    {
      question: "How are bot checks priced?",
      answer: <p>{sentence(conventions.bot_checks)}</p>,
    },
    {
      question: "What happens when I pass a free amount?",
      answer: (
        <>
          <p>{sentence(plans.free.over_allowance)}</p>
          <p>{sentence(conventions.caps)}</p>
        </>
      ),
    },
    {
      question: "What does the preview cost, and when do these prices start?",
      answer: (
        <p>
          {sentence(conventions.preview)} {sentence(conventions.roadmap)}
        </p>
      ),
    },
    {
      question: "I use Zitadel v4. Which should I use?",
      answer: (
        <p>
          Stay on v4 if your app goes live now or needs a feature the preview doesn't have yet:{" "}
          <a href={links.chooseVersion} className={link}>
            Choose a version
          </a>{" "}
          compares the two, feature by feature. {sentence(plans.enterprise.preview)}{" "}
          <a href={links.contact} className={link}>
            Contact us
          </a>{" "}
          for a quote.
        </p>
      ),
    },
    {
      question: "How is self-hosting priced?",
      answer: <p>{sentence(conventions.self_hosted)}</p>,
    },
  ];
  return (
    <section aria-labelledby="questions" className="mt-20 md:mt-28">
      <h2 id="questions" className={H2}>
        Questions
      </h2>
      <div className="mt-8 border-border-primary border-b">
        {questions.map(({ question, answer }) => (
          <details key={question} className="group border-border-primary border-t">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-6 py-5 text-base text-text-primary leading-7 [&::-webkit-details-marker]:hidden">
              {question}
              <svg
                aria-hidden="true"
                viewBox="0 0 16 16"
                fill="none"
                className="size-4 shrink-0 text-text-muted transition-transform group-open:rotate-45"
              >
                <path
                  d="M8 3v10M3 8h10"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                />
              </svg>
            </summary>
            <div className="flex max-w-3xl flex-col gap-3 pb-6 text-base text-text-secondary leading-7">
              {answer}
            </div>
          </details>
        ))}
      </div>
    </section>
  );
}
