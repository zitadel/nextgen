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
  licensedPrice,
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
// pages people know: the plans as cards, then every price compared by
// audience, then the questions, which hold every explanation.
export const dynamic = "force-static";

const title = "Pricing — Zitadel preview";
const description =
  "Users, teams and seats stay free. Pay for the features you turn on, per user each one touches, against a monthly minimum that works as credit.";

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
              before they are
            </p>
          )}
          <h1 className="mt-6 max-w-3xl font-heading text-4xl text-text-primary leading-tight tracking-[-0.025em] md:text-6xl">
            Pay for features, not for users
          </h1>
          <p className="mt-4 max-w-2xl text-base text-text-secondary leading-7 md:text-lg md:leading-8">
            Users, teams and seats stay free. You pay for the features you turn on, per user each
            one touches.
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
                pro: `${dollars(catalog.plans.pro.minimum.amount)} / ${catalog.plans.pro.minimum.interval}`,
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
  const mau = catalog.meters.find((meter) => meter.id === "monthly_active_users");
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
          `Up to ${short(free.limits.core_mau_sized_for)} monthly active users`,
          "Unlimited teams and console seats",
          `${free.event_retention_days} days of audit events`,
          "The dev inbox or your own email provider",
          "Community support",
        ]}
        action={{ label: "Start building", href: links.quickstart }}
      />
      <Card
        name={pro.label}
        price={dollars(pro.minimum.amount)}
        per={`/ ${pro.minimum.interval}`}
        line={`All of it credit for usage, or ${dollars(pro.annual.amount)} a ${pro.annual.interval}.`}
        includes={`All ${free.label} features, plus:`}
        features={[
          ...(mau?.allowance ? [`${short(mau.allowance)} monthly active users included`] : []),
          "Managed email and SMS",
          "No Zitadel mark on your login",
          `${pro.event_retention_days} days of audit events`,
          ...(pro.sla ? [`${pro.sla.target_percent}% uptime SLA`] : []),
          capitalize(proSupport),
        ]}
        action={{ label: "Upgrade in the console", href: links.console }}
        featured
      />
      <Card
        name={enterprise.label}
        price="Custom"
        line="Contract rates on every meter, as a yearly commitment."
        includes={`All ${pro.label} features, plus:`}
        features={[
          ...(enterprise.event_retention_days > pro.event_retention_days
            ? [`${enterprise.event_retention_days} days of audit events`]
            : []),
          typeof enterprise.regions === "string"
            ? capitalize(enterprise.regions.split("; ")[0] ?? enterprise.regions)
            : "Your choice of region",
          "A dedicated deployment, on request",
          "Uptime SLA with service credits",
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
  const sink = catalog.licensed.find((line) => line.id === "event_sink");
  const [unitName, unitMeaning] = catalog.self_hosted.unit.split(": ");
  const questions: { question: string; answer: ReactNode }[] = [
    ...(catalog.status === "proposal"
      ? [
          {
            question: "Is this pricing final?",
            answer: (
              <p>
                No. It is a proposal as of {proposalDate(catalog)}: nothing is billed during the
                preview, and prices may change before they are.
              </p>
            ),
          },
        ]
      : []),
    {
      question: `How does ${pro.label}'s minimum work?`,
      answer: (
        <>
          <p>
            {pro.label} bills at least {dollars(pro.minimum.amount)} a {pro.minimum.interval}, or{" "}
            {dollars(pro.annual.amount)} a {pro.annual.interval}, and all of it is credit: what the
            meters use draws on it first, and only usage past it is billed.
          </p>
          <p>
            The invoice is <code className="font-mono text-sm text-text-primary">{formula}</code>
            {why.length > 0 ? `: ${why.join("; ")}` : "."}
          </p>
        </>
      ),
    },
    {
      question: "What counts as a user?",
      answer: <p>{sentence(conventions.user_meters)}</p>,
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
                {free.limits.past_monthly_ceiling}.
              </p>
            ),
          },
        ]
      : []),
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
          . Longer retention is an add-on, priced per user whose events are kept, with events pooled
          per user.
          {sink ? ` Or stream them to your SIEM and keep them there: ${licensedPrice(sink)}.` : ""}
        </p>
      ),
    },
    {
      question: "What is billed on top of the minimum?",
      answer: (
        <p>
          Compliance and support. They are lines of their own and never draw on the credit, so they
          never vanish into the minimum.
        </p>
      ),
    },
    {
      question: "How is Enterprise priced?",
      answer: (
        <p>
          Per contract: a yearly commitment, all of it credit for the meters, at rates below the
          list prices.{" "}
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
