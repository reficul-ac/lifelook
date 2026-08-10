import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { App } from "./App";
import { testRepository } from "./repository";
describe("LifeLook shell", () => {
  it("creates exact recurring planning inputs and retains invalid date drafts", async () => {
    const data=await testRepository.bootstrap(), category={id:"salary",householdId:"test",name:"Salary",kind:"income" as const,revision:1}, scenario={id:"base",householdId:"test",name:"Baseline",isBaseline:true,assumptions:{inflationBps:250,thresholdInflationBps:250},horizonMonths:120,revision:1,events:[],allocations:[]};
    const createRecurring=vi.fn(); render(<App repository={{...testRepository,createRecurring,bootstrap:async()=>({...data,categories:[category],scenarios:[scenario],taxProfile:{filingStatus:"single" as const,state:"CA" as const,taxYear:2026 as const,thresholdInflationBps:250,revision:1}})}}/>);
    fireEvent.click(await screen.findByRole("button",{name:/Plan/}));fireEvent.click(screen.getByRole("button",{name:"Add income"}));
    fireEvent.change(screen.getByLabelText("Name"),{target:{value:"Paycheck"}});fireEvent.change(screen.getByLabelText("Amount (USD)"),{target:{value:"1234.56"}});fireEvent.change(screen.getByLabelText("Frequency"),{target:{value:"biweekly"}});fireEvent.change(screen.getByLabelText("Start date"),{target:{value:"2026-08-10"}});fireEvent.change(screen.getByLabelText("End date (optional)"),{target:{value:"2026-08-09"}});fireEvent.submit(screen.getByRole("button",{name:"Save"}).closest("form")!);
    expect(await screen.findByRole("alert")).toHaveTextContent(/on or after/);expect(screen.getByLabelText("Name")).toHaveValue("Paycheck");expect(createRecurring).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText("End date (optional)"),{target:{value:"2027-08-09"}});fireEvent.click(screen.getByRole("button",{name:"Save"}));await waitFor(()=>expect(createRecurring).toHaveBeenCalledWith(expect.objectContaining({name:"Paycheck",amountCents:123456,frequency:"biweekly",annualGrowthBps:0})));
  });

  it("clones, edits, compares, and protects planning scenarios", async () => {
    const data=await testRepository.bootstrap(), base={id:"base",householdId:"test",name:"Baseline",isBaseline:true,assumptions:{inflationBps:250,thresholdInflationBps:250},horizonMonths:18,revision:1,events:[],allocations:[]}, alt={...base,id:"alt",name:"Lean",isBaseline:false}; const createScenario=vi.fn(),updateScenario=vi.fn();
    render(<App repository={{...testRepository,createScenario,updateScenario,bootstrap:async()=>({...data,scenarios:[base,alt],taxProfile:{filingStatus:"single" as const,state:"CA" as const,taxYear:2026 as const,thresholdInflationBps:250,revision:1}})}}/>);fireEvent.click(await screen.findByRole("button",{name:/Plan/}));expect(screen.getByRole("heading",{name:"18-month outlook"})).toBeInTheDocument();
    const checks=screen.getAllByRole("checkbox");fireEvent.click(checks[0]);fireEvent.click(checks[1]);expect(screen.getByRole("region",{name:"Scenario comparison"})).toBeInTheDocument();fireEvent.click(screen.getByRole("button",{name:"New scenario"}));expect(screen.getByLabelText(/Clone active/)).toBeChecked();fireEvent.change(screen.getByLabelText("Name"),{target:{value:"Growth"}});fireEvent.click(screen.getByRole("button",{name:"Create scenario"}));await waitFor(()=>expect(createScenario).toHaveBeenCalledWith(expect.objectContaining({name:"Growth",cloneFromId:"base"})));
  });
  it("navigates with accessible buttons", async () => {
    render(<App repository={testRepository} />);
    expect(
      await screen.findByRole("heading", { name: "Overview" }),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Plan/ }));
    expect(screen.getByRole("heading", { name: "Plan" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Plan/ })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("button", { name: /Overview/ })).not.toHaveAttribute("aria-current");
  });

  it("recovers from a startup failure without reloading", async () => {
    const bootstrap=vi.fn().mockRejectedValue({code:"corrupt",message:"Integrity check failed",profilePath:"/data/lifelook.db",retryable:true});
    let resolveRetry:(value:Awaited<ReturnType<typeof testRepository.bootstrap>>)=>void=()=>{};
    const retryStartup=vi.fn().mockReturnValue(new Promise(resolve=>{resolveRetry=resolve}));
    render(<App repository={{...testRepository,bootstrap,retryStartup}}/>);
    expect(await screen.findByRole("alert")).toHaveTextContent("Integrity check failed");
    expect(screen.getByText("/data/lifelook.db")).toBeInTheDocument();
    expect(screen.getByText(/has not been deleted, renamed, replaced, or changed/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button",{name:"Retry"}));
    expect(screen.getByRole("button",{name:"Retrying…"})).toBeDisabled();
    resolveRetry(await testRepository.bootstrap());
    expect(await screen.findByRole("heading",{name:"Overview"})).toBeInTheDocument();
    expect(retryStartup).toHaveBeenCalledTimes(1);
    expect(bootstrap).toHaveBeenCalledTimes(1);
  });

  it("renders a non-retryable incompatible profile safely", async () => {
    render(<App repository={{...testRepository,bootstrap:vi.fn().mockRejectedValue({code:"incompatible",message:"Newer profile",retryable:false})}}/>);
    expect(await screen.findByRole("alert")).toHaveTextContent("Newer profile");
    expect(screen.queryByRole("button",{name:"Retry"})).not.toBeInTheDocument();
    expect(screen.getByText(/newer LifeLook version/i)).toBeInTheDocument();
  });

  it("keeps recovery available after a failed retry", async () => {
    const failure={code:"unwritable",message:"Permission denied",profilePath:"/data/lifelook.db",retryable:true};
    render(<App repository={{...testRepository,bootstrap:vi.fn().mockRejectedValue(failure),retryStartup:vi.fn().mockRejectedValue(failure)}}/>);
    fireEvent.click(await screen.findByRole("button",{name:"Retry"}));
    expect(await screen.findByRole("alert")).toHaveTextContent("Permission denied");
    expect(screen.getByRole("button",{name:"Retry"})).toBeEnabled();
  });

  it("exposes native account radio groups", async () => {
    const repository={...testRepository,bootstrap:async()=>({onboardingStep:0,onboardingComplete:false,people:[],accounts:[],categories:[]})};
    render(<App repository={repository}/>);
    fireEvent.change(await screen.findByLabelText("Household name"),{target:{value:"Home"}});
    fireEvent.change(screen.getByLabelText("Person 1 name"),{target:{value:"Person"}});
    fireEvent.click(screen.getByRole("button",{name:"Save & Continue"}));
    expect(await screen.findByRole("group",{name:"Account 1 type"})).toBeInTheDocument();
    expect(screen.getAllByRole("radio")).toHaveLength(5);
  });

  it("connects Plan disclosures to labelled month regions", async () => {
    const data=await testRepository.bootstrap();
    const repository={...testRepository,bootstrap:async()=>({...data,taxProfile:{filingStatus:"single" as const,state:"CA" as const,taxYear:2026 as const,thresholdInflationBps:250,revision:1}})};
    render(<App repository={repository}/>);
    fireEvent.click(await screen.findByRole("button",{name:/Plan/}));
    const disclosure=screen.getByRole("button",{name:/2025/});
    expect(disclosure).toHaveAttribute("aria-expanded","false");
    fireEvent.click(disclosure);
    expect(disclosure).toHaveAttribute("aria-expanded","true");
    const region=screen.getByRole("region",{name:"2025 monthly detail"});
    expect(disclosure).toHaveAttribute("aria-controls",region.id);
  });

  it("retains member drafts, blocks duplicate saves, and retries after rejection", async () => {
    let rejectFirst:(reason:unknown)=>void=()=>{};
    const pending=new Promise<void>((_resolve,reject)=>{rejectFirst=reject});
    const save=vi.fn().mockReturnValueOnce(pending).mockResolvedValue(undefined);
    const repository={...testRepository,saveOnboardingStep:save};
    render(<App repository={repository}/>);
    fireEvent.click(await screen.findByRole("button",{name:/Settings/}));
    const input=screen.getByLabelText("Member 1 name");
    fireEvent.change(input,{target:{value:"Edited Person"}});
    const button=screen.getByRole("button",{name:"Save members"});
    fireEvent.click(button);
    expect(screen.getByRole("button",{name:"Saving…"})).toBeDisabled();
    fireEvent.click(screen.getByRole("button",{name:"Saving…"}));
    expect(save).toHaveBeenCalledTimes(1);
    rejectFirst({code:"io",message:"Disk is full"});
    const alert=await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Disk is full");
    await waitFor(()=>expect(alert).toHaveFocus());
    expect(input).toHaveValue("Edited Person");
    fireEvent.click(screen.getByRole("button",{name:"Save members"}));
    expect(await screen.findByRole("status")).toHaveTextContent("Household members saved");
    expect(save).toHaveBeenCalledTimes(2);
  });
  it("toggles theme", async () => {
    render(<App repository={testRepository} />);
    fireEvent.click(
      await screen.findByRole("button", { name: "Toggle theme" }),
    );
    expect(document.querySelector(".app")).toHaveClass("dark");
  });
  it("keeps only genuinely unavailable controls disabled", async () => {
    render(<App repository={testRepository}/>);
    await screen.findByRole("heading",{name:"Overview"});
    expect(screen.getByRole("button",{name:/Search \(not yet available\)/})).toBeDisabled();
    expect(screen.getByRole("button",{name:"Add"})).toBeEnabled();
    expect(screen.getByRole("button",{name:/Test Person/})).toBeDisabled();
    fireEvent.click(screen.getByRole("button",{name:/Net Worth/}));
    expect(screen.getByRole("button",{name:"Add account"})).toBeEnabled();
    fireEvent.click(screen.getByRole("button",{name:/Settings/}));
    expect(screen.getByRole("button",{name:"Back up data"})).toBeEnabled();
    expect(screen.getByRole("button",{name:"Choose backup"})).toBeEnabled();
  });
  it("offers all four Add modes and creates an exact income amount", async()=>{
    const data=await testRepository.bootstrap();const createTransaction=vi.fn();
    const repository={...testRepository,createTransaction,bootstrap:vi.fn().mockResolvedValue({...data,categories:[{id:"income",householdId:"test",name:"Pay",kind:"income" as const,revision:1},{id:"expense",householdId:"test",name:"Food",kind:"expense" as const,revision:1}]})};
    render(<App repository={repository}/>);fireEvent.click(await screen.findByRole("button",{name:"Add"}));
    expect(screen.getByRole("dialog")).toBeInTheDocument();for(const name of ["Income","Expense","Transfer","Account"])expect(screen.getByRole("button",{name})).toBeEnabled();
    fireEvent.click(screen.getByRole("button",{name:"Income"}));fireEvent.change(screen.getByLabelText("Amount (USD)"),{target:{value:"123.45"}});fireEvent.change(screen.getByLabelText("Description"),{target:{value:"Paycheck"}});fireEvent.click(screen.getByRole("button",{name:"Save"}));
    await waitFor(()=>expect(createTransaction).toHaveBeenCalledWith(expect.objectContaining({amountCents:12345,categoryId:"income",description:"Paycheck"})));await waitFor(()=>expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });
  it("retains transfer drafts, validates distinct accounts, and restores focus on Escape",async()=>{
    const data=await testRepository.bootstrap();const second={...data.accounts[0],id:"second",name:"Savings",kind:"savings" as const};const createTransfer=vi.fn();
    render(<App repository={{...testRepository,createTransfer,bootstrap:async()=>({...data,accounts:[...data.accounts,second]})}}/>);const add=await screen.findByRole("button",{name:"Add"});fireEvent.click(add);fireEvent.click(screen.getByRole("button",{name:"Transfer"}));
    fireEvent.change(screen.getByLabelText("Amount (USD)"),{target:{value:"9.99"}});fireEvent.change(screen.getByLabelText("To account"),{target:{value:"cash"}});fireEvent.click(screen.getByRole("button",{name:"Save"}));expect(await screen.findByRole("alert")).toHaveTextContent(/different accounts/i);expect(screen.getByLabelText("Amount (USD)")).toHaveValue("9.99");expect(createTransfer).not.toHaveBeenCalled();
    fireEvent.keyDown(screen.getByRole("dialog"),{key:"Escape"});expect(screen.queryByRole("dialog")).not.toBeInTheDocument();expect(add).toHaveFocus();
  });
  it("creates credit accounts as positive amounts owed from Net Worth",async()=>{
    const data=await testRepository.bootstrap();const createAccount=vi.fn();render(<App repository={{...testRepository,createAccount,bootstrap:async()=>data}}/>);fireEvent.click(await screen.findByRole("button",{name:/Net Worth/}));fireEvent.click(screen.getByRole("button",{name:"Add account"}));
    fireEvent.change(screen.getByLabelText("Account name"),{target:{value:"Rewards"}});fireEvent.change(screen.getByLabelText("Account type"),{target:{value:"credit"}});fireEvent.change(screen.getByLabelText("Amount owed (USD)"),{target:{value:"42.50"}});fireEvent.click(screen.getByRole("button",{name:"Save"}));
    await waitFor(()=>expect(createAccount).toHaveBeenCalledWith(expect.objectContaining({name:"Rewards",kind:"credit",openingBalanceCents:4250})));
  });
  it("groups transfer postings into one editable Activity row",async()=>{
    const data=await testRepository.bootstrap();const a=data.accounts[0],b={...a,id:"b",name:"Savings"};const base={postingId:1,entryId:"t",occurredOn:`${new Date().getFullYear()}-01-02`,kind:"transfer" as const,description:"Transfer",transferGroupId:"t",categoryId:null,categoryName:null,note:null,revision:1};
    render(<App repository={{...testRepository,bootstrap:async()=>({...data,accounts:[a,b],activity:[{...base,accountId:a.id,accountName:a.name,amountCents:-1000},{...base,postingId:2,accountId:b.id,accountName:b.name,amountCents:1000}]})}}/>);fireEvent.click(await screen.findByRole("button",{name:/Activity/}));
    expect(screen.getAllByRole("button",{name:"Edit Transfer"})).toHaveLength(1);fireEvent.click(screen.getByRole("button",{name:"Edit Transfer"}));expect(screen.getByRole("heading",{name:"Edit transfer"})).toBeInTheDocument();expect(screen.getByLabelText("From account")).toHaveValue(a.id);expect(screen.getByLabelText("To account")).toHaveValue(b.id);
  });
  it("exports exactly the filtered Activity postings and disables empty exports",async()=>{
    const data=await testRepository.bootstrap(), a=data.accounts[0], b={...a,id:"b",name:"Savings"};
    const activity=[
      {postingId:1,entryId:"meal",occurredOn:"2026-04-02",kind:"expense" as const,description:"Café lunch",note:"team",accountId:a.id,accountName:a.name,categoryId:"food",categoryName:"Food",amountCents:-1250,revision:1},
      {postingId:2,entryId:"transfer",occurredOn:"2026-04-01",kind:"transfer" as const,description:"Transfer",transferGroupId:"group",accountId:a.id,accountName:a.name,amountCents:-5000,revision:1},
      {postingId:3,entryId:"transfer",occurredOn:"2026-04-01",kind:"transfer" as const,description:"Transfer",transferGroupId:"group",accountId:b.id,accountName:b.name,amountCents:5000,revision:1},
      {postingId:4,entryId:"old",occurredOn:"2025-01-01",kind:"income" as const,description:"Old pay",accountId:a.id,accountName:a.name,categoryId:"pay",categoryName:"Pay",amountCents:10000,revision:1},
    ];
    const exportActivityCsv=vi.fn(),selectActivityExportDestination=vi.fn().mockResolvedValue("/tmp/activity.csv");
    render(<App repository={{...testRepository,bootstrap:async()=>({...data,accounts:[a,b],activity}),selectActivityExportDestination,exportActivityCsv}}/>);
    fireEvent.click(await screen.findByRole("button",{name:/Activity/}));
    fireEvent.change(screen.getByLabelText("Search activity"),{target:{value:"transfer"}});
    fireEvent.click(screen.getByRole("button",{name:"Export CSV"}));
    await waitFor(()=>expect(exportActivityCsv).toHaveBeenCalledWith("/tmp/activity.csv",[2,3]));
    fireEvent.change(screen.getByLabelText("Search activity"),{target:{value:"no matches"}});
    expect(screen.getByRole("button",{name:"Export CSV"})).toBeDisabled();
  });
  it("silently cancels backup and restore dialogs", async () => {
    const backupDatabase=vi.fn();const restoreDatabase=vi.fn();
    const repository={...testRepository,selectBackupDestination:vi.fn().mockResolvedValue(null),selectRestoreSource:vi.fn().mockResolvedValue(null),backupDatabase,restoreDatabase};
    render(<App repository={repository}/>);
    fireEvent.click(await screen.findByRole("button",{name:/Settings/}));
    fireEvent.click(screen.getByRole("button",{name:"Back up data"}));
    await waitFor(()=>expect(repository.selectBackupDestination).toHaveBeenCalledOnce());
    expect(backupDatabase).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button",{name:"Choose backup"}));
    fireEvent.click(screen.getByRole("button",{name:"Choose backup and restore"}));
    await waitFor(()=>expect(repository.selectRestoreSource).toHaveBeenCalledOnce());
    expect(restoreDatabase).not.toHaveBeenCalled();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
  it("protects backup from duplicate clicks and announces success and errors", async () => {
    let finish:()=>void=()=>{};const backupDatabase=vi.fn().mockReturnValueOnce(new Promise<void>(resolve=>{finish=resolve})).mockRejectedValueOnce({message:"Disk is full"});
    const repository={...testRepository,selectBackupDestination:vi.fn().mockResolvedValue("/tmp/a.lifelook"),backupDatabase};
    render(<App repository={repository}/>);fireEvent.click(await screen.findByRole("button",{name:/Settings/}));
    fireEvent.click(screen.getByRole("button",{name:"Back up data"}));
    expect(await screen.findByRole("button",{name:"Backing up…"})).toBeDisabled();
    fireEvent.click(screen.getByRole("button",{name:"Backing up…"}));expect(backupDatabase).toHaveBeenCalledTimes(1);
    finish();expect(await screen.findByRole("status")).toHaveTextContent("Backup created successfully");
    fireEvent.click(screen.getByRole("button",{name:"Back up data"}));
    const alert=await screen.findByRole("alert");expect(alert).toHaveTextContent("Disk is full");await waitFor(()=>expect(alert).toHaveFocus());
  });
  it("requires restore confirmation and refreshes the full workspace immediately", async () => {
    const original=await testRepository.bootstrap();
    const restored={...original,household:{id:"restored",name:"Restored household",state:"CA"},people:[{id:"r",householdId:"restored",name:"Restored Person"}],settings:{theme:"dark" as const,reducedMotion:true,revision:9}};
    const restoreDatabase=vi.fn().mockResolvedValue(restored);
    const repository={...testRepository,selectRestoreSource:vi.fn().mockResolvedValue("/tmp/a.lifelook"),restoreDatabase};
    render(<App repository={repository}/>);fireEvent.click(await screen.findByRole("button",{name:/Settings/}));
    fireEvent.click(screen.getByRole("button",{name:"Choose backup"}));
    expect(screen.getByRole("alertdialog")).toHaveTextContent(/cannot be undone/i);
    fireEvent.click(screen.getByRole("button",{name:"Cancel"}));expect(restoreDatabase).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button",{name:"Choose backup"}));fireEvent.click(screen.getByRole("button",{name:"Choose backup and restore"}));
    expect(await screen.findByText("Restored household")).toBeInTheDocument();
    await waitFor(()=>expect(document.querySelector(".app")).toHaveClass("dark"));expect(restoreDatabase).toHaveBeenCalledOnce();
  });
  it("keeps the workspace and focuses an invalid-restore error", async () => {
    const repository={...testRepository,selectRestoreSource:vi.fn().mockResolvedValue("/tmp/bad.lifelook"),restoreDatabase:vi.fn().mockRejectedValue({code:"invalid_backup"})};
    render(<App repository={repository}/>);fireEvent.click(await screen.findByRole("button",{name:/Settings/}));
    fireEvent.click(screen.getByRole("button",{name:"Choose backup"}));fireEvent.click(screen.getByRole("button",{name:"Choose backup and restore"}));
    const alert=await screen.findByRole("alert");expect(alert).toHaveTextContent(/not a compatible LifeLook backup/i);await waitFor(()=>expect(alert).toHaveFocus());
    expect(screen.getByText("Test household")).toBeInTheDocument();
  });
  it("shows onboarding for a new workspace", async () => {
    const repository = {
      bootstrap: async () => ({
        onboardingStep: 0,
        onboardingComplete: false,
        people: [],
        accounts: [],
        categories: [],
      }),
      retryStartup: async () => { throw new Error("not used"); },
      saveOnboardingStep: async () => {},
      completeOnboarding: async () => {},
    };
    render(<App repository={repository} />);
    expect(
      await screen.findByRole("heading", {
        name: "Tell us about your household",
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/does not create an online account/i),
    ).toBeInTheDocument();
  });
  it("saves multiple people and typed accounts against the stable household id", async () => {
    const payloads: unknown[] = [];
    const repository = {
      bootstrap: async () => ({
        onboardingStep: 0,
        onboardingComplete: false,
        people: [],
        accounts: [],
        categories: [],
      }),
      retryStartup: async () => { throw new Error("not used"); },
      saveOnboardingStep: async (_step: number, payload: unknown) => {
        payloads.push(payload);
      },
      completeOnboarding: async () => {},
    };
    render(<App repository={repository} />);
    fireEvent.change(await screen.findByLabelText("Household name"), {
      target: { value: "Carrigg" },
    });
    fireEvent.change(screen.getByLabelText("Person 1 name"), {
      target: { value: "Test Person" },
    });
    fireEvent.change(screen.getByLabelText("Person 1 birth date"), {
      target: { value: "01/08/2026" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Add another person/ }));
    fireEvent.change(screen.getByLabelText("Person 2 name"), {
      target: { value: "Second Person" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save & Continue" }));
    await screen.findByRole("heading", {
      name: "Add the accounts you want to track",
    });
    fireEvent.change(screen.getByLabelText("Filing status"),{target:{value:"single"}});
    fireEvent.click(screen.getByRole("radio", { name: /Savings/ }));
    fireEvent.change(screen.getByLabelText("Account 1 name"), {
      target: { value: "Rainy day" },
    });
    fireEvent.change(screen.getByLabelText("Account 1 opening balance"), {
      target: { value: "123.45" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: /Add another account/ }),
    );
    fireEvent.click(screen.getAllByRole("radio", { name: /Credit card/ })[1]);
    fireEvent.change(screen.getByLabelText("Account 2 name"), {
      target: { value: "Rewards card" },
    });
    fireEvent.change(screen.getByLabelText("Account 2 opening balance"), {
      target: { value: "-25.50" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Finish setup" }));
    await waitFor(() => expect(payloads).toHaveLength(2));
    const first = payloads[0] as {
      household: { id: string };
      people: { birthDate: string | null }[];
    };
    const second = payloads[1] as {
      accounts: {
        householdId: string;
        kind: string;
        openingBalanceCents: number;
      }[];
    };
    expect(first.people).toHaveLength(2);
    expect(first.people[0].birthDate).toBe("2026-01-08");
    expect(second.accounts.map((a) => a.kind)).toEqual(["savings", "credit"]);
    expect(second.accounts[1].openingBalanceCents).toBe(-2550);
    expect(
      second.accounts.every((a) => a.householdId === first.household.id),
    ).toBe(true);
  });

  it("rejects an invalid birth date typed as text", async () => {
    const repository = {
      bootstrap: async () => ({
        onboardingStep: 0,
        onboardingComplete: false,
        people: [],
        accounts: [],
        categories: [],
      }),
      retryStartup: async () => { throw new Error("not used"); },
      saveOnboardingStep: async () => {},
      completeOnboarding: async () => {},
    };
    render(<App repository={repository} />);
    fireEvent.change(await screen.findByLabelText("Household name"), {
      target: { value: "Carrigg" },
    });
    fireEvent.change(screen.getByLabelText("Person 1 name"), {
      target: { value: "Aidan" },
    });
    fireEvent.change(screen.getByLabelText("Person 1 birth date"), {
      target: { value: "02/30/2026" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save & Continue" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Person 1: enter a valid birth date as MM/DD/YYYY.",
    );
  });

  it("restores onboarding data and lets the user go back without losing it", async () => {
    const repository = {
      bootstrap: async () => ({
        onboardingStep: 6,
        onboardingComplete: false,
        household: { id: "h", name: "Saved home", state: "CA" },
        people: [
          { id: "p", householdId: "h", name: "Saved Person", birthDate: null },
        ],
        accounts: [
          {
            id: "a",
            householdId: "h",
            name: "Saved IRA",
            kind: "retirement" as const,
            openingBalanceCents: 4200,
            annualReturnBps: 0,
            liquid: false,
            revision: 1,
          },
        ],
        categories: [],
      }),
      retryStartup: async () => { throw new Error("not used"); },
      saveOnboardingStep: async () => {},
      completeOnboarding: async () => {},
    };
    render(<App repository={repository} />);
    expect(await screen.findByDisplayValue("Saved IRA")).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: /Retirement/ })).toBeChecked();
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(screen.getByDisplayValue("Saved Person")).toBeInTheDocument();
  });

  it("deletes an imported transaction individually through an alert dialog", async () => {
    const data=await testRepository.bootstrap();
    const imported={postingId:1,entryId:"import-1",occurredOn:"2026-08-01",kind:"expense" as const,origin:"import" as const,canDelete:true,description:"Imported lunch",accountId:"cash",accountName:"Test checking",categoryId:"food",categoryName:"Food",amountCents:-1250,revision:3};
    const deleteTransaction=vi.fn();
    render(<App repository={{...testRepository,deleteTransaction,bootstrap:async()=>({...data,categories:[{id:"food",householdId:"test",name:"Food",kind:"expense" as const,revision:1}],activity:[imported]})}}/>);
    fireEvent.click(await screen.findByRole("button",{name:/Activity/}));
    fireEvent.click(screen.getByRole("button",{name:"Edit Imported lunch"}));
    expect(screen.getByText(/delete this transaction individually/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button",{name:"Delete"}));
    const confirmation=screen.getByRole("alertdialog");
    await waitFor(()=>expect(screen.getByRole("heading",{name:"Delete transaction?"})).toHaveFocus());
    fireEvent.click(screen.getByRole("button",{name:"Delete permanently"}));
    await waitFor(()=>expect(deleteTransaction).toHaveBeenCalledWith({id:"import-1",expectedRevision:3}));
    await waitFor(()=>expect(confirmation).not.toBeInTheDocument());
  });

  it("keeps a blocked account dialog open and focuses its blockers", async () => {
    const data=await testRepository.bootstrap();
    const accountDeletionImpact=vi.fn().mockResolvedValue({accountId:"cash",canDelete:false,blockers:["The account has transactions."]});
    render(<App repository={{...testRepository,accountDeletionImpact,bootstrap:async()=>data}}/>);
    fireEvent.click(await screen.findByRole("button",{name:/Net Worth/}));
    fireEvent.click(screen.getByRole("button",{name:"Edit"}));
    fireEvent.click(screen.getByRole("button",{name:"Delete"}));
    const alert=await screen.findByRole("alert");
    expect(alert).toHaveTextContent("The account has transactions.");
    await waitFor(()=>expect(alert).toHaveFocus());
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("retains CSV preview choices after commit failure and restores focus on close", async () => {
    const data=await testRepository.bootstrap();
    const category={id:"food",householdId:"test",name:"Food",kind:"expense" as const,revision:1};
    const preview={path:"/tmp/activity.csv",fileHash:"hash",mapping:{accountId:"cash",dateColumn:"Date",descriptionColumn:"Description",noteColumn:null,amountLayout:"signed" as const,amountColumn:"Amount",debitColumn:null,creditColumn:null,inflowPositive:true,dateFormat:"iso" as const},rows:[{rowNumber:2,occurredOn:"2026-08-01",description:"Lunch",amountCents:-1200,kind:"expense" as const,categoryId:"food",categoryName:"Food",valid:true,error:null,duplicate:"existing" as const,include:false}]};
    const commitCsv=vi.fn().mockRejectedValue({message:"Database is busy"});
    render(<App repository={{...testRepository,bootstrap:async()=>({...data,categories:[category]}),selectCsvSource:vi.fn().mockResolvedValue("/tmp/activity.csv"),inspectCsv:vi.fn().mockResolvedValue({path:"/tmp/activity.csv",fileHash:"hash",headers:["Date","Description","Amount"],rowCount:1}),previewCsv:vi.fn().mockResolvedValue(preview),commitCsv}}/>);
    fireEvent.click(await screen.findByRole("button",{name:/Activity/}));
    const importButton=screen.getByRole("button",{name:"Import CSV"});
    fireEvent.click(importButton);fireEvent.click(screen.getByRole("button",{name:"Choose CSV…"}));
    fireEvent.click(await screen.findByRole("button",{name:"Preview"}));
    const include=await screen.findByRole("checkbox",{name:"Include row 2"});
    expect(include).not.toBeChecked();
    fireEvent.click(include);
    fireEvent.click(screen.getByRole("button",{name:"Import selected"}));
    const alert=await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Database is busy");
    expect(include).toBeChecked();
    await waitFor(()=>expect(alert).toHaveFocus());
    fireEvent.keyDown(screen.getByRole("dialog"),{key:"Escape"});
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(importButton).toHaveFocus();
  });
  it("creates an exact asset from the shared Add menu",async()=>{
    const createAsset=vi.fn();
    render(<App repository={{...testRepository,createAsset}}/>);
    fireEvent.click(await screen.findByRole("button",{name:"Add"}));
    fireEvent.click(screen.getByRole("button",{name:"Asset"}));
    fireEvent.change(screen.getByLabelText("Asset name"),{target:{value:"Home"}});
    fireEvent.change(screen.getByLabelText("Current value (USD)"),{target:{value:"500000.25"}});
    fireEvent.change(screen.getByLabelText("Annual growth (%)"),{target:{value:"3.50"}});
    fireEvent.click(screen.getByRole("button",{name:"Save"}));
    await waitFor(()=>expect(createAsset).toHaveBeenCalledWith(expect.objectContaining({name:"Home",valueCents:50000025,annualGrowthBps:350})));
  });
  it("calculates mortgage P&I and supports a custom payment override",async()=>{
    const createLiability=vi.fn();
    render(<App repository={{...testRepository,createLiability}}/>);
    fireEvent.click(await screen.findByRole("button",{name:"Add"}));
    fireEvent.click(screen.getByRole("button",{name:"Debt"}));
    fireEvent.change(screen.getByLabelText("Debt name"),{target:{value:"Mortgage"}});
    fireEvent.change(screen.getByLabelText("Current balance (USD)"),{target:{value:"350000"}});
    fireEvent.change(screen.getByLabelText("Annual interest rate (%)"),{target:{value:"6.5"}});
    fireEvent.click(screen.getByLabelText("Include mortgage details"));
    fireEvent.change(screen.getByLabelText("Original principal (USD)"),{target:{value:"400000"}});
    fireEvent.change(screen.getByLabelText("Mortgage start date"),{target:{value:"2020-01-15"}});
    expect(screen.getByRole("status")).toHaveTextContent(/\$2,528\.27/);
    fireEvent.click(screen.getByLabelText("Use custom monthly payment"));
    fireEvent.change(screen.getByLabelText("Custom monthly payment (USD)"),{target:{value:"3000"}});
    fireEvent.click(screen.getByRole("button",{name:"Save"}));
    await waitFor(()=>expect(createLiability).toHaveBeenCalledWith(expect.objectContaining({balanceCents:35000000,annualRateBps:650,minimumPaymentCents:300000,mortgage:expect.objectContaining({originalPrincipalCents:40000000,termMonths:360,paymentOverrideCents:300000})})));
  });
  it("confirms asset deletion and restores focus to its Edit button",async()=>{
    const data=await testRepository.bootstrap();
    const asset={id:"home",householdId:"test",name:"Home",valueCents:50000000,annualGrowthBps:300,revision:2};
    const deleteAsset=vi.fn();
    render(<App repository={{...testRepository,deleteAsset,bootstrap:async()=>({...data,assets:[asset]})}}/>);
    fireEvent.click(await screen.findByRole("button",{name:/Net Worth/}));
    const row=screen.getByText("Home").closest<HTMLElement>(".account")!;
    const edit=within(row).getByRole("button",{name:"Edit"});
    fireEvent.click(edit);fireEvent.click(screen.getByRole("button",{name:"Delete"}));
    await waitFor(()=>expect(screen.getByRole("heading",{name:"Delete asset?"})).toHaveFocus());
    fireEvent.click(screen.getByRole("button",{name:"Delete permanently"}));
    await waitFor(()=>expect(deleteAsset).toHaveBeenCalledWith({id:"home",expectedRevision:2}));
    await waitFor(()=>expect(edit).toHaveFocus());
  });
});
