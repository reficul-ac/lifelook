import { invoke } from "@tauri-apps/api/core";
import { open, save } from "@tauri-apps/plugin-dialog";

export type Theme = "system" | "light" | "dark";
export type AccountKind = "checking" | "savings" | "investment" | "retirement" | "credit";
export interface RepositoryError { code:string; message:string; field?:string; details?:unknown }
export interface StartupError extends RepositoryError { profilePath?:string; retryable:boolean }
export interface WorkspaceInfo { householdName:string; profilePath:string }
export interface BootstrapPerson { id:string; householdId:string; name:string; birthDate?:string|null; revision?:number }
export interface BootstrapAccount { id:string; householdId:string; name:string; kind:AccountKind; openingBalanceCents:number; balanceCents:number; annualReturnBps:number; liquid:boolean; revision:number }
export interface TaxProfile { filingStatus:"single"|"married-joint"|"married-separate"|"head-of-household"; state:"CA"; taxYear:2025|2026; thresholdInflationBps:number; revision:number }
export interface Settings { theme:Theme; reducedMotion:boolean; revision:number }
export interface Category { id:string; householdId:string; name:string; kind:"income"|"expense"|"transfer"; revision:number; archived?:boolean }
export interface ActivityPosting { postingId:number; entryId:string; occurredOn:string; kind:"income"|"expense"|"transfer"|"adjustment"; origin?:"manual"|"import"|"reconciliation"; canDelete?:boolean; description:string; note?:string|null; transferGroupId?:string|null; accountId:string; accountName:string; categoryId?:string|null; categoryName?:string|null; amountCents:number; revision:number }
export type RecurringFrequency="weekly"|"biweekly"|"monthly"|"quarterly"|"annual";
export interface RecurringEntry { id:string; householdId:string; categoryId:string; accountId?:string|null; name:string; amountCents:number; frequency:RecurringFrequency; startDate:string; endDate?:string|null; annualGrowthBps:number; taxTreatment?:"none"|"pretax"; revision:number }
export interface RecurringInput { id:string;categoryId:string;accountId?:string|null;name:string;amountCents:number;frequency:RecurringFrequency;startDate:string;endDate?:string|null;annualGrowthBps:number;taxTreatment?:"none"|"pretax" }
export interface AppreciationCurve { startYear:number;startRateBps:number;endYear:number;endRateBps:number }
export interface PrivateStockVesting { vestedBps:number;vestingStartDate:string;remainingVestingQuarters:number }
export interface Asset { id:string; householdId:string; name:string; valueCents:number; annualGrowthBps:number; appreciationCurve?:AppreciationCurve|null; privateStock?:PrivateStockVesting|null; housingCosts?:import("./domain/types").HousingCosts; purchasePriceCents?:number|null; purchaseDate?:string|null; revision:number }
export interface MortgageTerms { originalPrincipalCents:number; termMonths:number; startDate:string; paymentOverrideCents?:number|null; assetId?:string|null }
export interface Liability { id:string; householdId:string; name:string; balanceCents:number; annualRateBps:number; minimumPaymentCents:number; mortgage?:MortgageTerms|null; revision:number }
export interface AssetInput { id:string;name:string;valueCents:number;annualGrowthBps:number;appreciationCurve?:AppreciationCurve|null;privateStock?:PrivateStockVesting|null;housingCosts?:import("./domain/types").HousingCosts }
export interface LiabilityInput { id:string;name:string;balanceCents:number;annualRateBps:number;minimumPaymentCents:number;mortgage?:MortgageTerms|null }
export interface HomeInput { assetId:string;liabilityId?:string|null;name:string;purchasePriceCents:number;currentValueCents:number;annualGrowthBps:number;appreciationCurve?:AppreciationCurve|null;purchaseDate:string;propertyTaxRateBps:number;insuranceAnnualCents:number;financed:boolean;downPaymentBps?:number;termMonths?:number;annualRateBps?:number;asOfDate:string }
export interface OnboardingStepPayload {
  household?:{id:string;name:string;state:"CA"};
  people?:BootstrapPerson[];
  taxProfile?:TaxProfile;
  accounts?:BootstrapAccount[];
  recurring?:{kind:"income"|"expense";items:RecurringInput[]};
  assets?:AssetInput[];
  liabilities?:LiabilityInput[];
}
export interface ScenarioAllocation { id?:string;accountId:string;priority:number;percentBps:number;targetBalanceCents?:number|null }
export interface ScenarioRecord { id:string; householdId:string; name:string; isBaseline:boolean; assumptions:{inflationBps:number;thresholdInflationBps:number}; horizonMonths:number; revision:number; events:import("./domain/types").ScenarioEvent[]; allocations:ScenarioAllocation[]; withdrawals:import("./domain/types").WithdrawalRule[]; goals:import("./domain/types").ScenarioGoal[] }
export interface WorkspaceSnapshot {
  onboardingStep:number; onboardingComplete:boolean;
  household?:{id:string;name:string;state:string}; people:BootstrapPerson[];
  taxProfile?:TaxProfile|null; settings:Settings; accounts:BootstrapAccount[];
  categories:Category[]; activity:ActivityPosting[]; recurring:RecurringEntry[];
  assets:Asset[]; liabilities:Liability[]; scenarios:ScenarioRecord[];
}
export type Bootstrap = WorkspaceSnapshot;
export type BootstrapInput = Pick<WorkspaceSnapshot,"onboardingStep"|"onboardingComplete"|"people"|"categories"> & {accounts:(BootstrapAccount|Omit<BootstrapAccount,"balanceCents">)[];scenarios?:Array<Omit<ScenarioRecord,"withdrawals"|"goals">&{withdrawals?:ScenarioRecord["withdrawals"];goals?:ScenarioRecord["goals"]}>} & Partial<Omit<WorkspaceSnapshot,"onboardingStep"|"onboardingComplete"|"people"|"accounts"|"categories"|"scenarios">>;
export interface TransactionInput { id:string; occurredOn:string; accountId:string; categoryId:string; amountCents:number; description:string; note?:string|null }
export interface UpdateTransactionInput extends Omit<TransactionInput,"id"> { id:string; expectedRevision:number }
export interface TransferInput { id:string;occurredOn:string;fromAccountId:string;toAccountId:string;amountCents:number;expectedRevision?:number }
export interface AccountInput { id:string;name:string;kind:AccountKind;openingBalanceCents:number;annualReturnBps:number }
export type CsvDateFormat="iso"|"us";
export type CsvAmountLayout="signed"|"debitCredit";
export interface CsvMapping { accountId:string; dateColumn:string; descriptionColumn:string; noteColumn?:string|null; amountLayout:CsvAmountLayout; amountColumn?:string|null; debitColumn?:string|null; creditColumn?:string|null; inflowPositive:boolean; dateFormat:CsvDateFormat }
export interface CsvInspection { path:string; fileHash:string; headers:string[]; rowCount:number; savedMapping?:CsvMapping|null }
export type CsvDuplicateState="none"|"file"|"existing";
export interface CsvPreviewRow { rowNumber:number; occurredOn?:string|null; description:string; note?:string|null; amountCents?:number|null; kind?:"income"|"expense"|null; categoryId?:string|null; categoryName?:string|null; valid:boolean; error?:string|null; duplicate:CsvDuplicateState; include:boolean }
export interface CsvPreview { path:string; fileHash:string; mapping:CsvMapping; rows:CsvPreviewRow[] }
export interface CsvCommitRow { rowNumber:number; categoryId:string; include:boolean }
export interface CsvImportResult { batchId:string; importedCount:number; skippedCount:number }
export interface AccountDeletionImpact { accountId:string; canDelete:boolean; blockers:string[] }
export interface Repository {
  bootstrap():Promise<BootstrapInput>;
  workspaceInfo?():Promise<WorkspaceInfo>;
  systemThemeDark?():Promise<boolean|null>;
  retryStartup():Promise<BootstrapInput>;
  saveOnboardingStep(step:number,payload:OnboardingStepPayload):Promise<void>;
  completeOnboarding():Promise<void>;
  createTransaction?(input:TransactionInput):Promise<void>;
  updateTransaction?(input:UpdateTransactionInput):Promise<void>;
  createTransfer?(input:TransferInput):Promise<void>;
  updateTransfer?(input:TransferInput&{expectedRevision:number}):Promise<void>;
  deleteTransaction?(input:{id:string;expectedRevision:number}):Promise<void>;
  createAccount?(input:AccountInput):Promise<void>;
  updateAccount?(input:{id:string;name:string;kind:AccountKind;annualReturnBps:number;expectedRevision:number}):Promise<void>;
  reconcileAccount?(input:{id:string;occurredOn:string;targetBalanceCents:number;expectedBalanceCents:number}):Promise<void>;
  accountDeletionImpact?(accountId:string):Promise<AccountDeletionImpact>;
  deleteAccount?(input:{id:string;expectedRevision:number}):Promise<void>;
  createAsset?(input:AssetInput):Promise<void>;
  createHome?(input:HomeInput):Promise<void>;
  updateAsset?(input:AssetInput&{expectedRevision:number}):Promise<void>;
  deleteAsset?(input:{id:string;expectedRevision:number}):Promise<void>;
  createLiability?(input:LiabilityInput):Promise<void>;
  updateLiability?(input:LiabilityInput&{expectedRevision:number}):Promise<void>;
  deleteLiability?(input:{id:string;expectedRevision:number}):Promise<void>;
  createRecurring?(input:RecurringInput):Promise<void>;
  updateRecurring?(input:RecurringInput&{expectedRevision:number}):Promise<void>;
  deleteRecurring?(input:{id:string;expectedRevision:number}):Promise<void>;
  createScenario?(input:{id:string;name:string;cloneFromId?:string|null}):Promise<void>;
  updateScenario?(input:{id:string;name:string;assumptions:ScenarioRecord["assumptions"];horizonMonths:number;events:ScenarioRecord["events"];allocations:ScenarioAllocation[];withdrawals:import("./domain/types").WithdrawalRule[];goals:import("./domain/types").ScenarioGoal[];expectedRevision:number}):Promise<void>;
  deleteScenario?(input:{id:string;expectedRevision:number}):Promise<void>;
  selectCsvSource?():Promise<string|null>;
  inspectCsv?(path:string):Promise<CsvInspection>;
  previewCsv?(path:string,fileHash:string,mapping:CsvMapping):Promise<CsvPreview>;
  commitCsv?(preview:CsvPreview,rows:CsvCommitRow[]):Promise<CsvImportResult>;
  selectActivityExportDestination?():Promise<string|null>;
  exportActivityCsv?(destination:string,postingIds:number[]):Promise<void>;
  updateSettings?(input:{theme:Theme;reducedMotion:boolean;expectedRevision:number}):Promise<Settings>;
  selectBackupDestination?():Promise<string|null>;
  selectRestoreSource?():Promise<string|null>;
  backupDatabase?(destination:string):Promise<void>;
  restoreDatabase?(source:string):Promise<BootstrapInput>;
  resetProfile?():Promise<BootstrapInput>;
}

