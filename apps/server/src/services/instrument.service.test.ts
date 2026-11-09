// Non-share listing filter — real NSE symbols (checked against the full list 2026-11-09).
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { isNonShareListing } from "./instrument.service.js";

describe("isNonShareListing", () => {
  it("drops bonds, SME and trade-for-trade listings", () => {
    for (const s of ["903SFL28-YI", "656KA30-SG", "850NHAI29-N5", "840IRFC29-N8", "OMFURN-SM", "MILTON-ST", "DPABHUSHAN-BE", "SANWARIA-BZ", "SGBDEC25-GB", "364D010126-TB"]) {
      assert.equal(isNonShareListing(s), true, s);
    }
  });
  it("keeps every real share, including the 7 whose names contain a dash", () => {
    for (const s of ["RELIANCE", "INFY", "3MINDIA", "360ONE", "ARE&M", "M&M", "NAM-INDIA", "BAJAJ-AUTO", "HCL-INSYS", "BOSCH-HCIL", "UMIYA-MRO", "KLBRENG-B", "MCCHRLS-B"]) {
      assert.equal(isNonShareListing(s), false, s);
    }
  });
});
