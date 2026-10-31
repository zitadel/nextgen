import type { Metadata } from "next";
import type { ReactNode } from "react";
import { CallToAction } from "../cta";
import { links } from "../links";
import og from "../og.jpg";
import { SiteFooter } from "../site-footer";
import { SiteHeader } from "../site-header";
import {
  type Catalog,
  count,
  dollars,
  licensedPrice,
  listedMeters,
  meterPrice,
  planList,
  readCatalog,
} from "./catalog";

// Built from the repository (catalog.ts), so a deploy brings the prices the
// cloud bills from; nothing is read per visit.
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
const COMPACT = new Intl.NumberFormat("en-US", { notation: "compact" });

const H2 = "font-heading text-3xl text-text-primary leading-tight tracking-[-0.02em] md:text-4xl";
const LEAD = "mt-4 max-w-2xl text-base text-text-secondary leading-7";
const CARD =
  "flex flex-col rounded-2xl border border-window-border bg-window p-6 shadow-(--window-shadow)";
const TH = "py-3 pr-6 text-left font-mono font-normal text-text-muted text-xs leading-4";
const TD = "py-4 pr-6 align-top text-sm leading-6";

export default function PricingPage() {
  const catalog = readCatalog();
  const mau = catalog.meters.find((meter) => meter.id === "monthly_active_users");
  return (
    <>
      <SiteHeader current="pricing" />
      <main className="px-6 pt-12 pb-20 md:pt-20 md:pb-28">
        <div className="mx-auto max-w-6xl">
          {catalog.status === "proposal" && (
            <p className="inline-flex rounded-full bg-tint/10 px-3 py-1 font-semibold text-text-secondary text-xs leading-5">
              A proposal as of {DATE.format(new Date(catalog.version.slice(0, 10)))}: nothing is
              billed yet, and prices may change before they are
            </p>
          )}
          <h1 className="mt-6 font-heading text-4xl text-text-primary leading-tight tracking-[-0.025em] md:text-5xl">
            Pay for features, not for users
          </h1>
          <p className="mt-4 max-w-2xl text-base text-text-secondary leading-7 md:text-lg md:leading-8">
            {mau?.allowance
              ? `The first ${COMPACT.format(mau.allowance)} monthly active users are free on every plan, and so are teams and console seats. `
              : "Teams and console seats are free on every plan. "}
            You pay for the features you turn on, per user each one touches, against a monthly
            minimum that works as credit. Compliance and support are billed on top.
          </p>
          <CallToAction placement="hero" className="mt-8 justify-start" />

          <Plans catalog={catalog} />
          <Bill catalog={catalog} />
          <Meters catalog={catalog} />
          <OnTop catalog={catalog} />
          <SelfHosted catalog={catalog} />

          <p className="mt-16 border-border-primary border-t pt-8 text-sm text-text-muted leading-6">
            Prices in {catalog.currency.toUpperCase()}, before taxes, from the price list{" "}
            <span className="font-mono">{catalog.version}</span>.
          </p>
        </div>
      </main>
      <SiteFooter />
    </>
  );
}

/** The cloud's three plans, side by side. */
function Plans({ catalog }: { catalog: Catalog }) {
  const { free, pro, enterprise } = catalog.plans;
  return (
    <section aria-labelledby="plans" className="mt-16 md:mt-24">
      <h2 id="plans" className={H2}>
        Cloud plans
      </h2>
      <div className="mt-8 grid gap-4 md:grid-cols-3">
        <Plan
          name={free.label}
          price="$0"
          per="No card needed"
          line="For building and launching."
          facts={[
            `Sized for ${count(free.limits.core_mau_sized_for)} monthly active users`,
            `${free.limits.requests_per_second_per_project} requests a second per project, ${COMPACT.format(free.limits.requests_per_month_per_account)} a month per account`,
            ...common(free),
          ]}
        />
        <Plan
          name={pro.label}
          price={dollars(pro.minimum.amount)}
          per={`a ${pro.minimum.interval}, all of it credit for the meters, or ${dollars(pro.annual.amount)} a ${pro.annual.interval}`}
          line="For companies running production."
          facts={[
            `Sized for ${count(pro.limits.core_mau_sized_for)} monthly active users`,
            ...common(pro),
          ]}
          featured
        />
        {/* Enterprise is quoted, never listed: no tier, minimum or rate. */}
        <Plan
          name={enterprise.label}
          price="Custom"
          per="A yearly commitment, all of it credit for the meters, at contract rates"
          line="For contracts, compliance and scale."
          facts={common(enterprise, { quoted: true })}
          contact
        />
      </div>
    </section>
  );
}

/**
 * What every plan states: retention, domains, delivery, the mark, support, the
 * SLA and regions. A `quoted` plan leaves out the SLA's note, which names its
 * tiers.
 */
