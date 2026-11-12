import { type Config, Flags } from "@oclif/core";

import { BaseCommand } from "@/lib/oclif/base";
import { type Tabulate, Tabulatable } from "@/lib/oclif/tabulatable";

class Listing extends Tabulatable(BaseCommand) {
  public static override readonly id: string = "thing:list";

  /** What a paged list takes, so its next page can be suggested as this run again. */
  static override flags = {
    limit: Flags.integer({ description: "Page size." }),
    "page-token": Flags.string({ description: "Continue from a previous page." }),
    all: Flags.boolean({ description: "Fetch every page." }),
  };

  constructor(argv: string[] = []) {
    super(argv, {
      version: "1.2.3",
      runHook: async () => ({ successes: [], failures: [] }),
    } as unknown as Config);
  }

  protected async execute() {
    return this.emit({ summary: { title: "Done", sections: [] }, status: "ok", data: {} });
  }

  drawList(...args: Parameters<Listing["listResult"]>) {
    return this.listResult(...args);
  }
}

class Drawing extends Listing {
  draw: Tabulate = (columns, items) => this.tabulate(columns, items);

  drawDetail(...args: Parameters<Drawing["tabulateDetail"]>) {
    return this.tabulateDetail(...args);
  }
}

/**
 * A command that draws its table during a real run, so the run has settled
 * what a table drawn by hand cannot: whether its output is coloured. The
 * drawn table is kept rather than returned, because `run` answers with the
 * envelope.
 */
class Running extends Drawing {
  public drawn = "";

  public override log(): void {
    /* swallow human output */
  }

  public override logJson(): void {
    /* swallow the envelope */
  }

  protected override async execute() {
    this.drawn = await this.tabulate(["id"], [{ id: "user_1" }]);
    return this.emit({ summary: { title: "Done", sections: [] }, status: "ok", data: {} });
  }
}

/** A command that prints tables, for a test that needs one drawn the way a command draws it. */
export const aTabulatingCommand = (argv: string[] = []): Drawing => new Drawing(argv);

/** Draws one table through a whole run, for a test about what the run decided. */
export const aTableDrawnByARun = async (argv: string[] = []): Promise<string> => {
  const command = new Running(["--no-telemetry", ...argv]);
  await command.run();
  return command.drawn;
};

/** A real `tabulate`, for code that formats around the table a command draws. */
export const tabulate: Tabulate = aTabulatingCommand().draw;