const backupFilters=[{name:"LifeLook backup",extensions:["lifelook"]}];
const backupFilename=()=>`LifeLook-backup-${new Date().toISOString().slice(0,10)}.lifelook`;

export const tauriRepository:Repository = {
  bootstrap:()=>invoke("get_bootstrap"),
  workspaceInfo:()=>invoke("get_workspace_info"),
  systemThemeDark:()=>invoke("system_theme_dark"),
  retryStartup:()=>invoke("retry_startup"),
  saveOnboardingStep:(step,payload)=>invoke("save_onboarding_step",{step,payload}),
  completeOnboarding:()=>invoke("complete_onboarding"),
  createTransaction:(input)=>invoke("create_transaction",{input}),
  updateTransaction:(input)=>invoke("update_transaction",{input}),
  createTransfer:(input)=>invoke("create_transfer",{input}),
  updateTransfer:(input)=>invoke("update_transfer",{input}),
  deleteTransaction:(input)=>invoke("delete_transaction",{input}),
  createAccount:(input)=>invoke("create_account",{input}),
  updateAccount:(input)=>invoke("update_account",{input}),
  reconcileAccount:(input)=>invoke("reconcile_account",{input}),
  accountDeletionImpact:(accountId)=>invoke("account_deletion_impact",{accountId}),
  deleteAccount:(input)=>invoke("delete_account",{input}),
  createAsset:(input)=>invoke("create_asset",{input}),
  createHome:(input)=>invoke("create_home",{input}),
  updateAsset:(input)=>invoke("update_asset",{input}),
  deleteAsset:(input)=>invoke("delete_asset",{input}),
  createLiability:(input)=>invoke("create_liability",{input}),
  updateLiability:(input)=>invoke("update_liability",{input}),
  deleteLiability:(input)=>invoke("delete_liability",{input}),
  createRecurring:(input)=>invoke("create_recurring",{input}),
  updateRecurring:(input)=>invoke("update_recurring",{input}),
  deleteRecurring:(input)=>invoke("delete_recurring",{input}),
  createScenario:(input)=>invoke("create_scenario",{input}),
  updateScenario:(input)=>invoke("update_scenario",{input}),
  deleteScenario:(input)=>invoke("delete_scenario",{input}),
  selectCsvSource:async()=>{const selected=await open({multiple:false,directory:false,filters:[{name:"CSV files",extensions:["csv"]}]});return typeof selected==="string"?selected:null},
  inspectCsv:(path)=>invoke("inspect_csv",{path}),
  previewCsv:(path,fileHash,mapping)=>invoke("preview_csv",{path,fileHash,mapping}),
  commitCsv:(preview,rows)=>invoke("commit_csv",{preview,rows}),
  selectActivityExportDestination:()=>save({defaultPath:`LifeLook-activity-${new Date().toISOString().slice(0,10)}.csv`,filters:[{name:"CSV files",extensions:["csv"]}]}),
  exportActivityCsv:(destination,postingIds)=>invoke("export_activity_csv",{destination,postingIds}),
  updateSettings:(input)=>invoke("update_settings",{input}),
  selectBackupDestination:()=>save({defaultPath:backupFilename(),filters:backupFilters}),
  selectRestoreSource:async()=>{
    const selected=await open({multiple:false,directory:false,filters:backupFilters});
    return typeof selected==="string"?selected:null;
  },
  backupDatabase:(destination)=>invoke("backup_database",{destination}),
  restoreDatabase:(source)=>invoke("restore_database",{source}),
  resetProfile:()=>invoke("reset_profile"),
};

