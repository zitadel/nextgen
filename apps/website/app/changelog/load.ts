import { PHASE_PRODUCTION_BUILD } from "next/constants";

/**
 * What `fetcher` reads from GitHub, or `fallback` when GitHub does not answer
 * while the site builds: the build carries on, so GitHub never fails a
 * deploy, and the page shows the fallback until its first regeneration. A
 * regeneration rethrows, so the page served last stays up until one
 * succeeds.
 */
export async function load<T, F>(fetcher: () => Promise<T>, fallback: F): Promise<T | F> {
  try {
    return await fetcher();
  } catch (error) {
    if (
      process.env.NODE_ENV === "production" &&
      process.env.NEXT_PHASE !== PHASE_PRODUCTION_BUILD
    ) {
      throw error;
    }
    console.warn(`The changelog did not read GitHub: ${error}`);
    return fallback;
  }
}
