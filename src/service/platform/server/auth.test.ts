import assert from "node:assert/strict";

import { test } from "vitest";

import { Auth } from "./auth.js";

test("owner-scoped sessions, expiration, pruning and token comparison", () => {
  const auth = new Auth("private-token");
  assert.equal(auth.matches("private-token"), true);
  assert.equal(auth.matches("wrong"), false);
  assert.equal(auth.matches("private-taken"), false);
  const alice = auth.session("alice");
  const bob = auth.session("bob");
  assert.equal(auth.ownerFor(`other=value; ac_session=${alice}`), "alice");
  assert.equal(auth.ownerFor(`ac_session=${bob}; other=value`), "bob");
  assert.equal(auth.ownerFor(undefined), undefined);
  assert.equal(auth.ownerFor("ac_session=unknown"), undefined);
  auth.sessions.get(alice)!.expires = 0;
  assert.equal(auth.ownerFor(`ac_session=${alice}`), undefined);
  auth.prune();
  assert.equal(auth.sessions.has(alice), false);
  assert.equal(auth.sessions.has(bob), true);
  assert.equal(auth.ownerFor(`ac_session=${bob}`), "bob");
});
