import { describe, expect, it } from "vitest";
import { documentoPdfDaProposta, formatarReais, nomeArquivoPdf } from "./pdf";

const base = {
  projeto: "Site da Padaria",
  empresa: "Padaria São João",
  numero: 3,
  data: new Date("2026-11-03T15:00:00Z"),
  markdown: "## Escopo\n\nSite com **5 páginas** e *blog*.\n\n- Home\n- Contato\n  - formulário\n\n1. Fase um\n2. Fase dois\n\n---\n\nFim.",
  estruturado: {
    valor: "12500.00",
    prazoDias: 60,
    escopoResumo: "Site institucional",
    entregas: [
      { titulo: "Protótipo", dia: "2026-12-01", valor: "5000.00" },
      { titulo: "Site no ar", dia: "2027-01-15", valor: null },
    ],
  },
};

describe("documentoPdfDaProposta", () => {
  it("versão final (texto) + parte estruturada; # e ## viram seção", () => {
    const d = documentoPdfDaProposta(base);
    expect(d.titulo).toBe("Proposta comercial");
    expect(d.subtitulo).toEqual(["Padaria São João · Site da Padaria", "Versão 3 · 03/11/2026"]);
    expect(d.blocos[0]).toEqual({
      tipo: "campos",
      linhas: [
        { rotulo: "Investimento", valor: "R$ 12.500,00" },
        { rotulo: "Prazo", valor: "60 dias corridos" },
        { rotulo: "Escopo", valor: "Site institucional" },
      ],
    });
    expect(d.blocos).toContainEqual({ tipo: "titulo", nivel: 2, trechos: [{ texto: "Escopo" }] });
    expect(d.blocos).toContainEqual({
      tipo: "paragrafo",
      trechos: [{ texto: "Site com " }, { texto: "5 páginas", negrito: true }, { texto: " e " }, { texto: "blog", italico: true }, { texto: "." }],
    });
    expect(d.blocos).toContainEqual({ tipo: "item", marcador: "•", nivel: 0, trechos: [{ texto: "Home" }] });
    expect(d.blocos).toContainEqual({ tipo: "item", marcador: "–", nivel: 1, trechos: [{ texto: "formulário" }] });
    expect(d.blocos).toContainEqual({ tipo: "item", marcador: "2.", nivel: 0, trechos: [{ texto: "Fase dois" }] });
    expect(d.blocos.at(-1)).toEqual({
      tipo: "tabela",
      colunas: [
        { titulo: "Entrega", largura: 0.56 },
        { titulo: "Data", largura: 0.2 },
        { titulo: "Valor", largura: 0.24, alinhar: "direita" },
      ],
      linhas: [
        ["Protótipo", "01/12/2026", "R$ 5.000,00"],
        ["Site no ar", "15/01/2027", "—"],
      ],
    });
  });

  it("sem parte estruturada: só o texto; sem empresa: só o projeto", () => {
    const d = documentoPdfDaProposta({ ...base, empresa: null, markdown: "Oi.", estruturado: { valor: null, prazoDias: null, escopoResumo: null, entregas: [] } });
    expect(d.subtitulo![0]).toBe("Site da Padaria");
    expect(d.blocos).toEqual([{ tipo: "paragrafo", trechos: [{ texto: "Oi." }] }]);
  });

  it("formatos", () => {
    expect(formatarReais("1234567.5")).toBe("R$ 1.234.567,50");
    expect(nomeArquivoPdf('Site / "Padaria"', 2)).toBe("Proposta - Site Padaria - v2.pdf");
  });
});
