"use client";

import { useId, useState } from "react";
import { CLOUD_ONLY, flexFor, SELF_HOSTED_ONLY } from "./deployment";
import { type EstimateInput, estimate } from "./estimate";
import { count, dollars } from "./format";

/** The most a field takes, well past any slider's range. */
const MOST = 100_000_000;

/**
 * A month's bill for the usage the visitor sets: a slider per meter that can
 * be bought today, and the total with how it adds up. Self-hosted, the total
 * starts at the base every production installation pays; which of the two
 * shows follows the page's switch (deployment.ts). Before any script runs it
 * shows the bill for no usage.
 */
export function Calculator({
  inputs,
  base,
}: {
  inputs: EstimateInput[];
  /** What a self-hosted production installation pays before add-ons. */
  base: { label: string; amount: number; per: string };
}) {
  const [usage, setUsage] = useState<Record<string, number>>({});
  const { total, lines } = estimate(inputs, usage);
  const row = "items-baseline justify-between gap-4";
  return (
    <div className="mt-8 grid overflow-hidden rounded-2xl border border-window-border bg-window shadow-(--window-shadow) lg:grid-cols-[3fr_2fr]">
      <div className="flex flex-col gap-8 p-6 md:p-7">
        {inputs.map((input) => (
          <Field
            key={input.id}
            input={input}
            value={usage[input.id] ?? 0}
            onChange={(value) => setUsage((current) => ({ ...current, [input.id]: value }))}
          />
        ))}
        <p className="text-sm text-text-muted leading-6">
          Active users, passwords, passkeys and API requests are never billed.
        </p>
      </div>
      <div
        aria-live="polite"
        className="flex flex-col border-border-primary border-t bg-window-sunken p-6 md:p-7 lg:border-t-0 lg:border-l"
      >
        <p className="font-mono text-text-muted text-xs leading-4">Your estimate</p>
        <p className="mt-4 flex flex-wrap items-baseline gap-x-2 gap-y-1">
          <span className="font-heading text-5xl text-text-primary leading-none tracking-[-0.02em]">
            <span className={CLOUD_ONLY}>{dollars(total)}</span>
            <span className={SELF_HOSTED_ONLY}>{dollars(total + base.amount)}</span>
          </span>
          <span className="text-sm text-text-muted">/ month</span>
        </p>
        {lines.length === 0 && (
          <p className={`mt-5 text-sm text-text-secondary leading-6 ${CLOUD_ONLY}`}>
            Free covers this: no add-on, no card.
          </p>
        )}
        {/* Without a paid line the list holds the base alone, which only self-hosting has. */}
        <dl
          className={`mt-6 flex-col gap-4 border-border-primary border-t pt-5 text-sm leading-6 ${flexFor(lines.length === 0 ? "self_hosted" : undefined)}`}
        >
          <div className={`${flexFor("self_hosted")} ${row}`}>
            <div>
              <dt className="text-text-primary">{base.label}</dt>
              <dd className="text-text-muted text-xs leading-5">For one {base.per}</dd>
            </div>
            <dd className="shrink-0 text-text-primary tabular-nums">{dollars(base.amount)}</dd>
          </div>
          {lines.map((line) => (
            <div key={line.hub} className={`flex ${row}`}>
              <div>
                <dt className="text-text-primary">{line.hub}</dt>
                <dd className="text-text-muted text-xs leading-5">{line.sum}</dd>
              </div>
              <dd className="shrink-0 text-text-primary tabular-nums">{dollars(line.amount)}</dd>
            </div>
          ))}
        </dl>
      </div>
    </div>
  );
}

/** One meter's usage: a slider for a rough amount and a field for an exact one. */
function Field({
  input,
  value,
  onChange,
}: {
  input: EstimateInput;
  value: number;
  onChange: (value: number) => void;
}) {
  const id = useId();
  const set = (raw: string) => {
    const parsed = Math.floor(Number(raw));
    onChange(Number.isFinite(parsed) ? Math.min(Math.max(parsed, 0), MOST) : 0);
  };
  return (
    <div>
      <div className="flex items-end justify-between gap-4">
        <label htmlFor={id} className="text-sm text-text-primary leading-6">
          {input.question}
        </label>
        <input
          type="number"
          inputMode="numeric"
          min={0}
          max={MOST}
          step={input.step}
          value={value}
          onChange={(event) => set(event.target.value)}
          aria-label={`${input.question}, exact`}
          className="h-9 w-28 shrink-0 rounded-lg border border-window-border bg-background px-3 text-right text-sm text-text-primary tabular-nums"
        />
      </div>
      <input
        id={id}
        type="range"
        min={0}
        max={input.max}
        step={input.step}
        value={Math.min(value, input.max)}
        onChange={(event) => set(event.target.value)}
        className="mt-4 w-full accent-text-primary"
      />
      <p className="mt-1 flex justify-between text-text-muted text-xs leading-5">
        <span>{input.free > 0 ? `${count(input.free)} free` : ""}</span>
        <span>{count(input.max)}</span>
      </p>
    </div>
  );
}
