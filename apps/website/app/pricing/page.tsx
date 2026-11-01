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
  dollars,
  type Meter,
  mostPer,
  readCatalog,
  sentence,
  short,
} from "./catalog";
import { compareGroups } from "./compare";
import { CompareTable } from "./compare-table";

// Built from the repository (catalog.ts), so a deploy brings the prices the
// cloud bills from; nothing is read per visit. Laid out like the pricing
// pages people know: plans, a capability comparison with use-case guidance,
// then the questions for billing details.
export const dynamic = "force-static";

const title = "Pricing — Zitadel preview";
const description =
  "Core identity and basic MFA are free. Pay for advanced controls, audit capabilities and services, with no MAU-based upgrades.";

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
            Identity and core security are free
          </h1>
          <p className="mt-4 max-w-2xl text-base text-text-secondary leading-7 md:text-lg md:leading-8">
            Users, teams and basic MFA stay free as you grow. Pay for advanced controls, audit
            capabilities and the services your business needs.
          </p>

          <CloudPlans catalog={catalog} />
          <p className="mt-6 text-center text-text-muted text-xs leading-5">
            All prices in {catalog.currency.toUpperCase()}, before taxes.
          </p>

          <section aria-labelledby="compare" className="mt-20 md:mt-28">
            <h2 id="compare" className={H2}>
              Compare plans
            </h2>
            <CompareTable
              groups={compareGroups(catalog)}
              prices={{
                free: "$0",
                pro: `${dollars(catalog.plans.pro.minimum.amount)} / ${catalog.plans.pro.minimum.interval} + usage`,
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

/** The cloud's three plans as cards, each adding to the one before it. */
function CloudPlans({ catalog }: { catalog: Catalog }) {
  const { free, pro, enterprise } = catalog.plans;
  const addendum = catalog.licensed.find((line) => line.id === "addendum");
  const [proSupport = ""] = pro.support.split("; ");
  return (
    <div className="mt-12 grid gap-4 md:grid-cols-3">
      <Card
        name={free.label}
        price="$0"
        per="/ month"
        line="For building and launching, no card needed."
        features={[
          "Unlimited users, teams and console seats",
          "Passkeys, TOTP MFA and basic require-MFA",
          "No active-user upgrade thresholds",
          `Choose a region per ${free.regions.scope}`,
          `${free.event_retention_days} days of audit events`,
          "The dev inbox or your own email provider",
          "Community support",
        ]}
        action={{ label: "Start building", href: links.quickstart }}
      />
      <Card
        name={pro.label}
        price={dollars(pro.minimum.amount)}
        per={`/ ${pro.minimum.interval} + usage`}
        line="Advanced controls and operational tools for growing businesses."
        includes={`All ${free.label} features, plus:`}
        features={[
          "Conditional policies and delegated administration",
          `${pro.limits.requests_per_second_per_project} RPS per project`,
          "Managed email and SMS",
          "Remove the Zitadel mark",
          `${pro.event_retention_days} days of audit events`,
          ...(pro.sla
            ? [`${pro.sla.target_percent}% availability ${pro.sla.credits ? "SLA" : "target"}`]
            : []),
          capitalize(proSupport),
        ]}
        action={{ label: "View the console", href: links.console }}
        featured
      />
      <Card
        name={enterprise.label}
        price="Custom"
        line="An annual agreement for audit, support and contractual commitments."
        includes={`All ${pro.label} features, plus:`}
        features={[
          ...(enterprise.event_retention_days > pro.event_retention_days
            ? [`${enterprise.event_retention_days} days of audit events`]
            : []),
          "Extended audit retention and reporting, by agreement",
          "A dedicated deployment, on request",
          ...(enterprise.sla
            ? [`${enterprise.sla.target_percent}% uptime SLA with service credits`]
            : []),
          capitalize(enterprise.support),
          ...(addendum ? [addendum.label] : []),
        ]}
        action={{ label: "Contact us", href: links.contact }}
      />
    </div>
  );
}

function Card({
  name,
  price,
  per,
  line,
  includes,
  features,
  action,
  featured = false,
}: {
  name: string;
  price: string;
  per?: string;
  line: string;
  /** Heads the features of a plan that adds to another. */
  includes?: string;
  features: string[];
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
      {includes && <p className="mt-6 font-mono text-text-muted text-xs leading-4">{includes}</p>}
      <ul
        className={`flex flex-col gap-3 text-sm text-text-secondary leading-6 ${includes ? "mt-3" : "mt-6"}`}
      >
        {features.map((feature) => (
          <li key={feature} className="flex gap-3">
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
            {feature}
          </li>
        ))}
      </ul>
      <div className="mt-auto pt-8">
        <a href={action.href} className={featured ? PRIMARY : SECONDARY}>
          {action.label}
        </a>
      </div>
    </article>
  );
}

/** Self-hosting's three steps, priced per installation. */
function SelfHosted({ catalog }: { catalog: Catalog }) {
  const { free, pro, enterprise } = catalog.self_hosted;
  const lowest = Math.min(...pro.prices.map(({ amount }) => amount));
  return (
    <section aria-labelledby="self-hosted" className="mt-20 md:mt-28">
      <h2 id="self-hosted" className={H2}>
        Self-hosted
      </h2>
      <p className="mt-4 max-w-2xl text-base text-text-secondary leading-7">
        Run Zitadel yourself, priced per production installation.
      </p>
      <div className="mt-8 grid gap-4 md:grid-cols-3">
        <Card
          name="Open source"
          price="$0"
          line={`${free.license}, on your own servers.`}
          features={["Every feature", `${capitalize(free.support)} support`]}
          action={{ label: "View on GitHub", href: links.github }}
        />
        <Card
          name="Self-hosted Pro"
          price={dollars(lowest)}
          per={`/ ${pro.prices[0]?.interval ?? "year"}`}
          line="The commercial license and tickets, by card."
          includes="Per production installation:"
          features={[
            ...pro.prices.map(
              ({ installations_up_to: upTo, amount, interval }) =>
                `${upTo === 1 ? "1 installation" : `Up to ${upTo}`}: ${dollars(amount)} a ${interval}`,
            ),
            ...pro.includes.map(capitalize),
            `${pro.ticket_cap_per_year} tickets a year`,
          ]}
          action={{ label: "Buy in the console", href: links.console }}
          featured
        />
        <Card
          name="Self-hosted Enterprise"
          price="Custom"
          line="Contract terms for running it yourself."
          includes="All Self-hosted Pro features, plus:"
          features={enterprise.includes.map(capitalize)}
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
  const requests = catalog.meters.find((meter) => meter.id === "api_requests");
  const counted = catalog.meters.filter((meter) => meter.price !== null);
  const sso = catalog.meters.find((meter) => meter.id === "sso_users");
  const directories = catalog.meters.find((meter) => meter.id === "directory_users");
  const terms = (meter?: Meter) =>
    JSON.stringify([meter?.price, meter?.allowance, meter?.counted_per?.at_most]);
  const directoriesAlike = directories !== undefined && terms(directories) === terms(sso);
  const compliance = catalog.packages.find((entry) => entry.id === "compliance");
  const [unitName, unitMeaning] = catalog.self_hosted.unit.split(": ");
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
      question: `How is ${pro.label} billed?`,
      answer: (
        <>
          <p>
            {pro.label} includes Governance for {dollars(pro.minimum.amount)} a{" "}
            {pro.minimum.interval}, plus metered integrations and consumption beyond the included
            allowances. The base fee is not usage credit. An owner must choose a paid plan before
            billing starts.
          </p>
          <p>
            The invoice is <code className="font-mono text-sm text-text-primary">{formula}</code>
            {why.length > 0 ? `: ${why.join("; ")}` : "."}
          </p>
        </>
      ),
    },
    {
      question: "Do more users or basic MFA trigger an upgrade?",
      answer: (
        <p>
          {catalog.core.billing} Basic require-MFA enforcement is included, with no per-user or
          per-policy fee.
        </p>
      ),
    },
    {
      question: "Which advanced capabilities are paid?",
      answer: (
        <>
          <p>{conventions.packages}</p>
          {catalog.packages.map((entry) => (
            <p key={entry.id}>
              <strong>{entry.label}:</strong> {entry.features.join(", ")}. {entry.note}
            </p>
          ))}
        </>
      ),
    },
    {
      question: "Are all proposed features available today?",
      answer: (
        <p>
          No. This page describes proposed packaging. Governance and Compliance are planned
          packages; availability and contract terms must be confirmed before purchase.
        </p>
      ),
    },
    {
      question: "What do integration user counts mean?",
      answer: <p>{conventions.user_meters}</p>,
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
      question: "Are the allowances the same on every plan?",
      answer: <p>{sentence(conventions.allowance)}</p>,
    },
    {
      question: `What happens when ${free.label} reaches an allowance?`,
      answer: <p>{sentence(free.over_allowance)}</p>,
    },
    {
      question: "Can I cap what I spend?",
      answer: <p>{sentence(conventions.caps)}</p>,
    },
    {
      question: "Do teams and console seats cost anything?",
      answer: (
        <p>
          No, on every plan: a customer never pays for its own seats, nor for the teams it runs for
          its own customers.
        </p>
      ),
    },
    ...(sso?.price?.model === "per_unit" && sso.counted_per
      ? [
          {
            question: "How is SSO priced?",
            answer: (
              <p>
                Per user who signs in through an enterprise connection: {count(sso.allowance ?? 0)}{" "}
                a month are free, then {dollars(sso.price.unit_amount)} each. A connection counts at
                most {count(sso.counted_per.at_most)} of its users, so it costs at most{" "}
                {dollars(mostPer(sso) ?? 0)} a month, however large the customer behind it.{" "}
                {directoriesAlike ? "Directory sync is priced the same way, per directory. " : ""}
                Connections themselves cost nothing.
              </p>
            ),
          },
        ]
      : []),
    ...(requests
      ? [
          {
            question: "Are API requests billed?",
            answer: (
              <p>
                No: {requests.counts.replace(/^Each request; /, "they are ")}. {free.label} allows{" "}
                {free.limits.requests_per_second_per_project} requests a second per project and{" "}
                {short(free.limits.requests_per_month_per_account)} a month per account; past that,{" "}
                {free.limits.past_monthly_ceiling}. {pro.label} includes{" "}
                {pro.limits.requests_per_second_per_project} requests a second per project.
                Enterprise capacity is agreed in the contract.
              </p>
            ),
          },
        ]
      : []),
    {
      question: "Can I choose where each project runs?",
      answer: (
        <p>
          Yes. Every plan includes a choice of the available regions for each project. Region
          selection is separate from a dedicated deployment, which is available by agreement on
          Enterprise.
        </p>
      ),
    },
    {
      question: "Do I pay for my login's domain?",
      answer: (
        <p>
          No. The login is a component that runs in your own app, so it serves from your domain, on
          every plan.
        </p>
      ),
    },
    {
      question: "How long are audit events kept?",
      answer: (
        <p>
          {(["free", "pro", "enterprise"] as const)
            .map((plan) => `${plans[plan].label} keeps ${plans[plan].event_retention_days} days`)
            .join(", ")}
          . {compliance?.note} {compliance?.retention_days?.join(" or ")}-day retention is scoped in
          the Compliance quote.
        </p>
      ),
    },
    {
      question: "What is billed on top of the Pro base fee?",
      answer: (
        <p>
          Metered integrations and consumption beyond the included allowances, plus contracted
          Compliance packages and support add-ons. Governance is included in Pro and is never
          charged per user or policy.
        </p>
      ),
    },
    {
      question: "How is Enterprise priced?",
      answer: (
        <p>
          Per contract: an annual commitment for agreed packages, capacity and operational
          assurance. Included consumption and any overages are set in the quote.{" "}
          <a href={links.contact} className="text-text-primary underline underline-offset-4">
            Contact us
          </a>{" "}
          for a quote.
        </p>
      ),
    },
    {
      question: "How is self-hosting priced?",
      answer: (
        <p>
          {sentence(conventions.self_hosted)}{" "}
          {unitMeaning ? `A ${unitName} is ${unitMeaning}.` : ""}
        </p>
      ),
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
