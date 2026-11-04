import { describe, expect, it, vi } from "vitest";
import { lerPreferencias } from "./preferencias";
import { resolverPaginaInicial } from "./inicio";

describe("resolverPaginaInicial (o que abre dentro da área)", () => {
  it.each([
    [undefined, "semana"],
    ["semana", "semana"],
    ["kanban", "kanban"],
    ["vendas", "kanban"],
    ["projetos", "kanban"],
  ] as const)("preferência %s → %s", async (inicio, esperado) => {
    expect(await resolverPaginaInicial(async () => lerPreferencias({ v: 1, kanban: {}, inicio }))).toBe(esperado);
  });

  it("banco fora: não derruba o layout — loga com ref e cai na Minha Semana", async () => {
    const erro = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await resolverPaginaInicial(async () => { throw new Error("banco fora"); })).toBe("semana");
    expect(erro.mock.calls.some((c) => String(c[0]).includes("layout.inicio") && String(c[0]).includes("ref="))).toBe(true);
    erro.mockRestore();
  });
});
