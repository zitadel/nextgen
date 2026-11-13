/**
 * Whether the run is on a continuous-integration machine, where no person reads
 * a notice about a newer release and a prompt would never be answered. `CI` set
 * to anything but `0` or `false` counts.
 *
 * @param env - The run's environment.
 * @returns `true` when the run is on CI.
 */
export function isCI(env: NodeJS.ProcessEnv): boolean {
  return Boolean(env.CI) && env.CI !== "0" && env.CI !== "false";
}
