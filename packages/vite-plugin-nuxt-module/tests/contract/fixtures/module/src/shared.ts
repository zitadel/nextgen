/** The greeting a module option falls back to. */
export const DEFAULT_GREETING = "Hello";

/** Code the app and the server both run: it is its own bundled entry, imported by the runtime. */
export function greetingFor(name: string, greeting: string = DEFAULT_GREETING): string {
  return `${greeting}, ${name}!`;
}
