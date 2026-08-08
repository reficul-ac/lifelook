import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { App } from "./App";
describe("LifeLook shell",()=>{ it("navigates with accessible buttons",()=>{ render(<App/>); expect(screen.getByRole("heading",{name:"Overview"})).toBeInTheDocument(); fireEvent.click(screen.getByRole("button",{name:/Plan/})); expect(screen.getByRole("heading",{name:"Plan"})).toBeInTheDocument(); }); it("toggles theme",()=>{ render(<App/>); fireEvent.click(screen.getByRole("button",{name:"Toggle theme"})); expect(document.querySelector(".app")).toHaveClass("dark"); }); });
