import type { Cents, FilingStatus } from "./types";

export interface RentalLossLimitInput { netRentalCents:Cents; priorCarryforwardCents:Cents; modifiedAgiCents:Cents; filingStatus:FilingStatus; activeParticipation:boolean; nonPassive:boolean }
export interface RentalLossLimitResult { allowedRentalCents:Cents; carryforwardCents:Cents }

export function rentalLossSpecialAllowanceCents(modifiedAgiCents:Cents,filingStatus:FilingStatus,activeParticipation:boolean):Cents {
  if(!activeParticipation)return 0;
  const separate=filingStatus==="married-separate",maximum=separate?12_500_00:25_000_00,start=separate?50_000_00:100_000_00;
  return Math.max(0,maximum-Math.round(Math.max(0,modifiedAgiCents-start)/2));
}

export function applyRentalLossLimit(input:RentalLossLimitInput):RentalLossLimitResult {
  const available=input.netRentalCents-input.priorCarryforwardCents;
  if(input.nonPassive)return {allowedRentalCents:available,carryforwardCents:0};
  if(available>=0)return {allowedRentalCents:available,carryforwardCents:0};
  const allowedLoss=Math.min(-available,rentalLossSpecialAllowanceCents(input.modifiedAgiCents,input.filingStatus,input.activeParticipation));
  return {allowedRentalCents:-allowedLoss,carryforwardCents:-available-allowedLoss};
}
