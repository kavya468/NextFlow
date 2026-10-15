import { createRequire } from "node:module";
import { expect, it } from "vitest";

it("keeps the installed Trigger CLI's Zod record schema compatible", () => {
  const resolve = createRequire(import.meta.url);
  const triggerRequire = createRequire(resolve.resolve("trigger.dev/package.json"));
  const { z } = triggerRequire("zod");
  // Trigger 4.4.3 reads login profiles with Zod 3's single-argument record API.
  const profiles = z.record(z.object({ apiUrl: z.string() }));
  expect(profiles.safeParse({ default: { apiUrl: "https://api.trigger.dev" } }).success).toBe(true);
});
