import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/** The header that carries a client's challenge to `/health`. */
export const challengeHeader = "x-codex-subagent-extension-challenge";

const challengePattern = /^[A-Za-z0-9_-]{32,128}$/;

export const newChallenge = () => randomBytes(32).toString("base64url");

export function validChallenge(value: unknown): value is string {
  return typeof value === "string" && challengePattern.test(value);
}

/**
 * The service's answer to a challenge, which proves it holds the admin token
 * without revealing it. A client checks it before sending the token, so
 * another local user's process listening on the port can't collect the token.
 */
export function healthProof(token: string, challenge: string) {
  return createHmac("sha256", token)
    .update(`codex-subagent-extension health\0${challenge}`)
    .digest("base64url");
}

/** Whether `proof` answers `challenge` with `token`. */
export function provesToken(token: string, challenge: string, proof: unknown) {
  if (typeof proof !== "string") return false;
  const expected = Buffer.from(healthProof(token, challenge));
  const actual = Buffer.from(proof);

  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
