/**
 * The project's declared apps: one file per app under `.zitadel/apps/`, each
 * the document `POST /apps` takes as `app` (ADR 082 §3). A deploy sends them in
 * the release bundle, so an app changes with the release that declares it.
 */
export const APPS_DIR = ".zitadel/apps";
