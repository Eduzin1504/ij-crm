import { describe, expect, it } from "vitest";
import { diffEstruturado, diffMarkdown, diffParaTexto, temMudanca, type LinhaDiff } from "./diff";
import { documentoComBlocos } from "./documento";
import type { Estruturado } from "./estruturado";
import { markdownParaDocumento } from "./markdown";

/** Só o texto: os blocos, sem marcador, ficam iguais no fim (têm testes próprios abaixo). */
const doTexto = <T extends LinhaDiff>(d: T[]) => d.filter((l) => !(l.tipo === "igual" && l.texto.startsWith("[Bloco")));

describe("diffMarkdown: por bloco (linha), com as palavras trocadas dentro do bloco", () => {
  it("igual não tem mudança; linhas em branco do Markdown canônico não contam", () => {
    const md = "## Contexto\n\nTexto um.\n\n## Escopo";
    const d = diffMarkdown(md, md);
    expect(temMudanca(d)).toBe(false);
    expect(doTexto(d).map((l) => l.tipo)).toEqual(["igual", "igual", "igual"]);
  });

  it("linha nova e linha removida", () => {
    const d = diffMarkdown("A\n\nB\n\nC", "A\n\nC\n\nD");
    expect(doTexto(d)).toEqual([
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

  it("sem versão anterior: tudo adicionado, inclusive os blocos", () => {
    expect(diffMarkdown(null, "A\n\nB")).toEqual([
      { tipo: "adicionada", texto: "A" },
      { tipo: "adicionada", texto: "B" },
      { tipo: "adicionada", texto: "[Bloco Cronograma]" },
      { tipo: "adicionada", texto: "[Bloco Investimento]" },
    ]);
  });

  it("texto grande e todo diferente não explode (limite de custo: vira troca de bloco)", () => {
    const a = Array.from({ length: 3000 }, (_, i) => `linha a${i}`).join("\n\n");
    const b = Array.from({ length: 3000 }, (_, i) => `linha b${i}`).join("\n\n");
    const d = doTexto(diffMarkdown(a, b));
    expect(d).toHaveLength(3000);
    expect(d.every((l) => l.tipo === "alterada")).toBe(true);
  });

  it("texto para o MCP: - removido, + adicionado, espaço = igual", () => {
    expect(diffParaTexto(diffMarkdown("A\n\nB velho", "A\n\nB novo\n\nC"))).toBe("  A\n- B velho\n+ B novo\n+ C\n  [Bloco Cronograma]\n  [Bloco Investimento]");
  });
});

describe("diffEstruturado: campo a campo, no formato da tela", () => {
  const base: Estruturado = { valor: "20000.00", prazoDias: 60, escopoResumo: "Site", entregas: [{ titulo: "MVP", dia: "2026-12-15", duracao: null, valor: "8000.00" }] };
  it("só os campos que mudaram", () => {
    expect(diffEstruturado(base, base)).toEqual([]);
    expect(diffEstruturado(base, { ...base, valor: "25000.00", entregas: [...base.entregas, { titulo: "Final", dia: "2027-01-30", duracao: null, valor: null }] })).toEqual([
      { campo: "Valor", antes: "R$ 20.000,00", depois: "R$ 25.000,00" },
      { campo: "Cronograma de entregas", antes: "MVP · 15/12/2026 · R$ 8.000,00", depois: "MVP · 15/12/2026 · R$ 8.000,00\nFinal · 30/01/2027" },
    ]);
    expect(diffEstruturado(base, { ...base, prazoDias: null, escopoResumo: null })).toEqual([
      { campo: "Prazo", antes: "60 dias", depois: "—" },
      { campo: "Escopo resumido", antes: "Site", depois: "—" },
    ]);
  });
});

describe("blocos móveis no diff (GAB-100)", () => {
  const C = "[Bloco Cronograma]";
  const I = "[Bloco Investimento]";
  const alteracoes = (a: string, b: string) => diffMarkdown(a, b).filter((l) => l.tipo !== "igual");

  it("compara a forma de exibição: sem marcador, os dois estão no fim", () => {
    expect(temMudanca(diffMarkdown("Um.", "Um."))).toBe(false);
    expect(diffMarkdown("Um.", "Um.")).toEqual([{ tipo: "igual", texto: "Um." }, { tipo: "igual", texto: C }, { tipo: "igual", texto: I }]);
  });

  it("mover o bloco aparece em palavras, como saiu de um lugar e entrou em outro", () => {
    const a = alteracoes("Um.\n\nDois.", "Um.\n\n<!-- bloco:cronograma -->\n\nDois.\n\n<!-- bloco:investimento -->");
    // Quem se moveu é o bloco, e não o texto que ele cruzou.
    expect(a).toEqual([{ tipo: "adicionada", texto: C }, { tipo: "removida", texto: C }]);
  });

  it("tirar os dois da folha diz que saíram; tirar um diz qual", () => {
    expect(alteracoes("Um.", "Um.\n\n<!-- bloco:nenhum -->")).toEqual([{ tipo: "removida", texto: C }, { tipo: "removida", texto: I }]);
    expect(alteracoes("Um.", "Um.\n\n<!-- bloco:investimento -->")).toEqual([{ tipo: "removida", texto: C }]);
    expect(diffParaTexto(diffMarkdown("Um.", "Um.\n\n<!-- bloco:nenhum -->"))).toContain("- [Bloco Cronograma]");
    expect(diffParaTexto(diffMarkdown("Um.", "Um.\n\n<!-- bloco:nenhum -->"))).not.toContain("<!--");
  });

  it("bloco nunca é pareado com texto alterado", () => {
    expect(alteracoes("Um.\n\n<!-- bloco:cronograma -->", "Outro.\n\n<!-- bloco:investimento -->").map((l) => l.tipo)).toEqual(["alterada", "removida", "adicionada"]);
  });

  it("a regra por linha é a mesma de documentoComBlocos", () => {
    for (const md of ["Um.", "Um.\n\n<!-- bloco:nenhum -->", "<!-- bloco:investimento -->\n\nUm."]) {
      const exib = documentoComBlocos(markdownParaDocumento(md)).content.flatMap((b) => (b.type === "blocoDados" ? [b.attrs.tipo === "cronograma" ? C : I] : ["Um."]));
      expect(diffMarkdown(md, md).map((l) => (l.tipo === "igual" ? l.texto : ""))).toEqual(exib);
    }
  });

  it("entrega com duração no diff da parte estruturada; antiga sem mudança não vira diferença", () => {
    const base = { valor: null, prazoDias: null, escopoResumo: null };
    const data = { ...base, entregas: [{ titulo: "A", dia: "2026-12-01", duracao: null, valor: null }] };
    const dur = { ...base, entregas: [{ titulo: "A", dia: null, duracao: "2 semanas", valor: null }] };
    expect(diffEstruturado(data, data)).toEqual([]);
    expect(diffEstruturado(data, dur)).toEqual([{ campo: "Cronograma de entregas", antes: "A · 01/12/2026", depois: "A · 2 semanas" }]);
  });
});
