import { invoke } from "@tauri-apps/api/core";

export interface BootstrapAccount { id:string; householdId:string; name:string; kind:"checking"|"savings"|"investment"|"retirement"|"credit"; openingBalanceCents:number; annualReturnBps:number; liquid:boolean; revision:number }
export interface BootstrapPerson {id:string;householdId:string;name:string;birthDate?:string|null}
export interface Bootstrap { onboardingStep:number; onboardingComplete:boolean; household?:{id:string;name:string;state:string}; people:BootstrapPerson[]; accounts:BootstrapAccount[]; categories:{id:string;name:string;kind:string;revision:number}[] }
export interface Repository {
  bootstrap():Promise<Bootstrap>;
  saveOnboardingStep(step:number,payload:unknown):Promise<void>;
  completeOnboarding():Promise<void>;
}

export const tauriRepository:Repository = {
  bootstrap:()=>invoke("get_bootstrap"),
  saveOnboardingStep:(step,payload)=>invoke("save_onboarding_step",{step,payload}),
  completeOnboarding:()=>invoke("complete_onboarding"),
};

export const testRepository:Repository = {
  async bootstrap(){return {onboardingStep:8,onboardingComplete:true,household:{id:"test",name:"Test household",state:"CA"},people:[{id:"person",householdId:"test",name:"Test Person"}],accounts:[{id:"cash",householdId:"test",name:"Test checking",kind:"checking",openingBalanceCents:0,annualReturnBps:0,liquid:true,revision:1}],categories:[]}},
  async saveOnboardingStep(){}, async completeOnboarding(){}
};
