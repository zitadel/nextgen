import type { Placement } from "./analytics";
import { type Step, StepList } from "./blocks";
import { agentQuickstart, appPath, quickstart, skillsCommand } from "./commands";
import { type StartTab, StartTabs } from "./start-tabs";

// The two ways to start (commands.ts), your agent's first. Copy takes the
// tab's commands: with your agent the skills command alone, since the ask
// goes to the agent and not to the shell.
const TABS: readonly (StartTab & { steps: readonly Step[] })[] = [
  {
    id: "with_agent",
    label: "With your agent",
    steps: agentQuickstart,
    copy: { text: skillsCommand, label: "the skills command", snippet: "skills" },
  },
  {
    id: "in_terminal",
    label: "In your terminal",
    steps: quickstart,
    copy: {
      text: quickstart.map(({ command }) => command).join("\n"),
      label: "all commands",
      snippet: "all",
    },
  },
];

/**
 * The hero's start window: the app's folder, the one prerequisite and a copy
 * button over two tabs (start-tabs.tsx), with your agent (its skills, then
 * the ask) and in your terminal (the quickstart's commands), each as
 * numbered steps (StepList), rendered here on the server.
 */
export function StartWindow({ placement }: { placement: Placement }) {
  return (
    <StartTabs
      title={appPath}
      note="Node 24+"
      tabs={TABS.map(({ id, label, copy }) => ({ id, label, copy }))}
      panels={TABS.map(({ id, steps }) => (
        <StepList key={id} steps={steps} placement={placement} />
      ))}
      placement={placement}
    />
  );
}
