/**
 * Which emails have an external identity linked, so the mock can tell the three
 * SSO resolution branches apart (area 3).
 *
 * The real engine keys links on the provider's subject, which never changes for
 * an account even when the email does. The mock keys on email instead: it holds
 * no user records to hang a subject off, and the journeys it exists to drive —
 * first sign-in, returning sign-in, an email that already has a password
 * account — are all distinguishable by email alone. A test that needs subject
 * semantics wants the real service.
 */
export class SsoIdentityStore {
  private readonly linked = new Map<string, Set<string>>();

  /** Record that `email` signed up through `slug`. */
  link(slug: string, email: string): void {
    const emails = this.linked.get(slug) ?? new Set<string>();
    emails.add(email.toLowerCase());
    this.linked.set(slug, emails);
  }

  /** Whether this provider has seen this email before. */
  isLinked(slug: string, email: string): boolean {
    return this.linked.get(slug)?.has(email.toLowerCase()) ?? false;
  }

  clear(): void {
    this.linked.clear();
  }
}
