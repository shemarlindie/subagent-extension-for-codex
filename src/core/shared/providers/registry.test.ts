import { expect, test, vi } from "vitest";

test("settings require provider registration before their first read", async () => {
  vi.resetModules();

  const { settingsPatchSchema } =
    await import("../settings/settings-schema.js");

  expect(() => settingsPatchSchema()).toThrow("Register providers");
});
