import type {Available} from '../model/results';
import {MAX_CENTS} from '../money';
export interface ConversionBasisInput {readonly adjustedBuildingBasisCents:number;readonly buildingFmvCents:number}
export interface ConversionBasisResult {readonly gainBuildingBasisCents:number;readonly depreciationBuildingBasisCents:number}
export function resolveConversionBasis(input:ConversionBasisInput):Available<ConversionBasisResult>{
 if(![input.adjustedBuildingBasisCents,input.buildingFmvCents].every(v=>Number.isSafeInteger(v)&&v>=0&&v<=MAX_CENTS))return {status:'needs-data',issues:[{code:'required-conversion-basis',field:'conversionBasis',severity:'warning',explanation:'Conversion requires separate supported historical building basis and building-only fair-market value.',resolution:'Enter the basis and FMV for the affected tax book.'}]};
 return {status:'available',value:{gainBuildingBasisCents:input.adjustedBuildingBasisCents,depreciationBuildingBasisCents:Math.min(input.adjustedBuildingBasisCents,input.buildingFmvCents)}};
}
