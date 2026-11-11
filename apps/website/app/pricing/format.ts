// How the pricing page writes amounts. Apart from catalog.ts, which reads the
// repository, so the calculator can use it in the browser.

const COUNT = new Intl.NumberFormat("en-US");

/** A dollar amount as the page writes it: `$100`, `$36,000`, `$0.10`, `$0.015`. */
export function dollars(amount: number): string {
  return `$${amount.toLocaleString("en-US", {
    minimumFractionDigits: Number.isInteger(amount) ? 0 : 2,
    maximumFractionDigits: 6,
  })}`;
}

/** A count as the page writes it: `1,000,000`. */
export function count(value: number): string {
  return COUNT.format(value);
}
