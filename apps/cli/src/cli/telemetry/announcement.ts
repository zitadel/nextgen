import type { CommandEvent } from "@/lib/oclif/events";
import type { WriteEvent } from "@/lib/oclif/crud/ops/write";
import type { PublishEvent } from "@/lib/publish";
import type { WizardEvent } from "@/lib/wizard";

/**
 * One thing a library or the base command announced about a run, tagged with
 * the channel it came from, so a command's own logic can tell them apart.
 */
export type Announcement =
  | Readonly<{ channel: "command"; event: CommandEvent }>
  | Readonly<{ channel: "wizard"; event: WizardEvent }>
  | Readonly<{ channel: "publish"; event: PublishEvent }>
  | Readonly<{ channel: "write"; event: WriteEvent }>
  | Readonly<{ channel: "prompt" }>;
