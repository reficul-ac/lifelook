import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { App } from "./App";
import { testRepository } from "./repository";
describe("LifeLook shell", () => {
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
  it("marks unavailable controls as disabled", async () => {
    render(<App repository={testRepository}/>);
    await screen.findByRole("heading",{name:"Overview"});
    expect(screen.getByRole("button",{name:/Search \(not yet available\)/})).toBeDisabled();
    expect(screen.getByRole("button",{name:/Add \(unavailable\)/})).toBeDisabled();
    expect(screen.getByRole("button",{name:/Test Person/})).toBeDisabled();
    fireEvent.click(screen.getByRole("button",{name:/Net Worth/}));
    expect(screen.getByRole("button",{name:/Add account \(unavailable\)/})).toBeDisabled();
    fireEvent.click(screen.getByRole("button",{name:/Settings/}));
    expect(screen.getByRole("button",{name:"Back up data"})).toBeEnabled();
    expect(screen.getByRole("button",{name:"Choose backup"})).toBeEnabled();
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
});
