import handle from "../../src/handler.js";

/**
 * Named method exports use the Web Standards Request/Response API so Vercel
 * does not treat the handler as the legacy `(req, res) => void` pattern.
 * We forward every HTTP verb that the Anthropic API uses (POST for messages,
 * GET for potential streaming / count-tokens) through the same handle().
 */
export const GET = handle;
export const POST = handle;
