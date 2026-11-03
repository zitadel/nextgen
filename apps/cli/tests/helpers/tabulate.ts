import type { Config } from "@oclif/core";

import { BaseCommand } from "../../src/lib/oclif/base";
import { type Tabulate, Tabulatable } from "../../src/lib/oclif/tabulatable";

class Unscoped extends Tabulatable(BaseCommand) {
  public static override readonly id: string = "test:tabulate";

  constructor(argv: string[] = []) {
    super(argv, {
      version: "1.2.3",
      runHook: async () => ({ successes: [], failures: [] }),
    } as unknown as Config);
  }

  async run() {
    return this.emit({ status: "ok", data: {} });
  }

  drawList(...args: Parameters<Unscoped["listResult"]>) {
    return this.listResult(...args);
  }
}

class Drawing extends Unscoped {
  protected override suggestFollowUp(args: string) {
    return this.suggestUnscoped(args);
  }

  draw: Tabulate = (columns, items) => this.tabulate(columns, items);

  drawDetail(...args: Parameters<Drawing["tabulateDetail"]>) {
    return this.tabulateDetail(...args);
  }
}

/** A command that prints tables, for a test that needs one drawn the way a command draws it. */
export const aTabulatingCommand = (argv: string[] = []): Drawing => new Drawing(argv);

/** A list command that never says how to suggest a follow-up, as a plain `BaseCommand` one does not. */
export const anUnscopedTabulatingCommand = (argv: string[] = []): Unscoped => new Unscoped(argv);

/** A real `tabulate`, for code that formats around the table a command draws. */
export const tabulate: Tabulate = aTabulatingCommand().draw;
