import {
  FolderGit2,
  Layers,
  type LucideIcon,
  MonitorCog,
  Rocket,
  SquareTerminal,
  Users,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { InlineCode } from "@/components/ui/inline-code";
import { avatarVars } from "@/components/user-avatar";
import { EYEBROW } from "@/components/typography";
import { cn } from "@/lib/utils";

interface Stage {
  icon: LucideIcon;
  title: string;
  body: string;
  /** The CLI command the stage turns on, without the `npx` prefix. */
  command?: string;
  /** The console's own stage: the one a person reading this is at. */
  here?: boolean;
}

/**
 * The stages a project goes through, as the CLI drives them
 * (`apps/cli/skills/zitadel-cli/SKILL.md`, "Golden path"). Each environment is
 * a project of its own (`env add` creates one), which is why one app shows up
 * here more than once.
 */
const STAGES: Stage[] = [
  {
    icon: SquareTerminal,
    title: "Set up",
    command: "setup",
    body: "Creates the project and connects your app: sign-in, a user schema and a login flow, written to your app’s .zitadel/ folder.",
  },
  {
    icon: MonitorCog,
    title: "Build locally",
    command: "start",
    body: "Runs Zitadel on your machine. Shape schemas, flows and policies in .zitadel/ beside your code; doctor checks the setup.",
  },
  {
    icon: Rocket,
    title: "Deploy",
    command: 'deploy -m "…"',
    body: "Builds a release from .zitadel/ and serves it on the project’s origins. A rollback re-applies an earlier one.",
  },
  {
    icon: Layers,
    title: "Add environments",
    command: "env add production",
    body: "Each environment is a project of its own: preview, staging or production, each serving the release deployed to it.",
  },
  {
    icon: Users,
    title: "Operate",
    here: true,
    body: "The console: the people who sign up, the teams they belong to, and a read of every definition that is live.",
  },
];

/**
 * How projects work, under the Projects list: the stages from an app's
 * folder to production, then where each part of a project is changed.
 *
 * Guidance, not navigation: nothing here is a control. The commands are the
 * CLI's, since that is where a project is created and changed (D0b); the
 * console's stage is marked as the one the reader is at.
 */
export function ProjectLifecycle({ className }: { className?: string }) {
  return (
    <section aria-labelledby="lifecycle-title" className={cn("flex flex-col gap-8", className)}>
      <header className="flex max-w-2xl flex-col gap-2">
        <p className={EYEBROW}>How projects work</p>
        <h2
          id="lifecycle-title"
          className="font-serif text-xl leading-7 tracking-tight text-foreground"
        >
          From your app’s folder to production
        </h2>
        <p className="text-sm text-muted-foreground">
          A project is the sign-in of one app in one environment: its users, schemas, login flow and
          branding. You shape it as code with the CLI, and watch it run here.
        </p>
      </header>

      <ol className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5 lg:gap-0">
        {STAGES.map((stage, index) => (
          <StageItem
            key={stage.title}
            stage={stage}
            step={index + 1}
            last={index === STAGES.length - 1}
          />
        ))}
      </ol>

      <div className="grid gap-3 md:grid-cols-2">
        <Ownership icon={FolderGit2} title="Changed in your repository">
          User schemas, login flows and policies live in <InlineCode>.zitadel/</InlineCode> beside
          your code. Review them like code, and ship them with <InlineCode>deploy</InlineCode>.
        </Ownership>
        <Ownership icon={Users} title="Run from the console">
          The people: who signed up, the teams they belong to and who administers each project. What
          the repository defines, the console shows as it is live.
        </Ownership>
      </div>

      <p className="text-xs text-muted-foreground">
        Every command runs with <InlineCode>npx @zitadel/cli@latest</InlineCode>, no install needed.
      </p>
    </section>
  );
}

/**
 * One stage: its node on the track, then its card. At `lg` the stages sit on
 * one row and the node carries a rule to the next one, so the row reads as a
 * track; stacked, the rule goes and each card stands alone.
 */
function StageItem({ stage, step, last }: { stage: Stage; step: number; last: boolean }) {
  const { icon: Icon } = stage;

  return (
    <li className="flex flex-col gap-3 lg:pr-3 lg:last:pr-0">
      <div className="flex items-center gap-3" aria-hidden>
        {stage.here ? (
          // The console's own stage takes the generated gradient as its frame.
          <span
            className="zl-avatar zl-avatar-moving size-9 shrink-0 rounded-md! p-px"
            style={avatarVars("zitadel-console")}
          >
            <span className="flex size-full items-center justify-center rounded-[7px] bg-background">
              <Icon strokeWidth={1.5} className="size-4 text-foreground" />
            </span>
          </span>
        ) : (
          <span className="flex size-9 shrink-0 items-center justify-center rounded-md border border-border bg-card">
            <Icon strokeWidth={1.5} className="size-4 text-foreground" />
          </span>
        )}
        <span className={EYEBROW}>{String(step).padStart(2, "0")}</span>
        {!last && (
          <span className="hidden h-px flex-1 bg-gradient-to-r from-border to-transparent lg:block" />
        )}
      </div>
      <div
        className={cn(
          "flex flex-1 flex-col gap-2 rounded-md border bg-card p-4",
          stage.here ? "border-foreground/20" : "border-border",
        )}
      >
        <h3 className="flex items-center gap-2 text-sm font-medium text-foreground">
          {stage.title}
          {stage.here && <Badge variant="secondary">You are here</Badge>}
        </h3>
        <p className="text-xs leading-5 text-muted-foreground">{stage.body}</p>
        {stage.command && <InlineCode className="mt-auto self-start">{stage.command}</InlineCode>}
      </div>
    </li>
  );
}

function Ownership({
  icon: Icon,
  title,
  children,
}: {
  icon: LucideIcon;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex gap-3 rounded-md border border-dashed border-border p-4">
      <Icon
        aria-hidden
        strokeWidth={1.5}
        className="mt-0.5 size-4 shrink-0 text-muted-foreground"
      />
      <div className="flex flex-col gap-1">
        <h3 className="text-sm font-medium text-foreground">{title}</h3>
        <p className="text-xs leading-5 text-muted-foreground">{children}</p>
      </div>
    </div>
  );
}
