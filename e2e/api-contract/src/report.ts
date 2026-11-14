import { compare } from "./order";

export interface Accounting {
  selected: number;
  tested: number;
  skipped: number;
  errored: number;
  /** Filters that matched no operation. */
  unmatched: string[];
}

/** One check an operation fails, in Schemathesis's words (`Server error`). */
export interface Failure {
  operation: string;
  check: string;
  /** How many generated requests broke it. */
  count: number;
}

interface ReportFailure {
  title: string;
  count: number;
  operations: string[];
}

interface ReportJson {
  operations: { selected: number; tested: number; errored: number; skipped: number };
  warnings: { unmatched_filter: unknown[] };
  complete: boolean;
  stop_reason?: string;
  failures: ReportFailure[];
  errors: unknown[];
}

/**
 * What the lane reads out of Schemathesis's JSON report: whether the run
 * finished, what errors it hit, and which checks each operation failed.
 */
export class SchemathesisReport {
  private readonly json: ReportJson;

  constructor(json: ReportJson) {
    this.json = json;
  }

  static parse(text: string): SchemathesisReport {
    return new SchemathesisReport(JSON.parse(text) as ReportJson);
  }

  /**
   * What Schemathesis says it did with the operations it was asked to test.
   * A run that selected fewer than it was asked to, or tested fewer than it
   * selected, has operations whose tests would otherwise pass untested.
   */
  get accounting(): Accounting {
    return {
      selected: this.json.operations.selected,
      tested: this.json.operations.tested,
      skipped: this.json.operations.skipped,
      errored: this.json.operations.errored,
      unmatched: this.json.warnings.unmatched_filter.map((entry) => {
        return JSON.stringify(entry);
      }),
    };
  }

  /** Whether Schemathesis ran every phase it was asked to. */
  get complete(): boolean {
    return this.json.complete;
  }

  /** Why it stopped, which for a run that did not finish says what went wrong. */
  get stopReason(): string {
    return this.json.stop_reason ?? "unknown";
  }

  /** Errors in the run itself, such as an operation it could not generate requests for. */
  get errors(): string[] {
    return this.json.errors.map((error) => {
      return JSON.stringify(error);
    });
  }

  /**
   * Each failed check once per operation, sorted. The multi-step phase can
   * find the same failure through several operations; it is listed under each.
   */
  failures(): Failure[] {
    const found = new Map<string, Failure>();
    for (const failure of this.json.failures) {
      for (const operation of failure.operations) {
        const key = `${operation}\n${failure.title}`;
        const known = found.get(key);
        found.set(key, {
          operation,
          check: failure.title,
          count: (known?.count ?? 0) + failure.count,
        });
      }
    }
    return [...found.values()].sort((a, b) => {
      return compare(a.operation, b.operation) || compare(a.check, b.check);
    });
  }
}
