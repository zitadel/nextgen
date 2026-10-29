import type { Page } from "@playwright/test";

/**
 * Records each Content-Security-Policy violation the page's documents report,
 * enforced or report-only, from before their first script and across
 * full-document navigations (the sign-in ends in one). The console's two
 * policies are the server's (`internal/staticui/console`) and, on the cloud,
 * vercel.json's: first-party code breaks neither, so a spec expects the list
 * it returns to stay empty.
 *
 * Playwright only, nothing else: the deployment lane builds no test kit.
 */
export async function recordPolicyViolations(page: Page): Promise<string[]> {
  const violations: string[] = [];
  await page.exposeFunction("recordPolicyViolation", (violation: string) => {
    violations.push(violation);
  });
  await page.addInitScript(() => {
    const record = (window as unknown as { recordPolicyViolation(violation: string): void })
      .recordPolicyViolation;
    window.addEventListener("securitypolicyviolation", (event) => {
      record(
        `${event.disposition} ${event.effectiveDirective} ${event.blockedURI || "(none)"}` +
          ` at ${event.sourceFile}:${event.lineNumber}`,
      );
    });
  });
  return violations;
}
