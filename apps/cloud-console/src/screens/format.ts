/** Minor units of `currency`, as the reader's locale writes money. */
export function money(minor: number, currency: string): string {
  return new Intl.NumberFormat(undefined, { style: "currency", currency }).format(minor / 100);
}

/** Stripe's period, in UTC as Stripe counts it; its end is exclusive, so the last day shows. */
export function period({ start, end }: { start: string; end: string }): string {
  return `${day(start)} to ${day(new Date(Date.parse(end) - 1).toISOString())}`;
}

/** A UTC day, short: "Oct 12". */
export function day(at: string): string {
  return new Date(at).toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });
}
