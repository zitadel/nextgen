/**
 * A variable the journey runner sets for the suites (JOURNEY_OUTPUT_DIR,
 * JOURNEY_APP_DIR, …), or a failure naming it when the suite runs without the
 * runner.
 */
export function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}