export const emptySettings:Settings={theme:"system",reducedMotion:false,revision:1};
export const testRepository:Repository = {
  async bootstrap(){return {onboardingStep:8,onboardingComplete:true,household:{id:"test",name:"Test household",state:"CA"},people:[{id:"person",householdId:"test",name:"Test Person"}],taxProfile:null,settings:emptySettings,accounts:[{id:"cash",householdId:"test",name:"Test checking",kind:"checking",openingBalanceCents:0,balanceCents:0,annualReturnBps:0,liquid:true,revision:1}],categories:[],activity:[],recurring:[],assets:[],liabilities:[],scenarios:[]}},
  async retryStartup(){return this.bootstrap()}, async saveOnboardingStep(){}, async completeOnboarding(){}, async createTransaction(){}, async updateTransaction(){}, async createTransfer(){}, async updateTransfer(){},async createAccount(){},async updateAccount(){},async reconcileAccount(){},async createAsset(){},async updateAsset(){},async deleteAsset(){},async createLiability(){},async updateLiability(){},async deleteLiability(){},
  async updateSettings(input){return {...input,revision:input.expectedRevision+1}},
  async selectActivityExportDestination(){return null}, async selectBackupDestination(){return null}, async selectRestoreSource(){return null},
  async exportActivityCsv(){},
  async backupDatabase(){}, async restoreDatabase(){return this.bootstrap()}, async resetProfile(){return {onboardingStep:0,onboardingComplete:false,people:[],accounts:[],categories:[]}}
};
