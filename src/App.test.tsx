import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
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
  });
  it("toggles theme", async () => {
    render(<App repository={testRepository} />);
    fireEvent.click(
      await screen.findByRole("button", { name: "Toggle theme" }),
    );
    expect(document.querySelector(".app")).toHaveClass("dark");
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
