import type { Metadata } from "next";
import type { ReactNode } from "react";
import { links } from "../links";
import og from "../og.jpg";
import { SiteFooter } from "../site-footer";
import { SiteHeader } from "../site-header";
import { AddOns } from "./add-ons";
import { Calculator } from "./calculator";
import { type Catalog, readCatalog, sentence } from "./catalog";
import { compareGroups, lowestHub } from "./compare";
import { CompareTable } from "./compare-table";
import { estimateInputs } from "./estimate-inputs";
import { H2, LINK, Plus } from "./parts";
import { DeploymentSwitch, PlanCards } from "./plan-cards";
import { planCards } from "./plans";
import { hubStatus, works } from "./status";

// Built from the repository (catalog.ts), so a deploy brings the prices the
// cloud bills from; nothing is read per visit. The page is the offer's three
// steps, as most pricing pages show theirs: Free, Add-ons and Enterprise, side
// by side, under a switch between the cloud and self-hosting, which adds what
// differs on your own servers and changes nothing else. Below them come the add-ons as one
// price list, a calculator, the comparison of every feature, folded until
// asked for, and the questions, which hold every explanation. What doesn't
// work yet carries Choose a version's status (status.ts), and an add-on still
// to come shows no price.
export const dynamic = "force-static";

const title = "Pricing — Zitadel preview";
const description =
  "Start free with users and passkeys included. Turn on add-ons for what your app needs, or move to Enterprise, in the cloud or self-hosted.";

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

export default function PricingPage() {
  const catalog = readCatalog();
  return (
    <>
      <SiteHeader current="pricing" />
      {/* The switch's radios are inside this group, so any block can show for one deployment. */}
      <main className="group/deploy px-6 pt-12 pb-20 md:pt-20 md:pb-28">
        <div className="mx-auto max-w-6xl">
          <div className="flex flex-col items-center text-center">
            <h1 className="max-w-3xl text-balance font-heading text-4xl text-text-primary leading-tight tracking-[-0.025em] md:text-6xl">
              Start free. Add what your app needs.
            </h1>
            <p className="mt-4 max-w-2xl text-balance text-base text-text-secondary leading-7 md:text-lg md:leading-8">
              Users, passkeys and secure defaults are free. Turn on add-ons as your app grows, or
              move to Enterprise. In our cloud or on your own servers.
            </p>
            <div className="mt-10">
              <DeploymentSwitch />
            </div>
          </div>

          <div className="mt-8">
            <PlanCards cards={planCards(catalog)} />
          </div>
          <p className="mt-6 text-center text-text-muted text-xs leading-5">
            Prices in {catalog.currency.toUpperCase()}, before taxes, from general availability.{" "}
            <a href={links.chooseVersion} className={LINK}>
              Choose a version
            </a>{" "}
            shows what works today.
          </p>

          <AddOns catalog={catalog} />
          <section aria-labelledby="estimate" className="mt-20 md:mt-28">
            <h2 id="estimate" className={H2}>
              What you'd pay
            </h2>
            <Calculator inputs={estimateInputs(catalog)} base={catalog.self_hosted.base} />
          </section>

          <section aria-labelledby="compare" className="mt-20 md:mt-28">
            <details className="group border-border-primary border-y">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-6 py-6 [&::-webkit-details-marker]:hidden">
                <h2 id="compare" className={H2}>
                  Compare every feature and limit
                </h2>
                <Plus />
              </summary>
              <div className="pb-10">
                <CompareTable
                  groups={compareGroups(catalog)}
                  prices={{
                    free: "$0",
                    addons: `From ${lowestHub(catalog)} / month per add-on`,
                    enterprise: "Custom",
                  }}
                />
              </div>
            </details>
          </section>

          <Questions catalog={catalog} />
        </div>
      </main>
      <SiteFooter />
    </>
  );
}

/** A note's sentences, one each. */
function sentences(text: string): string[] {
  return sentence(text).split(/(?<=\.)\s+/);
}

/** Only what the cards and the table can't say, as questions. */
function Questions({ catalog }: { catalog: Catalog }) {
  const { conventions, plans } = catalog;
  const hub = (id: string) => catalog.hubs.find((entry) => entry.id === id)?.label ?? id;
  const agents = catalog.hubs.find((entry) => entry.id === "agentic");
  const questions: { question: string; answer: ReactNode }[] = [
    {
      question: "Which add-ons does my app need?",
      answer: (
        <p>
          Consumer apps turn on {hub("consumer")}, business apps {hub("multi_tenancy")}. An app that
          does both turns on both.{" "}
          {agents && works(hubStatus(agents))
            ? `Agents that act for your users turn on ${agents.label}; services need none.`
            : `Services need none, and agents run on Free until ${hub("agentic")} ships.`}
        </p>
      ),
    },
    {
      question: "How is my bill worked out?",
      answer: <p>{conventions.invoice}</p>,
    },
    {
      question: "Why are users and MFA free?",
      answer: (
        <p>
          A per-user fee for MFA would push apps to build it themselves, and CISA's{" "}
          <a href="https://www.cisa.gov/securebydesign" className={LINK}>
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
      question: "Are API requests billed?",
      answer: (
        <p>
          {sentence(conventions.capacity)} A project gets{" "}
          {plans.free.limits.requests_per_second_per_project} requests a second, and{" "}
          {plans.pro.limits.requests_per_second_per_project} with any add-on.
        </p>
      ),
    },
    {
      question: "What happens when I pass a free amount?",
      answer: (
        <>
          <ul className="flex list-disc flex-col gap-2 pl-5">
            {sentences(plans.free.over_allowance).map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
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
          <a href={links.chooseVersion} className={LINK}>
            Choose a version
          </a>{" "}
          compares the two, feature by feature. {sentence(plans.enterprise.preview)}{" "}
          <a href={links.contact} className={LINK}>
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
              <Plus />
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
