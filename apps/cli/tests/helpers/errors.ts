/**
 * The error codes the CLI reports and the exit code each one maps to.
 *
 * The numbers are written out rather than imported from `src/lib/errors.ts`,
 * because scripts and CI branch on them: a renumbering has to fail a test
 * rather than quietly travel through a shared constant. `toFailWith` checks
 * the exit code against this table, so every spec that names a code pins its
 * number too.
 */
export const EXIT_CODE_FOR = {
  E_ALREADY_INIT: 0,
  E_AUTH: 1,
  E_NOT_IMPLEMENTED: 2,
  E_FRAMEWORK_NOT_DETECTED: 3,
  E_UNSUPPORTED_PROJECT_SHAPE: 3,
  E_VALIDATION: 3,
  E_LOCAL_SERVER_NOT_RUNNING: 4,
  E_NETWORK: 4,
  E_NOT_FOUND: 4,
  E_CONFLICT: 5,
  E_PORT_IN_USE: 5,
} as const;

export type ErrorCode = keyof typeof EXIT_CODE_FOR;