function common(
  plan: Catalog["plans"][keyof Catalog["plans"]],
  { quoted = false }: { quoted?: boolean } = {},
): string[] {
  const facts = [`${plan.event_retention_days} days of audit events`];
  if (plan.custom_domains_included) {
    facts.push(
      `${plan.custom_domains_included} custom login domain${plan.custom_domains_included > 1 ? "s" : ""}`,
    );
  }
  facts.push(
    plan.delivery_modes.includes("managed")
      ? "Managed email and SMS, or your own provider"
      : "Email through the dev inbox or your own provider",
  );
  facts.push(
    plan.attribution_mark === "shown" ? "Zitadel mark on the login" : "Zitadel mark can be hidden",
  );
  // "by tier: …" reads on from the word; a list of terms takes a colon.
  facts.push(
    plan.support === "community"
      ? "Community support"
      : `Support${plan.support.includes(":") ? " " : ": "}${plan.support}`,
  );
  if (plan.sla) {
    facts.push(
      `${plan.sla.target_percent}% SLA${plan.sla.credits ? " with credits" : ""}${plan.sla.note && !quoted ? `; ${plan.sla.note}` : ""}`,
    );
  }
  facts.push(
    Array.isArray(plan.regions)
      ? `${plan.regions.map((region) => region.toUpperCase()).join(", ")} region`
      : capitalize(plan.regions),
  );
  return facts;
}

function Plan({
  name,
  price,
  per,
  line,
  facts,
  featured = false,
  contact = false,
}: {
  name: string;
  price: string;
  per: string;
  line: string;
  facts: string[];
  featured?: boolean;
  /** Ends the card on the way to a quote. */
  contact?: boolean;
}) {
  return (
    <article className={`${CARD} ${featured ? "ring-1 ring-text-accent/40" : ""}`}>
      <h3 className="font-heading text-2xl text-text-primary leading-tight">{name}</h3>
      <p className="mt-1 text-sm text-text-secondary leading-6">{line}</p>
      <p className="mt-6 font-heading text-4xl text-text-primary leading-none tracking-[-0.02em]">
        {price}
      </p>
      <p className="mt-2 min-h-12 text-sm text-text-muted leading-6">{per}</p>
      <ul className="mt-6 flex flex-col gap-3 border-border-primary border-t pt-6 text-sm text-text-secondary leading-6">
        {facts.map((fact) => (
          <li key={fact} className="flex gap-3">
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
            {fact}
          </li>
        ))}
      </ul>
      {contact && (
        <div className="mt-auto pt-8">
          <a
            href={links.contact}
            className="flex h-11 items-center justify-center rounded-lg border border-window-border bg-tint/[0.03] px-5 font-semibold text-sm text-text-primary transition-colors hover:bg-tint/[0.07]"
          >
            Contact us
          </a>
        </div>
      )}
    </article>
  );
}

/** How the minimum, the meters and the lines on top make one invoice. */
function Bill({ catalog }: { catalog: Catalog }) {
  const { conventions } = catalog;
  // The invoice's rule opens with its formula, which stays as written.
  const [formula, ...why] = conventions.invoice.split("; ");
  const rules: [string, ReactNode][] = [
    [
      "The invoice",
      <>
        <code className="font-mono text-sm text-text-primary">{formula}</code>
        {why.length > 0 && `: ${period(why.join("; "))}`}
      </>,
    ],
    ["Allowances", sentence(conventions.allowance)],
    ["Caps", sentence(conventions.caps)],
    ["The period", sentence(`a ${conventions.period}`)],
  ];
  return (
    <Section
      id="bill"
      title="How a bill adds up"
      lead="The minimum is credit: what the meters use draws on it first, and only usage past it is billed."
    >
      <dl className="mt-8 grid gap-x-12 gap-y-6 md:grid-cols-2">
        {rules.map(([term, rule]) => (
          <div key={term} className="border-border-primary border-t pt-4">
            <dt className="font-mono text-text-muted text-xs leading-4">{term}</dt>
            <dd className="mt-2 text-base text-text-secondary leading-7">{rule}</dd>
          </div>
        ))}
      </dl>
    </Section>
  );
}

