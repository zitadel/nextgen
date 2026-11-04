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
  type Hub,
  hubMeters,
  hubPrice,
  included,
  meterPrice,
  readCatalog,
  sentence,
} from "./catalog";
import { compareGroups, lowestHub } from "./compare";
import { CompareTable } from "./compare-table";

// Built from the repository (catalog.ts), so a deploy brings the prices the
// cloud bills from; nothing is read per visit. Laid out like the pricing
// pages people know: the tiers, the add-ons you turn on, a capability
// comparison, then the questions for billing details.
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

          <Tiers catalog={catalog} />

          <section aria-labelledby="add-ons" className="mt-20 md:mt-28">
            <h2 id="add-ons" className={H2}>
              Add-ons
            </h2>
            <EveryHub catalog={catalog} />
            <Hubs catalog={catalog} />
          </section>
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
  const quoted = catalog.hubs.filter((hub) => hub.pricing === "quoted");
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
              "Unlimited users, teams and console seats",
              "Passwords, passkeys, TOTP and required MFA",
              ...catalog.core.authentication.filter((label) => /up to|One /.test(label)),
              "Active users and API requests never billed",
              "Any available region for each project",
              `${free.limits.requests_per_second_per_project} API requests a second per project, ${pro.limits.requests_per_second_per_project} with any add-on`,
            ],
          },
          {
            heading: "Add-ons:",
            items: listed.map((hub) => ({
              text: `${hub.label}: ${hubPrice(hub)} / ${hub.base.interval}`,
              soon: hub.availability === "planned",
            })),
          },
        ]}
        action={{ label: "Start building", href: links.quickstart }}
        featured
      />
      <Card
        name={enterprise.label}
        price="Custom"
        line="The same add-ons on an annual commitment, with the assurance a contract needs."
        lists={[
          {
            heading: `All ${pro.label} add-ons, plus:`,
            items: [
              ...quoted.map((hub) => ({
                text: `The ${hub.label} add-on`,
                soon: hub.availability === "planned",
              })),
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

/** One card per hub: its base fee, what it adds and its meters. */
function Hubs({ catalog }: { catalog: Catalog }) {
  return (
    <div className="mt-4 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
      {catalog.hubs.map((hub) => (
        <HubCard key={hub.id} hub={hub} catalog={catalog} />
      ))}
    </div>
  );
}

/**
 * One add-on: its base fee, what it adds and its meters. One that isn't built
 * yet is greyed out under a Coming soon tag, and asks to hear who needs it.
 */
function HubCard({ hub, catalog }: { hub: Hub; catalog: Catalog }) {
  const meters = hubMeters(catalog, hub.id);
  const quoted = hub.pricing === "quoted";
  const soon = hub.availability === "planned";
  return (
    <article
      className={`flex flex-col rounded-2xl border p-6 ${soon ? "border-window-border border-dashed bg-transparent" : "border-window-border bg-window shadow-(--window-shadow)"}`}
    >
      <div className="flex items-start justify-between gap-3">
        <h3 className="font-semibold text-sm text-text-secondary leading-5">{hub.label}</h3>
        {soon && <Soon />}
      </div>
      <div className={soon ? "opacity-55" : undefined}>
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
            <li key={feature} className="flex gap-3">
              <Check />
              <span>
                {feature}
                {hub.planned_part === feature && !soon && (
                  <span className="ml-2 align-middle">
                    <Soon />
                  </span>
                )}
              </span>
            </li>
          ))}
        </ul>
        {meters.length > 0 && (
          <dl className="mt-6 flex flex-col gap-3 border-border-primary border-t pt-5 text-sm leading-5">
            {meters.map((meter) => {
              const [price = ""] = meterPrice(meter);
              return (
                <div key={meter.id}>
                  <dt className="text-text-primary">{meter.label}</dt>
                  <dd className="mt-0.5 text-text-muted text-xs leading-5">
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
        <a href={quoted || soon ? links.contact : links.console} className={SECONDARY}>
          {soon ? "Tell us you need it" : quoted ? "Contact us" : "Turn it on"}
        </a>
      </div>
    </article>
  );
}

/** What every add-on includes, whichever is turned on. */
function EveryHub({ catalog }: { catalog: Catalog }) {
  return (
    <div className="mt-8 rounded-2xl border border-window-border border-dashed p-6">
      <h3 className="font-semibold text-sm text-text-secondary leading-5">Every add-on includes</h3>
      <ul className="mt-4 grid gap-x-6 gap-y-2 text-sm text-text-secondary leading-6 sm:grid-cols-2 lg:grid-cols-3">
        {catalog.hub_includes.map((feature) => (
          <li key={feature} className="flex gap-3">
            <Check />
            {feature}
          </li>
        ))}
      </ul>
    </div>
  );
}

/** The tag on what isn't built yet. */
function Soon() {
  return (
    <span className="inline-flex shrink-0 rounded-full bg-text-accent/10 px-2 py-0.5 font-semibold text-[0.6875rem] text-text-accent leading-4">
      Coming soon
    </span>
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
  /** The card's features, in lists each with an optional heading. */
  lists: { heading?: string; items: (string | { text: string; soon: boolean })[] }[];
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
      {lists.map(({ heading, items }) => (
        <div key={heading ?? String(items.length)} className="mt-6">
          {heading && <p className="font-mono text-text-muted text-xs leading-4">{heading}</p>}
          <ul
            className={`flex flex-col gap-3 text-sm text-text-secondary leading-6 ${heading ? "mt-3" : ""}`}
          >
            {items.map((item) => {
              const { text, soon } = typeof item === "string" ? { text: item, soon: false } : item;
              return (
                <li key={text} className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <span className={`flex gap-3 ${soon ? "opacity-55" : ""}`}>
                    <Check />
                    {text}
                  </span>
                  {soon && <Soon />}
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
  const { free, hubs, enterprise } = catalog.self_hosted;
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

/** Only what the cards and the table can't say, as questions. */
function Questions({ catalog }: { catalog: Catalog }) {
  const { conventions, plans } = catalog;
  const hub = (id: string) => catalog.hubs.find((entry) => entry.id === id)?.label ?? id;
  const questions: { question: string; answer: ReactNode }[] = [
    {
      question: "Which add-ons does my app need?",
      answer: (
        <p>
          Consumer apps turn on {hub("consumer")}, business apps {hub("multi_tenancy")}, agents and
          services {hub("agentic")}. An app that does several things turns on several.
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
          SSO is priced per connection, never per user: any identity provider linked to a team
          counts, whatever its protocol. Social login is priced per user a month, for providers on a
          project and not linked to a team. Passwords, passkeys, magic links and OTP never count,
          and no sign-in counts twice.
        </p>
      ),
    },
    {
      question: "What happens past a free amount?",
      answer: (
        <>
          <p>{sentence(plans.free.over_allowance)}</p>
          <p>{sentence(conventions.caps)}</p>
        </>
      ),
    },
    {
      question: "How is Enterprise priced?",
      answer: (
        <p>
          Per contract: an annual commitment for the add-ons you use, with agreed capacity, the{" "}
          {hub("compliance")} add-on, an SLA with credits and 24x7 support.{" "}
          <a href={links.contact} className="text-text-primary underline underline-offset-4">
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
