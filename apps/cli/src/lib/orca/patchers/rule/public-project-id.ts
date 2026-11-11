/**
 * The variable each framework's client code reads the project id from. Each
 * framework exposes only variables with its own prefix to the browser, so the
 * id is written under this name beside `ZITADEL_PROJECT_ID`. Angular is absent:
 * its dev proxy attaches the project, and no client code reads an id.
 */
export const PUBLIC_PROJECT_ID_VARIABLE = {
  next: "NEXT_PUBLIC_ZITADEL_PROJECT_ID",
  nuxt: "NUXT_PUBLIC_ZITADEL_PROJECT_ID",
  qwik: "VITE_ZITADEL_PROJECT_ID",
  react: "VITE_ZITADEL_PROJECT_ID",
  solid: "VITE_ZITADEL_PROJECT_ID",
  svelte: "VITE_ZITADEL_PROJECT_ID",
  vue: "VITE_ZITADEL_PROJECT_ID",
} as const;
