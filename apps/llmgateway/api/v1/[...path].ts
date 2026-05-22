import { vercelEntry } from "../../src/vercel-adapter.js";

export const config = { runtime: "nodejs" } as const;

export default vercelEntry;
