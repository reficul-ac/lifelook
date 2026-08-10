import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { App } from "./App";
import { buildSearchIndex, searchIndex } from "./GlobalSearch";
import { testRepository, type Bootstrap } from "./repository";

async function records() {
  const data = await testRepository.bootstrap(),
    a = data.accounts[0];
  return {
    ...data,
    taxProfile: {
      filingStatus: "single" as const,
      state: "CA" as const,
      taxYear: 2026 as const,
      thresholdInflationBps: 250,
      revision: 1,
    },
    categories: [
      {
        id: "food",
        householdId: "test",
        name: "Food",
        kind: "expense" as const,
        revision: 1,
      },
    ],
    activity: [
      {
        postingId: 1,
        entryId: "transfer",
        occurredOn: "2026-08-01",
        kind: "transfer" as const,
        description: "Transfer",
        note: "rainy fund",
        accountId: "cash",
        accountName: "Checking",
        amountCents: -500,
        revision: 1,
      },
      {
        postingId: 2,
        entryId: "transfer",
        occurredOn: "2026-08-01",
        kind: "transfer" as const,
        description: "Transfer",
        note: null,
        accountId: "save",
        accountName: "Savings",
        amountCents: 500,
        revision: 1,
      },
      {
        postingId: 3,
        entryId: "meal",
        occurredOn: "2025-01-02",
        kind: "expense" as const,
        description: "Cafe lunch",
        note: "Client",
        accountId: a.id,
        accountName: a.name,
        categoryId: "food",
        categoryName: "Food",
        amountCents: -1200,
        revision: 1,
      },
    ],
    accounts: [a, { ...a, id: "save", name: "Savings" }],
    assets: [
      {
        id: "home",
        householdId: "test",
        name: "Lake House",
        valueCents: 1,
        annualGrowthBps: 0,
        revision: 1,
      },
    ],
    liabilities: [],
    recurring: [],
    scenarios: [
      {
        id: "lean",
        householdId: "test",
        name: "Lean future",
        isBaseline: false,
        assumptions: { inflationBps: 250, thresholdInflationBps: 250 },
        horizonMonths: 24,
        revision: 1,
        events: [],
        allocations: [],
      },
    ],
  };
}

describe("global search", () => {
  it("deduplicates transfers, ranks labels, and matches metadata", async () => {
    const index = buildSearchIndex((await records()) as unknown as Bootstrap);
    expect(index.filter((x) => x.id === "transfer")).toHaveLength(1);
    expect(
      searchIndex(index, "Savings")
        .map((x) => x.label)
        .slice(0, 2),
    ).toEqual(["Savings", "Transfer"]);
    expect(searchIndex(index, "client")[0].label).toBe("Cafe lunch");
    expect(searchIndex(index, "missing")).toEqual([]);
  });
  it("opens from Ctrl+K, navigates, focuses records, selects scenarios, and restores focus", async () => {
    render(<App repository={{ ...testRepository, bootstrap: records }} />);
    const opener = await screen.findByRole("button", {
      name: "Search workspace",
    });
    opener.focus();
    fireEvent.keyDown(window, { key: "k", ctrlKey: true });
    let input = screen.getByRole("textbox", { name: "Search workspace" });
    expect(input).toHaveFocus();
    fireEvent.change(input, { target: { value: "house" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(
      await screen.findByRole("heading", { name: "Net Worth" }),
    ).toBeInTheDocument();
    await waitFor(() =>
      expect(
        screen
          .getByText("Lake House")
          .closest(".account")
          ?.querySelector("button"),
      ).toHaveFocus(),
    );
    fireEvent.keyDown(window, { key: "k", ctrlKey: true });
    input = screen.getByRole("textbox", { name: "Search workspace" });
    fireEvent.change(input, { target: { value: "future" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(
      await screen.findByRole("heading", { name: "Plan" }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Active scenario")).toHaveValue("lean");
    await waitFor(() =>
      expect(screen.getByLabelText("Active scenario")).toHaveFocus(),
    );
    fireEvent.keyDown(window, { key: "k", ctrlKey: true });
    fireEvent.keyDown(
      screen.getByRole("textbox", { name: "Search workspace" }),
      {
        key: "Escape",
      },
    );
    expect(
      screen.queryByRole("dialog", { name: "Search workspace" }),
    ).not.toBeInTheDocument();
    expect(screen.getByLabelText("Active scenario")).toHaveFocus();
  });
  it("clears conflicting Activity filters and exposes empty results", async () => {
    render(<App repository={{ ...testRepository, bootstrap: records }} />);
    fireEvent.click(await screen.findByRole("button", { name: /Activity/ }));
    fireEvent.change(screen.getByLabelText("Search activity"), {
      target: { value: "nothing" },
    });
    fireEvent.keyDown(window, { key: "k", ctrlKey: true });
    let input = screen.getByRole("textbox", { name: "Search workspace" });
    fireEvent.change(input, { target: { value: "transfer" } });
    fireEvent.keyDown(input, { key: "ArrowDown" });
    fireEvent.keyDown(input, { key: "ArrowUp" });
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Edit Transfer" }),
      ).toHaveFocus(),
    );
    expect(screen.getByLabelText("Search activity")).toHaveValue("");
    fireEvent.keyDown(window, { key: "k", ctrlKey: true });
    input = screen.getByRole("textbox", { name: "Search workspace" });
    fireEvent.change(input, { target: { value: "zzzz" } });
    expect(screen.getByText("No results found.")).toBeInTheDocument();
  });
});
