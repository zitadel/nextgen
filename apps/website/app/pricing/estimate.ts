import { count, dollars } from "./format";

// The calculator's sums. Kept apart from the catalog's reader, so the browser
// can run them: the page hands the calculator its inputs (estimate-inputs.ts),
// each with the prices the catalog has for it.

/** One thing the calculator asks: how much of a meter an app uses a month. */
export type EstimateInput = {
  /** The meter's id in the catalog. */
  id: string;
  question: string;
  /** The slider's range. */
  max: number;
  step: number;
  /** Free before the meter's add-on is on. */
  free: number;
  /** Included once it is. */
  included: number;
  /** The price of each one past the included amount. */
  unitAmount: number;
  hub: { id: string; label: string; base: number };
};

export type EstimateLine = {
  /** The add-on the usage turns on. */
  hub: string;
  amount: number;
  /** How the amount adds up: `$100 + 200,000 × $0.004`. */
  sum: string;
};

export type Estimate = { total: number; lines: EstimateLine[] };

/**
 * A month's bill for the usage given per meter id. An add-on is on once one of
 * its meters passes its free amount; it then costs its base fee plus what runs
 * past its included amounts, as the cloud bills it.
 */
export function estimate(inputs: EstimateInput[], usage: Record<string, number>): Estimate {
  const used = (input: EstimateInput) => Math.max(0, usage[input.id] ?? 0);
  const hubs = new Map(inputs.map((input) => [input.hub.id, input.hub]));
  const lines: EstimateLine[] = [];
  for (const hub of hubs.values()) {
    const meters = inputs.filter((input) => input.hub.id === hub.id);
    if (!meters.some((meter) => used(meter) > meter.free)) continue;
    let amount = hub.base;
    const parts = [dollars(hub.base)];
    for (const meter of meters) {
      const past = Math.max(0, used(meter) - meter.included);
      if (past === 0) continue;
      amount += past * meter.unitAmount;
      parts.push(`${count(past)} × ${dollars(meter.unitAmount)}`);
    }
    lines.push({ hub: hub.label, amount: cents(amount), sum: parts.join(" + ") });
  }
  return { total: cents(lines.reduce((sum, line) => sum + line.amount, 0)), lines };
}

function cents(amount: number): number {
  return Math.round(amount * 100) / 100;
}