/** The meters, each priced past the allowance every plan has. */
function Meters({ catalog }: { catalog: Catalog }) {
  const gauges = catalog.meters.filter((meter) => meter.price === null);
  return (
    <Section
      id="meters"
      title="Features, per user they touch"
      lead={sentence(catalog.conventions.user_meters)}
    >
      <Table head={["Feature", "What counts", "Free each month", "Then"]}>
        {listedMeters(catalog).map((meter) => (
          <tr key={meter.id} className="border-border-primary border-t">
            <td className={`${TD} font-semibold text-text-primary`}>
              {meter.label}
              {meter.plans && (
                <span className="mt-1 block font-normal text-text-muted text-xs leading-5">
                  {planList(meter.plans)} only
                </span>
              )}
            </td>
            <td className={`${TD} text-text-secondary`}>{sentence(meter.counts)}</td>
            <td className={`${TD} whitespace-nowrap text-text-secondary`}>
              {meter.allowance ? count(meter.allowance) : "—"}
            </td>
            <td className={`${TD} text-text-secondary`}>
              {/* The price, then what qualifies it, quieter. */}
              {meterPrice(meter, catalog).map((line, index) => (
                <span key={line} className={`block ${index > 0 ? "text-text-muted" : ""}`}>
                  {line}
                </span>
              ))}
            </td>
          </tr>
        ))}
      </Table>
      {gauges.map((gauge) => (
        <p key={gauge.id} className="mt-4 text-sm text-text-muted leading-6">
          {gauge.label}: {lowercase(gauge.counts)}.
        </p>
      ))}
    </Section>
  );
}

/** The lines billed outside the minimum. */
function OnTop({ catalog }: { catalog: Catalog }) {
  const lines = catalog.licensed.filter((line) => line.tag !== "minimum spend");
  return (
    <Section
      id="on-top"
      title="Billed on top, never from the credit"
      lead="Compliance, support and extra domains are lines of their own, so they never vanish into the minimum."
    >
      <Table head={["Line", "Price", "Plans"]}>
        {lines.map((line) => (
          <tr key={line.id} className="border-border-primary border-t">
            <td className={`${TD} font-semibold text-text-primary`}>{line.label}</td>
            <td className={`${TD} text-text-secondary`}>{licensedPrice(line)}</td>
            <td className={`${TD} text-text-secondary`}>
              {planList(line.plans)}
              {line.included_in && `; included in ${planList(line.included_in)}`}
              {line.amount !== null && line.note && `; ${line.note}`}
            </td>
          </tr>
        ))}
      </Table>
    </Section>
  );
}

/** Self-hosting's three steps, priced per installation. */
function SelfHosted({ catalog }: { catalog: Catalog }) {
  const { unit, free, pro, enterprise } = catalog.self_hosted;
  const [unitName, unitMeaning] = unit.split(": ");
  return (
    <Section
      id="self-hosted"
      title="Self-hosted"
      lead={`The same three steps, priced per ${unitName}${unitMeaning ? ` (${unitMeaning})` : ""}, never per user or meter.`}
    >
      <div className="mt-8 grid gap-4 md:grid-cols-3">
        <Plan
          name="Open source"
          price="$0"
          per="On your own servers"
          line="Every feature, run it yourself."
          facts={[
            `Licensed ${free.license}`,
            "Every feature",
            `${capitalize(free.support)} support`,
          ]}
        />
        <Plan
          name="Self-hosted Pro"
          price={`From ${dollars(Math.min(...pro.prices.map(({ amount }) => amount)))}`}
          per={`a ${pro.prices[0]?.interval ?? "year"}`}
          line="For companies running it in production."
          facts={[
            ...pro.prices.map(
              ({ installations_up_to: upTo, amount, interval }) =>
                `${upTo === 1 ? "1 installation" : `Up to ${upTo} installations`}: ${dollars(amount)} a ${interval}`,
            ),
            ...pro.includes.map(capitalize),
            `${pro.ticket_cap_per_year} tickets a year`,
          ]}
          featured
        />
        <Plan
          name="Self-hosted Enterprise"
          price="Custom"
          per="A yearly commitment, on the cloud's Enterprise terms"
          line="For contracts and compliance."
          facts={enterprise.includes.map(capitalize)}
          contact
        />
      </div>
    </Section>
  );
}

function Section({
  id,
  title,
  lead,
  children,
}: {
  id: string;
  title: string;
  lead: string;
  children: ReactNode;
}) {
  return (
    <section aria-labelledby={id} className="mt-16 md:mt-24">
      <h2 id={id} className={H2}>
        {title}
      </h2>
      <p className={LEAD}>{lead}</p>
      {children}
    </section>
  );
}

/** A table that scrolls inside itself on a narrow screen, never the page. */
function Table({ head, children }: { head: string[]; children: ReactNode }) {
  return (
    <div className="mt-8 overflow-x-auto">
      <table className="w-full min-w-[40rem] border-collapse">
        <thead>
          <tr>
            {head.map((cell) => (
              <th key={cell} scope="col" className={TH}>
                {cell}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function lowercase(text: string): string {
  return text.charAt(0).toLowerCase() + text.slice(1);
}

/** The catalog's notes as sentences: capitalized, ending in a period. */
function sentence(text: string): string {
  return period(capitalize(text.trim()));
}

function period(text: string): string {
  return /[.!?]$/.test(text) ? text : `${text}.`;
}
