import type { Config } from "@oclif/core";

import { BaseCommand } from "../../src/lib/oclif/base";
import { type Tabulate, Tabulatable } from "../../src/lib/oclif/tabulatable";

class Drawing extends Tabulatable(BaseCommand) {
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

  draw: Tabulate = (columns, items) => this.tabulate(columns, items);

  drawList(...args: Parameters<Drawing["listResult"]>) {
    return this.listResult(...args);
  }

  drawDetail(...args: Parameters<Drawing["tabulateDetail"]>) {
    return this.tabulateDetail(...args);
  }
}

/** A command that prints tables, for a test that needs one drawn the way a command draws it. */
export const aTabulatingCommand = (argv: string[] = []): Drawing => new Drawing(argv);

/** A real `tabulate`, for code that formats around the table a command draws. */
export const tabulate: Tabulate = aTabulatingCommand().draw;
