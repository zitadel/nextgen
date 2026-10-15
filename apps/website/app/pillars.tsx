import { links } from "./links";
import { ArrowLink, SectionHeading } from "./section";

type Status = "shipped" | "planned";

type Pillar = {
  name: string;
  title: string;
  summary: string;
  items: { status: Status; text: string }[];
  link: { href: string; text: string };
};

// The four pillars of VISION.md, each with what its "Where it stands" section
// says ships in this preview and what is still planned. When that section
// changes, change these with it.
const pillars: Pillar[] = [
  {
    name: "Build",
    title: "Auth you own",
    summary: "Registration and login in your app, under your brand. The server holds every secret.",
    items: [
      { status: "shipped", text: "The CLI takes an empty folder to working local auth" },
      {
        status: "shipped",
        text: "SDKs for Next.js, Nuxt, React, Vue, Angular, Svelte, Solid and Qwik",
      },
      { status: "shipped", text: "Sign-in components to embed, theme and eject" },
      { status: "shipped", text: "Create first, claim later, with zitadel claim" },
    ],
    link: { href: links.quickstart, text: "Quickstart" },
  },
  {
    name: "Operate",
    title: "One contract, every surface",
    summary: "Everything Zitadel can do is defined once and reachable everywhere.",
    items: [
      { status: "shipped", text: "OpenAPI 3.1 as the contract of record" },
      { status: "shipped", text: "Configuration as code, with plan and apply" },
      { status: "shipped", text: "Every CLI command answers in JSON, for scripts and agents" },
      { status: "planned", text: "Management operations over MCP" },
    ],
    link: { href: links.planApply, text: "Plan and apply" },
  },
  {
    name: "Investigate",
    title: "Events answer questions",
    summary: "Identity activity as a dataset, not a log file.",
    items: [
      {
        status: "shipped",
        text: "An audit trail of request, auth, session, admin and entity events",
      },
      { status: "planned", text: "One identity-scoped event stream for everything that happens" },
      { status: "planned", text: "Query surfaces your agents can investigate with" },
    ],
    link: { href: links.eventsApi, text: "Events API" },
  },
  {
    name: "Govern",
    title: "Accountable agents",
    summary:
      "Agents get identities of their own, and every action on someone's behalf is accounted for.",
    items: [
      { status: "planned", text: "Agents as principals that sign in as themselves" },
      {
        status: "planned",
        text: "Delegation chains: which user granted which scope to which agent",
      },
      { status: "planned", text: "Built on token exchange, actor claims and MCP authorization" },
    ],
    link: { href: links.vision, text: "Read the vision" },
  },
];

const STATUS: Record<Status, { label: string; badge: string; dot: string }> = {
  shipped: { label: "Shipped", badge: "bg-success/15 text-success", dot: "bg-success" },
  planned: {
    label: "Planned",
    badge: "bg-surface-black-secondary text-text-secondary",
    dot: "bg-text-muted",
  },
};

function StatusBadge({ status }: { status: Status }) {
  const { label, badge, dot } = STATUS[status];
  return (
    <span
      className={`inline-flex w-fit items-center gap-1.5 whitespace-nowrap rounded-md px-2 py-0.5 font-semibold text-xs leading-5 ${badge}`}
    >
      <span aria-hidden="true" className={`size-1.5 rounded-full ${dot}`} />
      {label}
    </span>
  );
}

export function Pillars() {
  return (
    <section aria-labelledby="pillars-title" className="px-6 py-16 md:py-24">
      <div className="mx-auto flex max-w-6xl flex-col gap-10">
        <SectionHeading
          id="pillars-title"
          label="Where it stands"
          title="What works today, and what comes next"
        >
          Each capability builds on the one before it. Every card says what you can use in the
          preview today and what is still planned.
        </SectionHeading>
        <ol className="grid gap-4 md:grid-cols-2">
          {pillars.map((pillar, index) => (
            <li
              key={pillar.name}
              className="flex flex-col gap-6 rounded-2xl border border-border-primary bg-linear-to-b from-surface-black-secondary/40 to-background p-6 md:p-8"
            >
              <div className="flex flex-col gap-2">
                <p className="font-semibold text-sm text-text-accent">
                  {String(index + 1).padStart(2, "0")} · {pillar.name}
                </p>
                <h3 className="font-heading text-2xl leading-8 tracking-[-0.02em]">
                  {pillar.title}
                </h3>
                <p className="text-text-secondary">{pillar.summary}</p>
              </div>
              <ul
                aria-label={`Where ${pillar.name} stands`}
                className="flex grow flex-col gap-3 border-border-primary border-t pt-6"
              >
                {pillar.items.map((item) => (
                  <li
                    key={item.text}
                    className="grid grid-cols-[5.5rem_1fr] items-start gap-3 text-sm leading-6"
                  >
                    <StatusBadge status={item.status} />
                    <span>{item.text}</span>
                  </li>
                ))}
              </ul>
              <p className="text-sm">
                <ArrowLink href={pillar.link.href}>{pillar.link.text}</ArrowLink>
              </p>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
