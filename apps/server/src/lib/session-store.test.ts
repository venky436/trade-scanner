// Kite token day: tokens expire at ~06:00 IST — lastKiteReset() gives the most recent 06:00 IST.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { lastKiteReset } from "./session-store.js";

const ist = (y: number, mo: number, d: number, h: number, mi: number) => Date.UTC(y, mo - 1, d, h, mi) - 330 * 60_000;

describe("lastKiteReset (06:00 IST)", () => {
  it("after 06:00 → today's 06:00", () => assert.equal(lastKiteReset(ist(2026, 11, 11, 8, 8)), ist(2026, 11, 11, 6, 0)));
  it("before 06:00 → yesterday's 06:00", () => assert.equal(lastKiteReset(ist(2026, 11, 11, 5, 59)), ist(2026, 11, 10, 6, 0)));
  it("exactly 06:00 → today", () => assert.equal(lastKiteReset(ist(2026, 11, 11, 6, 0)), ist(2026, 11, 11, 6, 0)));
  it("a token saved yesterday 10:21 is before today's reset (expired), one saved today 08:05 is not", () => {
    const reset = lastKiteReset(ist(2026, 11, 11, 9, 0));
    assert.ok(ist(2026, 11, 10, 10, 21) < reset);
    assert.ok(ist(2026, 11, 11, 8, 5) >= reset);
  });
});
