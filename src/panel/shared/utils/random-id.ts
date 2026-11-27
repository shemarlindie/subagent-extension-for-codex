/**
 * A random 128-bit id in hex. getRandomValues also works in the supported
 * HTTP LAN console, where randomUUID doesn't.
 */
export function randomId() {
  return Array.from(crypto.getRandomValues(new Uint32Array(4)), (part) =>
    part.toString(16).padStart(8, "0"),
  ).join("");
}
