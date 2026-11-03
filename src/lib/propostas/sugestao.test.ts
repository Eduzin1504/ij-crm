import { describe, expect, it } from "vitest";
import type { LeituraProposta } from "@/lib/llm/prompts/proposta-arquivo.v1";
import { interpretarLeitura, mesclarSugestao } from "./sugestao";

const nada = { valor: null, confianca: 0, trecho: null };

function leitura(p: Partial<LeituraProposta> = {}): LeituraProposta {
  return { valor_total: nada, prazo_dias: nada, escopo_resumo: nada, entregas: { itens: [], confianca: 0 }, ...p };
}

describe("interpretarLeitura (GAB-90): só aplica o que o arquivo sustenta", () => {
  it("campos confiáveis, com trecho e no formato certo, viram valores do formulário", () => {
    const r = interpretarLeitura(
      leitura({
        valor_total: { valor: "12500", confianca: 0.95, trecho: "Investimento total: R$ 12.500,00" },
        prazo_dias: { valor: 60, confianca: 0.9, trecho: "prazo de 60 dias" },
        escopo_resumo: { valor: "  Site   institucional ", confianca: 0.8, trecho: null },
        entregas: {
          itens: [
            { titulo: "MVP", dia: "2026-12-15", valor: "4000.00" },
            { titulo: "Final", dia: "2027-01-30", valor: null },
          ],
          confianca: 0.9,
        },
      }),
    );
    expect(r.campos).toEqual({
      valor: "12.500,00",
      prazoDias: "60",
      escopoResumo: "Site institucional",
      entregas: [
        { titulo: "MVP", dia: "2026-12-15", valor: "4.000,00" },
        { titulo: "Final", dia: "2027-01-30", valor: "" },
      ],
    });
    expect(r.revisar).toEqual([]);
  });

  it("nada encontrado: tudo vazio e marcado para revisão como não encontrado", () => {
    const r = interpretarLeitura(leitura());
    expect(r.campos).toEqual({ valor: null, prazoDias: null, escopoResumo: null, entregas: null });
    expect(r.revisar.map((i) => [i.campo, i.motivo])).toEqual([
      ["valor", "não encontrado no arquivo"],
      ["prazoDias", "não encontrado no arquivo"],
      ["escopoResumo", "não encontrado no arquivo"],
      ["entregas", "não encontrado no arquivo"],
    ]);
  });

  it("baixa confiança, sem trecho ou formato ruim: NÃO aplica; mostra o que foi lido para conferir", () => {
    const r = interpretarLeitura(
      leitura({
        valor_total: { valor: "12500.00", confianca: 0.4, trecho: "R$ 12.5OO" },
        prazo_dias: { valor: 90, confianca: 0.95, trecho: null },
        escopo_resumo: { valor: "Algo", confianca: 0.3, trecho: null },
      }),
    );
    expect(r.campos.valor).toBeNull();
    expect(r.campos.prazoDias).toBeNull();
    expect(r.campos.escopoResumo).toBeNull();
    expect(r.revisar[0]).toEqual({ campo: "valor", motivo: "leitura incerta: confira no arquivo", lido: "12500.00", trecho: "R$ 12.5OO" });
    expect(r.revisar[1]).toMatchObject({ campo: "prazoDias", motivo: "sem trecho do arquivo que comprove", lido: "90" });

    const ruim = interpretarLeitura(leitura({ valor_total: { valor: "R$ 12.500,00", confianca: 0.99, trecho: "x" }, prazo_dias: { valor: 0, confianca: 1, trecho: "x" } }));
    expect(ruim.campos.valor).toBeNull();
    expect(ruim.campos.prazoDias).toBeNull();
    expect(ruim.revisar[0].motivo).toMatch(/formato/);
  });

  it("entrega sem data completa não entra (o cronograma exige dia); as outras entram", () => {
    const r = interpretarLeitura(
      leitura({
        entregas: {
          itens: [
            { titulo: "Diagnóstico", dia: null, valor: null },
            { titulo: "Relatório", dia: "2026-02-31", valor: null },
            { titulo: "Entrega final", dia: "2026-12-01", valor: "abc" },
          ],
          confianca: 0.9,
        },
      }),
    );
    expect(r.campos.entregas).toEqual([{ titulo: "Entrega final", dia: "2026-12-01", valor: "" }]);
    expect(r.revisar.filter((i) => i.campo === "entregas").map((i) => i.motivo)).toEqual([
      expect.stringContaining('"Diagnóstico" sem data completa'),
      expect.stringContaining('"Relatório" sem data completa'),
      expect.stringContaining('"Entrega final": valor em formato'),
    ]);
  });

  it("cronograma com confiança baixa: não aplica nenhuma entrega", () => {
    const r = interpretarLeitura(leitura({ entregas: { itens: [{ titulo: "MVP", dia: "2026-12-15", valor: null }], confianca: 0.5 } }));
    expect(r.campos.entregas).toBeNull();
    expect(r.revisar.find((i) => i.campo === "entregas")).toMatchObject({ motivo: "leitura incerta: confira no arquivo", lido: "MVP" });
  });
});

describe("mesclarSugestao", () => {
  it("o que a sugestão não preenche fica como está no rascunho", () => {
    const atual = { valor: "1.000,00", prazoDias: "30", escopoResumo: "antigo", entregas: [{ titulo: "A", dia: "2026-12-01", valor: "" }] };
    expect(mesclarSugestao(atual, { valor: "2.000,00", prazoDias: null, escopoResumo: null, entregas: null })).toEqual({ ...atual, valor: "2.000,00" });
    expect(mesclarSugestao(atual, { valor: null, prazoDias: "45", escopoResumo: "novo", entregas: [] })).toEqual({ valor: "1.000,00", prazoDias: "45", escopoResumo: "novo", entregas: [] });
  });
});
