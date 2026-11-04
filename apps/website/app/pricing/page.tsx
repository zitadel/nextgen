import type { Metadata } from "next";
import type { ReactNode } from "react";
import { links } from "../links";
import og from "../og.jpg";
import { SiteFooter } from "../site-footer";
import { SiteHeader } from "../site-header";
import {
  type Catalog,
  capitalize,
  count,
  days,
  dollars,
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
  "Pay as you go starts free with users and MFA included. Add-ons cover what your app needs: Consumer, Multi-Tenancy, Agentic, Security Analytics and more, each with one base fee.";

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

const DATE = new Intl.DateTimeFormat("en-US", { dateStyle: "long", timeZone: "UTC" });

const H2 = "font-heading text-3xl text-text-primary leading-tight tracking-[-0.02em] md:text-4xl";
const BUTTON =
  "flex h-11 items-center justify-center rounded-lg px-5 font-semibold text-sm transition-colors";
const PRIMARY = `${BUTTON} bg-text-primary text-background hover:opacity-85`;
const SECONDARY = `${BUTTON} border border-window-border bg-tint/[0.03] text-text-primary hover:bg-tint/[0.07]`;

export default function PricingPage() {
  const catalog = readCatalog();
  const proposal = catalog.status === "proposal";
  return (
    <>
      <SiteHeader current="pricing" />
      <main className="px-6 pt-12 pb-20 md:pt-20 md:pb-28">
        <div className="mx-auto max-w-6xl">
          {proposal && (
            <p className="inline-flex rounded-full bg-tint/10 px-3 py-1 font-semibold text-text-secondary text-xs leading-5">
              A proposal as of {proposalDate(catalog)}: nothing is billed yet, and prices may change
              before launch
            </p>
          )}
          <h1 className="mt-6 max-w-3xl font-heading text-4xl text-text-primary leading-tight tracking-[-0.025em] md:text-6xl">
            Start free. Add what your app needs.
          </h1>
          <p className="mt-4 max-w-2xl text-base text-text-secondary leading-7 md:text-lg md:leading-8">
            Pay as you go starts at $0 with no card: users, MFA and Zitadel's secure defaults are
            included. When your app needs more, turn on an add-on: consumer sign-in at scale, your
            customers' SSO, agents, security analytics. Each has one base fee. Enterprise brings the
            same add-ons under an annual contract.
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

function proposalDate(catalog: Catalog): string {
  return DATE.format(new Date(catalog.version.slice(0, 10)));
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
            items: listed.map((hub) => `${hub.label}: ${hubPrice(hub)} / ${hub.base.interval}`),
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
              ...quoted.map((hub) => `The ${hub.label} add-on`),
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

function HubCard({ hub, catalog }: { hub: Hub; catalog: Catalog }) {
  const meters = hubMeters(catalog, hub.id);
  const quoted = hub.pricing === "quoted";
  return (
    <article className="flex flex-col rounded-2xl border border-window-border bg-window p-6 shadow-(--window-shadow)">
      <div className="flex items-start justify-between gap-3">
        <h3 className="font-semibold text-sm text-text-secondary leading-5">{hub.label}</h3>
        {hub.availability === "planned" && <Badge>Planned</Badge>}
      </div>
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
              {hub.planned_part === feature && hub.availability !== "planned" && (
                <span className="ml-2 align-middle">
                  <Badge>Planned</Badge>
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
                  {meter.allowance ? `${included(meter, meter.allowance)} included, then ` : ""}
                  {price}
                  {meter.free_allowance
                    ? ` · ${included(meter, meter.free_allowance)} free without the add-on`
                    : ""}
                </dd>
              </div>
            );
          })}
        </dl>
      )}
      <div className="mt-auto pt-8">
        <a href={quoted ? links.contact : links.console} className={SECONDARY}>
          {quoted ? "Contact us" : "Turn it on"}
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

function Badge({ children }: { children: ReactNode }) {
  return (
    <span className="inline-flex shrink-0 rounded-full bg-tint/10 px-2 py-0.5 font-semibold text-[0.6875rem] text-text-muted leading-4">
      {children}
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
  lists: { heading?: string; items: string[] }[];
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
        <div key={heading ?? items[0]} className="mt-6">
          {heading && <p className="font-mono text-text-muted text-xs leading-4">{heading}</p>}
          <ul
            className={`flex flex-col gap-3 text-sm text-text-secondary leading-6 ${heading ? "mt-3" : ""}`}
          >
            {items.map((item) => (
              <li key={item} className="flex gap-3">
                <Check />
                {item}
              </li>
            ))}
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

/** Every explanation of the page, as questions. */
function Questions({ catalog }: { catalog: Catalog }) {
  const { conventions, plans } = catalog;
  const { pro, free } = plans;
  const [formula, ...why] = conventions.invoice.split("; ");
  const counted = catalog.meters.filter((meter) => meter.price !== null);
  const social = catalog.meters.find((meter) => meter.id === "social_users");
  const sso = catalog.meters.find((meter) => meter.id === "sso_connections");
  const capacity = catalog.licensed.find((line) => line.id === "extra_capacity");
  const planned = [
    ...catalog.hubs
      .filter((hub) => hub.availability === "planned" || hub.planned_part)
      .map((hub) =>
        hub.availability === "planned" ? `the ${hub.label} add-on` : hub.planned_part,
      ),
  ];
  const questions: { question: string; answer: ReactNode }[] = [
    ...(catalog.status === "proposal"
      ? [
          {
            question: "Is this pricing final?",
            answer: (
              <p>
                No. It is a proposal as of {proposalDate(catalog)}: nothing is billed during the
                preview, and prices may change before launch.
              </p>
            ),
          },
        ]
      : []),
    {
      question: "Which add-ons does my app need?",
      answer: (
        <>
          <p>
            <strong>Consumer apps:</strong> {pro.label} includes users, every sign-in method and
            required MFA. Turn on Consumer Identity for social login at scale and more than one
            brand.
          </p>
          <p>
            <strong>Business apps:</strong> turn on Multi-Tenancy for your customers' SSO,
            directories and branding per team.
          </p>
          <p>
            <strong>Agents and services:</strong> turn on Agentic &amp; Non-Human Identity for
            delegated tokens, consent and quotas.
          </p>
          <p>
            Add Security Analytics for account-takeover detection, and Extensibility for actions and
            webhooks. Apps that do several things turn on several add-ons.
          </p>
        </>
      ),
    },
    {
      question: `How is ${pro.label} billed?`,
      answer: (
        <>
          <p>{sentence(conventions.hubs)}</p>
          <p>
            The invoice is <code className="font-mono text-sm text-text-primary">{formula}</code>
            {why.length > 0 ? `: ${why.join("; ")}` : "."}
          </p>
        </>
      ),
    },
    {
      question: "Why are users and MFA free?",
      answer: (
        <>
          <p>{catalog.core.billing}</p>
          <p>
            Requiring MFA for everyone is included in every tier, with no per-user fee. A charge
            would push apps to enforce MFA in their own code, and CISA's{" "}
            <a
              href="https://www.cisa.gov/securebydesign"
              className="text-text-primary underline underline-offset-4"
            >
              Secure by Design
            </a>{" "}
            principles count it as a hidden tax.
          </p>
        </>
      ),
    },
    ...(social?.price?.model === "per_unit" && social.allowance && social.free_allowance
      ? [
          {
            question: "Why is social login metered, but passwords and passkeys aren't?",
            answer: (
              <p>
                Passwords, passkeys, magic links and OTP never count. A social user is one who signs
                in through an external provider in a month: {count(social.free_allowance)} are free
                without an add-on, the Consumer Identity add-on includes {count(social.allowance)},
                then {dollars(social.price.unit_amount)} each. Any external provider counts,
                including Google set up as a generic OIDC provider, but a provider linked to a team
                is an SSO connection, priced by Multi-Tenancy, never twice.
              </p>
            ),
          },
        ]
      : []),
    ...(sso?.price?.model === "per_unit"
      ? [
          {
            question: "How is SSO priced?",
            answer: (
              <p>
                Per connection, never per user: any identity provider linked to a team is a
                connection, whatever its protocol, and counts in a month it signs someone in.{" "}
                Without an add-on you get {count(sso.free_allowance ?? 0)} to try it; the
                Multi-Tenancy add-on includes {count(sso.allowance ?? 0)}, then{" "}
                {dollars(sso.price.unit_amount)} each a month, however large the customer behind it.
                Directory sync is priced the same way, per directory.
              </p>
            ),
          },
        ]
      : []),
    {
      question: "Is impersonation priced?",
      answer: (
        <p>
          Two kinds, priced apart. Support impersonation, your staff acting as a user to help them,
          has a free amount and is included in every add-on, with an audit trail. Delegation, an
          agent or service acting for a user through a token exchange, has a free amount and is
          metered in the Agentic &amp; Non-Human Identity add-on.
        </p>
      ),
    },
    {
      question: "Are all proposed features available today?",
      answer: (
        <p>
          No. What is marked Planned doesn't exist yet, including {planned.join(", ")}. Availability
          and contract terms must be confirmed before purchase.
        </p>
      ),
    },
    {
      question: "What does each meter count?",
      answer: (
        <dl className="grid gap-x-6 gap-y-2 sm:grid-cols-[14rem_1fr]">
          {counted.map((meter) => (
            <div key={meter.id} className="contents">
              <dt className="text-text-primary">{meter.label}</dt>
              <dd>{sentence(meter.counts)}</dd>
            </div>
          ))}
        </dl>
      ),
    },
    {
      question: "How do allowances work?",
      answer: <p>{sentence(conventions.allowance)}</p>,
    },
    {
      question: `What happens at a free amount before an add-on is on?`,
      answer: <p>{sentence(free.over_allowance)}</p>,
    },
    {
      question: "Are API requests billed?",
      answer: (
        <p>
          No. {sentence(conventions.capacity)} Each project may send up to{" "}
          {free.limits.requests_per_second_per_project} requests a second without an add-on and{" "}
          {pro.limits.requests_per_second_per_project} with any add-on
          {capacity?.amount ? `; each capacity step costs ${dollars(capacity.amount)} a month` : ""}
          .
        </p>
      ),
    },
    {
      question: "Can I cap what I spend?",
      answer: <p>{sentence(conventions.caps)}</p>,
    },
    {
      question: "Do teams and console seats cost anything?",
      answer: (
        <p>
          No, in every tier: a customer never pays for its own seats, nor for the teams it runs for
          its own customers.
        </p>
      ),
    },
    {
      question: "Where do my projects run?",
      answer: (
        <p>
          You choose any available region for each project, in every tier and at no charge.
          Dedicated infrastructure, meaning dedicated database servers and compute, is available by
          agreement on {plans.enterprise.label}.
        </p>
      ),
    },
    {
      question: "How is Enterprise priced?",
      answer: (
        <p>
          Per contract: an annual commitment that covers the add-ons you use at a discount, with
          agreed capacity, the Compliance add-on, an SLA with credits and 24x7 support.{" "}
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
    {
      question: "When are we billed, and in which currency?",
      answer: (
        <p>
          By {conventions.period}, in {catalog.currency.toUpperCase()} and before taxes. These
          prices are the price list <span className="font-mono">{catalog.version}</span>.
        </p>
      ),
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
