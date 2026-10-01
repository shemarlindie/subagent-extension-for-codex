import { randomBytes, timingSafeEqual } from "node:crypto";
export class Auth {
  sessions = new Map<string, { owner: string; expires: number }>();
  bootstraps = new Map<string, { owner: string; expires: number }>();
  constructor(
    public token: string,
    public owner = "local",
  ) {}
  matches(input: string) {
    const a = Buffer.from(input),
      b = Buffer.from(this.token);
    return a.length === b.length && timingSafeEqual(a, b);
  }
  bootstrap(owner: string) {
    const key = randomBytes(32).toString("base64url");
    this.bootstraps.set(key, { owner, expires: Date.now() + 30000 });
    return key;
  }
  exchange(key: string) {
    const b = this.bootstraps.get(key);
    this.bootstraps.delete(key);
    if (!b || b.expires < Date.now())
      throw new Error("Bootstrap expired or already used");
    return this.session(b.owner);
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
    for (const m of [this.sessions, this.bootstraps])
      for (const [key, s] of m) if (s.expires < Date.now()) m.delete(key);
  }
}
