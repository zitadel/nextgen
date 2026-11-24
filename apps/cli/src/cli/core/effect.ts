/**
 * The key a command class declares what it does to the world under. A symbol,
 * so no flag, argument or hand-written property can forge it: only a mixin
 * that imports it can say a command changes something.
 */
export const EFFECT: unique symbol = Symbol("effect");
