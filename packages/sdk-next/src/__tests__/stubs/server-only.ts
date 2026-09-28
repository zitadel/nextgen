/**
 * Test stand-in for the `server-only` package.
 *
 * The real package throws on import outside a `react-server` module graph —
 * that build-time guard is exactly what production wants, but Vitest runs in
 * neither graph. The vitest config aliases `server-only` here so server
 * modules stay importable under test.
 */
export {};
