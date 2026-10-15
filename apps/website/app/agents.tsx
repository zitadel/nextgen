import type { ReactNode } from "react";
import { CopyButton } from "./copy-button";
import { links } from "./links";
import { ArrowLink, SectionHeading } from "./section";

// The skills of this repository, for any skills-compatible agent (README.md):
// the router skill, the CLI's and one per framework SDK and component.
const skillsCommand = "npx skills add zitadel/nextgen --full-depth";

function Card({ title, children }: { title: string; children: ReactNode }) {
  return (
    <li className="flex min-w-0 flex-col gap-4 rounded-2xl border border-border-primary p-6">
      <h3 className="font-heading text-xl leading-7 tracking-[-0.01em]">{title}</h3>
      {children}
    </li>
  );
}

function Code({ children }: { children: ReactNode }) {
  return (
    <code className="rounded-md bg-surface-black-secondary px-1.5 py-0.5 font-mono text-[0.8125rem]">
      {children}
    </code>
  );
}

export function Agents() {
  return (
    <section aria-labelledby="agents-title" className="px-6 py-16 md:py-24">
      <div className="mx-auto flex max-w-6xl flex-col gap-10">
        <SectionHeading
          id="agents-title"
          label="Agent-native"
          title="Built for the agents beside you"
        >
          Every capability is a contract a machine can discover, call and verify: structured input,
          structured output, no hidden steps. What serves the agent serves the developer.
        </SectionHeading>
        <ul className="grid gap-4 md:grid-cols-3">
          <Card title="Teach your coding agent">
            <p className="text-text-secondary">
              Install the Zitadel skills into Claude Code, Cursor, Copilot, Codex or any other agent
              that reads skills.
            </p>
            <div className="relative mt-auto rounded-xl border border-border-primary bg-background">
              <pre className="whitespace-pre-wrap py-3.5 pr-14 pl-4 font-mono text-xs leading-6">
                <code>
                  <span aria-hidden="true" className="select-none text-text-muted">
                    {"$ "}
                  </span>
                  {skillsCommand}
                </code>
              </pre>
              <CopyButton text={skillsCommand} label="Copy the skills command" />
            </div>
            <p className="text-sm">
              <ArrowLink href={links.agentSetup}>Agent setup</ArrowLink>
            </p>
          </Card>
          <Card title="Read the docs as text">
            <p className="text-text-secondary">
              An index of every page at <Code>/docs/llms.txt</Code>, the whole site in one file at{" "}
              <Code>/docs/llms-full.txt</Code>, and any page as Markdown by adding <Code>.md</Code>{" "}
              to its URL.
            </p>
            <p className="mt-auto text-sm">
              <ArrowLink href={links.docsIndex}>Open llms.txt</ArrowLink>
            </p>
          </Card>
          <Card title="Ask the docs over MCP">
            <p className="text-text-secondary">
              Point any MCP client at <Code>/docs/api/mcp</Code> on this host. Its tools search the
              docs, list the pages and read one.
            </p>
            <p className="mt-auto text-sm">
              <ArrowLink href={links.llmSupport}>LLM support in the docs</ArrowLink>
            </p>
          </Card>
        </ul>
      </div>
    </section>
  );
}
