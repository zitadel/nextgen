/**
 * A single, self-contained telemetry dimension: it derives one value from one
 * context and nothing else. Every property singleton implements this one
 * contract, so each can be unit-tested in isolation.
 */
export interface Property<TContext, TValue> {
  value(context: TContext): TValue;
}
