import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { closeEntryTrade } from "./close-entry.js";
import { day, flat } from "./test-helpers.js";

// AGI-shaped BUY: c1 low 649.30, c3 close 653.05
const agi: [number, number, number, number, number][] = [
  [649.85, 650, 649.3, 649.85, 1000], // c1
  [649.85, 653.9, 649.75, 652.7, 5000], // c2
  [652.7, 653.75, 652.7, 653.05, 2000], // c3
];

describe("entry at candle 3 close, stop at candle 1's low (BUY) / high (SELL)", () => {
  it("BUY: entry = candle 3 close, stop = candle 1 LOW, held to the close", () => {
    const c = day([...agi, ...flat(80, 655)]);
    const t = closeEntryTrade(c, c.length, 1, 2, 0, 0)!;
    assert.equal(t.entry, 653.05);
    assert.equal(t.stop, 649.3, "candle 1's low, not its close (649.85)");
    assert.equal(t.reason, "CLOSE");
    assert.equal(t.exit, 655);
  });
  it("BUY: a later candle trading below candle 1's low → stopped at 649.30", () => {
    const c = day([...agi, [653, 653.2, 649.2, 649.5, 1000], ...flat(5, 650)]);
    const t = closeEntryTrade(c, c.length, 1, 2, 0, 0)!;
    assert.equal(t.reason, "STOP");
    assert.equal(t.exit, 649.3);
  });
  it("BUY: dipping to 649.40 (above the low) is NOT a stop", () => {
    const c = day([...agi, [653, 653.2, 649.4, 650, 1000], ...flat(80, 652)]);
    assert.equal(closeEntryTrade(c, c.length, 1, 2, 0, 0)!.reason, "CLOSE");
  });
  it("SELL: entry = candle 3 close, stop = candle 1 HIGH (PERSISTENT shape)", () => {
    const c = day([[6188, 6191, 6168, 6168, 1000], [6169.5, 6172, 6137.5, 6138, 5000], [6138, 6152.5, 6135.5, 6150, 2000], [6150, 6190, 6140, 6185, 1000], ...flat(80, 6100)]);
    const t = closeEntryTrade(c, c.length, -1, 2, 0, 0)!;
    assert.equal(t.entry, 6150);
    assert.equal(t.stop, 6191, "candle 1's high, not its close (6168)");
    assert.equal(t.reason, "CLOSE", "6190 did not reach 6191");
    assert.equal(t.exit, 6100);
  });
  it("a candle opening beyond the stop exits at that open", () => {
    const c = day([...agi, [648, 648.5, 647, 648.2, 1000]]);
    const t = closeEntryTrade(c, c.length, 1, 2, 0, 0)!;
    assert.equal(t.reason, "STOP_GAP");
    assert.equal(t.exit, 648);
  });
});
