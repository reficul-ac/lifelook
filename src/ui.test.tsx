import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { AnchoredMenu, DetailDisclosure, readUiPreferences, uiPreferenceStorageKey } from "./ui";

describe("shared UI primitives", () => {
  it("supports menu keyboard traversal, selection, and focus restoration", async () => {
    const select = vi.fn();
    render(<AnchoredMenu label="Actions" items={[{ label: "First", group: "Create", onSelect: select }, { label: "Second", group: "Create", onSelect: select }]}/>);
    const trigger = screen.getByRole("button", { name: "Actions" });
    trigger.focus();
    fireEvent.keyDown(trigger, { key: "ArrowDown" });
    await waitFor(() => expect(screen.getByRole("menuitem", { name: "First" })).toHaveFocus());
    fireEvent.keyDown(screen.getByRole("menu"), { key: "End" });
    expect(screen.getByRole("menuitem", { name: "Second" })).toHaveFocus();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    await waitFor(() => expect(trigger).toHaveFocus());
  });

  it("stores one versioned disclosure map per household", () => {
    const { rerender } = render(<DetailDisclosure label="View data" householdId="household-a" preferenceKey="projection"><p>Exact values</p></DetailDisclosure>);
    const details = screen.getByText("View data").closest("details")!;
    Object.defineProperty(details, "open", { value: true, writable: true });
    fireEvent(details, new Event("toggle"));
    expect(JSON.parse(localStorage.getItem(uiPreferenceStorageKey("household-a"))!)).toEqual({ version: 1, expanded: { projection: true } });
    rerender(<DetailDisclosure label="View data" householdId="household-b" preferenceKey="projection"><p>Exact values</p></DetailDisclosure>);
    expect(screen.getByText("View data").closest("details")).not.toHaveAttribute("open");
  });

  it("recovers from malformed and unsupported preferences", () => {
    localStorage.setItem(uiPreferenceStorageKey("broken"), "not json");
    expect(readUiPreferences("broken")).toEqual({ version: 1, expanded: {} });
    localStorage.setItem(uiPreferenceStorageKey("old"), JSON.stringify({ version: 2, expanded: { data: true } }));
    expect(readUiPreferences("old")).toEqual({ version: 1, expanded: {} });
  });
});
