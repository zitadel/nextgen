import { describe, expect, it } from "vitest";

import { ServerCommand } from "@/cli/commands/server-command";
import { BaseCommand } from "@/cli/core/base";
import { Promptable } from "@/cli/core/promptable";

/**
 * A command built on the questions alone.
 */
abstract class Asking extends Promptable(ServerCommand(BaseCommand)) {}

/**
 * A command built without the questions.
 */
abstract class NotAsking extends ServerCommand(BaseCommand) {}

describe("Promptable", () => {
  it("gives a command the questions as ask", () => {
    expect("ask" in Asking.prototype).toBe(true);
  });

  it("is the only thing that gives a command ask", () => {
    expect("ask" in NotAsking.prototype).toBe(false);
  });
});
