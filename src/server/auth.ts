import { randomBytes, timingSafeEqual } from "node:crypto";
export class Auth {
  sessions = new Map<string, { owner: string; expires: number }>();
  constructor(
    public token: string,
    public owner = "local",
  ) {}
  matches(input: string) {
    const a = Buffer.from(input),
      b = Buffer.from(this.token);
    return a.length === b.length && timingSafeEqual(a, b);
  }
  session(owner: string) {
    const key = randomBytes(32).toString("base64url");
    this.sessions.set(key, { owner, expires: Date.now() + 3600000 });
    return key;
  }
  ownerFor(cookie: string | undefined) {
    const key = (cookie ?? "")
      .split(";")
      .map((x) => x.trim())
      .find((x) => x.startsWith("ac_session="))
      ?.slice(11);
    const s = key ? this.sessions.get(key) : undefined;
    return s && s.expires > Date.now() ? s.owner : undefined;
  }
  prune() {
    for (const [key, s] of this.sessions)
      if (s.expires < Date.now()) this.sessions.delete(key);
  }
}
