import { describe, expect, it } from "vitest";
import { diffEstruturado, diffMarkdown, diffParaTexto, temMudanca } from "./diff";
import type { Estruturado } from "./estruturado";

describe("diffMarkdown: por bloco (linha), com as palavras trocadas dentro do bloco", () => {
  it("igual não tem mudança; linhas em branco do Markdown canônico não contam", () => {
    const md = "## Contexto\n\nTexto um.\n\n## Escopo";
    const d = diffMarkdown(md, md);
    expect(temMudanca(d)).toBe(false);
    expect(d.map((l) => l.tipo)).toEqual(["igual", "igual", "igual"]);
  });

  it("linha nova e linha removida", () => {
    const d = diffMarkdown("A\n\nB\n\nC", "A\n\nC\n\nD");
    expect(d).toEqual([
      { tipo: "igual", texto: "A" },
      { tipo: "removida", texto: "B" },
      { tipo: "igual", texto: "C" },
      { tipo: "adicionada", texto: "D" },
    ]);
  });

  it("bloco alterado: mostra só as palavras que mudaram", () => {
    const d = diffMarkdown("## Escopo\n\nSite com 5 páginas e blog.", "## Escopo\n\nSite com 8 páginas e blog.");
    expect(d[0]).toEqual({ tipo: "igual", texto: "## Escopo" });
    expect(d[1].tipo).toBe("alterada");
    if (d[1].tipo !== "alterada") throw new Error();
    expect(d[1].antes.filter((t) => t.tipo !== "igual")).toEqual([{ tipo: "removido", texto: "5" }]);
    expect(d[1].depois.filter((t) => t.tipo !== "igual")).toEqual([{ tipo: "adicionado", texto: "8" }]);
    expect(d[1].antes.map((t) => t.texto).join("")).toBe("Site com 5 páginas e blog.");
    expect(d[1].depois.map((t) => t.texto).join("")).toBe("Site com 8 páginas e blog.");
  });

  it("de vazio (primeira versão): tudo adicionado", () => {
    expect(diffMarkdown("", "A\n\nB")).toEqual([
      { tipo: "adicionada", texto: "A" },
      { tipo: "adicionada", texto: "B" },
    ]);
  });

  it("texto grande e todo diferente não explode (limite de custo: vira troca de bloco)", () => {
    const a = Array.from({ length: 3000 }, (_, i) => `linha a${i}`).join("\n\n");
    const b = Array.from({ length: 3000 }, (_, i) => `linha b${i}`).join("\n\n");
    const d = diffMarkdown(a, b);
    expect(d).toHaveLength(3000);
    expect(d.every((l) => l.tipo === "alterada")).toBe(true);
  });

  it("texto para o MCP: - removido, + adicionado, espaço = igual", () => {
    expect(diffParaTexto(diffMarkdown("A\n\nB velho", "A\n\nB novo\n\nC"))).toBe("  A\n- B velho\n+ B novo\n+ C");
  });
});

describe("diffEstruturado: campo a campo, no formato da tela", () => {
  const base: Estruturado = { valor: "20000.00", prazoDias: 60, escopoResumo: "Site", entregas: [{ titulo: "MVP", dia: "2026-12-15", valor: "8000.00" }] };
  it("só os campos que mudaram", () => {
    expect(diffEstruturado(base, base)).toEqual([]);
    expect(diffEstruturado(base, { ...base, valor: "25000.00", entregas: [...base.entregas, { titulo: "Final", dia: "2027-01-30", valor: null }] })).toEqual([
      { campo: "Valor", antes: "R$ 20.000,00", depois: "R$ 25.000,00" },
      { campo: "Cronograma de entregas", antes: "MVP · 15/12/2026 · R$ 8.000,00", depois: "MVP · 15/12/2026 · R$ 8.000,00\nFinal · 30/01/2027" },
    ]);
    expect(diffEstruturado(base, { ...base, prazoDias: null, escopoResumo: null })).toEqual([
      { campo: "Prazo", antes: "60 dias", depois: "—" },
      { campo: "Escopo resumido", antes: "Site", depois: "—" },
    ]);
  });
});
