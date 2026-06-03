/**
 * The framework-specific facts a {@link Detector} extracts from a project.
 * Everything downstream (the patcher, the issuer, where managed files land)
 * reads these instead of re-deriving framework knowledge, so adding a framework
 * never touches the orchestrator or the commands. Readonly and freshly built.
 *
 * - `id` — the framework id (e.g. `next`), matching the scaffolder/patcher ids.
 * - `appDir` — where routes/managed files live (`app` | `src/app` for Next).
 * - `devPort` — the dev-server port parsed from the project, else the framework
 *   default.
 * - `url` — the local OIDC issuer derived from `devPort`.
 */
export type FrameworkFacts = Readonly<{
  id: string;
  appDir: string;
  devPort: number;
  url: string;
}>;

/**
 * Recognises a single framework in an existing project and extracts its
 * {@link FrameworkFacts}. The third per-framework strategy alongside
 * `Scaffolder` (create a project) and `Patcher` (integrate Zitadel), so all
 * framework-specific detection lives in one place.
 */
export interface Detector {
  /** The framework id this detector recognises (used to honour `--framework`). */
  readonly framework: string;
  /**
   * Probe `cwd`. Returns {@link FrameworkFacts} when it is a project of this
   * framework, or `null` when it is not (so the orchestrator tries the next
   * detector). MAY throw a `ZitadelError` when the framework is recognised but
   * unsupported (e.g. Next.js Pages Router) — a hard error, distinct from "not
   * this framework", so an unsupported project is never mistaken for an empty
   * directory to scaffold.
   */
  detect(cwd: string): Promise<FrameworkFacts | null>;
}
