import { describe, expect, it } from "vitest";
import { applyRentalLossLimit, rentalLossSpecialAllowanceCents } from "./rentalLoss";

describe("rental passive-loss limits", () => {
  it("phases the joint federal and California special allowance out from $100k to $150k MAGI", () => {
    expect(rentalLossSpecialAllowanceCents(100_000_00, "married-joint", true)).toBe(25_000_00);
    expect(rentalLossSpecialAllowanceCents(120_000_00, "married-joint", true)).toBe(15_000_00);
    expect(rentalLossSpecialAllowanceCents(150_000_00, "married-joint", true)).toBe(0);
  });

  it("carries disallowed loss forward and releases it against later rental profit", () => {
    const loss = applyRentalLossLimit({netRentalCents:-31_000_00,priorCarryforwardCents:0,modifiedAgiCents:120_000_00,filingStatus:"married-joint",activeParticipation:true,nonPassive:false});
    expect(loss).toEqual({allowedRentalCents:-15_000_00,carryforwardCents:16_000_00});
    expect(applyRentalLossLimit({netRentalCents:20_000_00,priorCarryforwardCents:loss.carryforwardCents,modifiedAgiCents:200_000_00,filingStatus:"married-joint",activeParticipation:true,nonPassive:false}))
      .toEqual({allowedRentalCents:4_000_00,carryforwardCents:0});
  });

  it("allows the full result for a federal nonpassive real-estate-professional activity", () => {
    expect(applyRentalLossLimit({netRentalCents:-40_000_00,priorCarryforwardCents:5_000_00,modifiedAgiCents:300_000_00,filingStatus:"married-joint",activeParticipation:true,nonPassive:true}))
      .toEqual({allowedRentalCents:-45_000_00,carryforwardCents:0});
  });
});
