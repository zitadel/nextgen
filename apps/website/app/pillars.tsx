import { links } from "./links";
import { ArrowLink, SectionHeading } from "./section";

type Pillar = {
  name: string;
  title: string;
  items: { text: string; planned?: boolean }[];
};

// The four pillars of VISION.md, each titled by what it gives the reader, as
// zitadel/new-website's narrative words them, with what its "Where it stands"
// section says ships in this preview and, marked, what is still planned. When
// that section changes, change these with it.
const pillars: Pillar[] = [
  {
    name: "Build",
    title: "Build with your coding agent",
    items: [
      { text: "The CLI sets up auth unattended and answers in JSON" },
      { text: "Skills for Claude Code, Cursor, Copilot, Codex and more" },
      { text: "Docs as llms.txt, Markdown and an MCP server" },
    ],
  },
  {
    name: "Operate",
    title: "Run it as code",
    items: [
      { text: "Schemas, flows and branding as files, with plan and apply" },
      { text: "One OpenAPI contract behind the API, the CLI and the console" },
      { text: "Management operations over MCP", planned: true },
    ],
  },
  {
    name: "Investigate",
    title: "Know what happened",
    items: [
      { text: "An audit trail of request, auth, session, admin and entity events" },
      { text: "One identity-scoped event stream your agents can query", planned: true },
    ],
  },
  {
    name: "Govern",
    title: "Give agents their own identity",
    items: [
      { text: "Agents as principals that sign in as themselves", planned: true },
      {
        text: "Delegation chains: which user granted which scope to which agent",
        planned: true,
      },
    ],
  },
];

export function Pillars() {
  return (
    <section aria-labelledby="pillars-title" className="px-6 py-16 md:py-24">
      <div className="mx-auto flex max-w-6xl flex-col gap-10">
        <SectionHeading
          id="pillars-title"
          label="Where it stands"
          title="What works today, and what comes next"
        >
          Everything above ships in the preview. Here is where the rest of the platform stands.
        </SectionHeading>
        <ol className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          {pillars.map((pillar) => (
            <li
              key={pillar.name}
              className="flex flex-col gap-4 rounded-2xl border border-border-primary bg-linear-to-b from-surface-black-secondary/40 to-background p-6"
            >
              <h3 className="font-heading text-xl leading-7 tracking-[-0.01em]">{pillar.title}</h3>
              <ul
                aria-label={`${pillar.name}: what ships and what is planned`}
                className="flex flex-col gap-2.5"
              >
                {pillar.items.map((item) => (
                  <li key={item.text} className="text-sm text-text-secondary leading-5">
                    {item.text}
                    {item.planned && (
                      <span className="ml-2 inline-flex items-center gap-1.5 whitespace-nowrap rounded-md bg-surface-black-secondary px-2 py-0.5 align-[0.0625rem] font-semibold text-text-secondary text-xs leading-4">
                        <span aria-hidden="true" className="size-1.5 rounded-full bg-text-muted" />
                        Planned
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ol>
        <p className="text-sm">
          <ArrowLink href={links.vision}>Read the vision</ArrowLink>
        </p>
      </div>
    </section>
  );
}
