/** What Schemathesis printed about one failing request: enough to see what broke without downloading anything. */
export interface FailureDetail {
  /** Schemathesis's id for the case; `st replay <id>` runs it again in the image. */
  id: string;
  /** The names of the checks the request failed, as Schemathesis titles them. */
  checks: string[];
  /** The response, as `[status] reason` then its body, when the server answered. */
  response: string;
  /** The request as a `curl` command, with credentials left out. */
  curl: string;
}

/** Header values that are credentials or tokens, which never go into a summary or a log. */
const SECRET_HEADERS = /(-H '(?:Authorization|Cookie|X-Zitadel-CSRF): )[^']*'/g;

/**
 * Reads the failure blocks of Schemathesis's printed output, which name each
 * failing operation and show the case that broke it. The release is pinned,
 * so the layout is stable; a layout this does not recognise yields no
 * details, and the summary then just omits them.
 */
export class FailureDetails {
  /**
   * @param log - everything one Schemathesis command printed.
   * @returns the details of each failing operation, by its `METHOD /path` name.
   */
  static parse(log: string): Record<string, FailureDetail[]> {
    const lines = log.split(/\r?\n/);
    const start = lines.findIndex((line) => {
      return /^=+ FAILURES =+$/.test(line);
    });
    if (start === -1) {
      return {};
    }
    const found: Record<string, FailureDetail[]> = {};
    let operation: string | undefined;
    let block: string[] = [];
    const flush = (): void => {
      if (operation !== undefined) {
        found[operation] = [...(found[operation] ?? []), ...FailureDetails.cases(block)];
      }
      block = [];
    };
    for (const line of lines.slice(start + 1)) {
      if (/^=+ .* =+$/.test(line) || line.startsWith("Test Phases:")) {
        break;
      }
      const heading = /^_{3,} (.+?) _{3,}$/.exec(line);
      if (heading) {
        flush();
        operation = heading[1];
      } else {
        block.push(line);
      }
    }
    flush();
    return found;
  }

  /** The cases in one operation's block, each opened by `N. Test Case ID: x`. */
  private static cases(block: string[]): FailureDetail[] {
    const details: FailureDetail[] = [];
    let current: string[] = [];
    let id: string | undefined;
    const flush = (): void => {
      if (id !== undefined) {
        details.push(FailureDetails.detail(id, current));
      }
      current = [];
    };
    for (const line of block) {
      const opening = /^\d+\. Test Case ID: (\S+)$/.exec(line);
      if (opening) {
        flush();
        id = opening[1];
      } else {
        current.push(line);
      }
    }
    flush();
    return details;
  }

  private static detail(id: string, lines: string[]): FailureDetail {
    const checks = lines
      .filter((line) => {
        return line.startsWith("- ");
      })
      .map((line) => {
        return line.slice(2).trim();
      });
    const statusAt = lines.findIndex((line) => {
      return /^\[\d{3}\] .*:$/.test(line);
    });
    const reproduceAt = lines.findIndex((line) => {
      return line.startsWith("Reproduce with:");
    });
    const status = statusAt === -1 ? "" : (lines[statusAt]?.replace(/:$/, "") ?? "");
    const body =
      statusAt === -1
        ? ""
        : lines
            .slice(statusAt + 1, reproduceAt === -1 ? undefined : reproduceAt)
            .join("\n")
            .trim()
            .replace(/^`|`$/g, "");
    const curl = (
      lines.slice(reproduceAt + 1).find((line) => {
        return line.trim().startsWith("curl ");
      }) ?? ""
    ).trim();
    return {
      id,
      checks,
      response: status === "" ? "" : `${status}\n${body}`.trim(),
      curl: curl.replace(SECRET_HEADERS, "$1[Filtered]'"),
    };
  }
}
