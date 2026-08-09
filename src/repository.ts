import { invoke } from "@tauri-apps/api/core";

export type Theme = "system" | "light" | "dark";
export type AccountKind = "checking" | "savings" | "investment" | "retirement" | "credit";
export interface RepositoryError { code:string; message:string; field?:string; details?:unknown }
export interface StartupError extends RepositoryError { profilePath?:string; retryable:boolean }
export interface BootstrapPerson { id:string; householdId:string; name:string; birthDate?:string|null; revision?:number }
export interface BootstrapAccount { id:string; householdId:string; name:string; kind:AccountKind; openingBalanceCents:number; balanceCents:number; annualReturnBps:number; liquid:boolean; revision:number }
export interface TaxProfile { filingStatus:"single"|"married-joint"|"married-separate"|"head-of-household"; state:"CA"; taxYear:2025|2026; thresholdInflationBps:number; revision:number }
export interface Settings { theme:Theme; reducedMotion:boolean; revision:number }
export interface Category { id:string; householdId:string; name:string; kind:"income"|"expense"|"transfer"; revision:number }
export interface ActivityPosting { postingId:number; entryId:string; occurredOn:string; kind:"income"|"expense"|"transfer"|"adjustment"; description:string; note?:string|null; transferGroupId?:string|null; accountId:string; accountName:string; categoryId?:string|null; categoryName?:string|null; amountCents:number; revision:number }
export interface RecurringEntry { id:string; householdId:string; categoryId:string; accountId?:string|null; name:string; amountCents:number; startDate:string; endDate?:string|null; annualGrowthBps:number; revision:number }
export interface Asset { id:string; householdId:string; name:string; valueCents:number; annualGrowthBps:number; revision:number }
export interface Liability { id:string; householdId:string; name:string; balanceCents:number; annualRateBps:number; minimumPaymentCents:number; revision:number }
export interface ScenarioRecord { id:string; householdId:string; name:string; isBaseline:boolean; assumptions:{inflationBps:number;thresholdInflationBps:number}; horizonMonths:number; revision:number; events:unknown[]; allocations:unknown[] }
export interface WorkspaceSnapshot {
  onboardingStep:number; onboardingComplete:boolean;
  household?:{id:string;name:string;state:string}; people:BootstrapPerson[];
  taxProfile?:TaxProfile|null; settings:Settings; accounts:BootstrapAccount[];
  categories:Category[]; activity:ActivityPosting[]; recurring:RecurringEntry[];
  assets:Asset[]; liabilities:Liability[]; scenarios:ScenarioRecord[];
}
export type Bootstrap = WorkspaceSnapshot;
export type BootstrapInput = Pick<WorkspaceSnapshot,"onboardingStep"|"onboardingComplete"|"people"|"categories"> & {accounts:(BootstrapAccount|Omit<BootstrapAccount,"balanceCents">)[]} & Partial<Omit<WorkspaceSnapshot,"onboardingStep"|"onboardingComplete"|"people"|"accounts"|"categories">>;
export interface TransactionInput { id:string; occurredOn:string; accountId:string; categoryId:string; amountCents:number; description:string; note?:string|null }
export interface Repository {
  bootstrap():Promise<BootstrapInput>;
  retryStartup():Promise<BootstrapInput>;
  saveOnboardingStep(step:number,payload:unknown):Promise<void>;
  completeOnboarding():Promise<void>;
  createTransaction?(input:TransactionInput):Promise<void>;
  createTransfer?(input:{id:string;occurredOn:string;fromAccountId:string;toAccountId:string;amountCents:number}):Promise<void>;
  updateSettings?(input:{theme:Theme;reducedMotion:boolean;expectedRevision:number}):Promise<Settings>;
  backupDatabase?(destination:string):Promise<void>;
}

export const tauriRepository:Repository = {
  bootstrap:()=>invoke("get_bootstrap"),
  retryStartup:()=>invoke("retry_startup"),
  saveOnboardingStep:(step,payload)=>invoke("save_onboarding_step",{step,payload}),
  completeOnboarding:()=>invoke("complete_onboarding"),
  createTransaction:(input)=>invoke("create_transaction",{input}),
  createTransfer:(input)=>invoke("create_transfer",input),
  updateSettings:(input)=>invoke("update_settings",{input}),
  backupDatabase:(destination)=>invoke("backup_database",{destination}),
};

export const emptySettings:Settings={theme:"system",reducedMotion:false,revision:1};
export const testRepository:Repository = {
  async bootstrap(){return {onboardingStep:8,onboardingComplete:true,household:{id:"test",name:"Test household",state:"CA"},people:[{id:"person",householdId:"test",name:"Test Person"}],taxProfile:null,settings:emptySettings,accounts:[{id:"cash",householdId:"test",name:"Test checking",kind:"checking",openingBalanceCents:0,balanceCents:0,annualReturnBps:0,liquid:true,revision:1}],categories:[],activity:[],recurring:[],assets:[],liabilities:[],scenarios:[]}},
  async retryStartup(){return this.bootstrap()}, async saveOnboardingStep(){}, async completeOnboarding(){}, async createTransaction(){}, async createTransfer(){},
  async updateSettings(input){return {...input,revision:input.expectedRevision+1}}, async backupDatabase(){}
};
