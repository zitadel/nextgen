import { createHash, randomBytes } from "node:crypto";

function base64UrlEncode(buffer: Buffer): string {
  return buffer.toString("base64url");
}

export type PkcePair = {
  codeChallenge: string;
  codeVerifier: string;
};

export function createPkcePair(): PkcePair {
  const codeVerifier = base64UrlEncode(randomBytes(32));
  return { codeChallenge: createCodeChallenge(codeVerifier), codeVerifier };
}

export function createCodeChallenge(codeVerifier: string): string {
  return base64UrlEncode(createHash("sha256").update(codeVerifier).digest());
}
