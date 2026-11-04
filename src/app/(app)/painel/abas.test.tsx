import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { AbasPainel } from "./abas";

describe("abas do Painel (GAB-96)", () => {
  it("levam o período na troca", () => {
    render(<AbasPainel atual="vendas" periodo={{ periodo: "semana", ref: "2026-10-05" }} />);
    expect(screen.getByRole("link", { name: "Projetos" })).toHaveAttribute("href", "/painel/projetos?periodo=semana&ref=2026-10-05");
    expect(screen.getByRole("link", { name: "Vendas" })).toHaveAttribute("aria-current", "page");
  });

  it("sem parâmetros, o link fica limpo", () => {
    render(<AbasPainel atual="projetos" periodo={{}} />);
    expect(screen.getByRole("link", { name: "Vendas" })).toHaveAttribute("href", "/painel");
  });
});
