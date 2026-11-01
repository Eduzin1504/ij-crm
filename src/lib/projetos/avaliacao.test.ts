import { describe, expect, it } from "vitest";
import { Sentimento } from "@prisma/client";
import { SENTIMENTOS } from "@/lib/llm/prompts/extracao.v3";
import { NOTA_CONTATO_MAX, NOTA_CONTATO_MIN, ROTULO_SENTIMENTO, notaContatoValida, resumoAvaliacao } from "./avaliacao";

describe("avaliação do contato (GAB-85)", () => {
  it("enum do Prisma = sentimentos do prompt v3", () => {
    expect(Object.values(Sentimento).sort()).toEqual([...SENTIMENTOS].sort());
    expect(Object.keys(ROTULO_SENTIMENTO).sort()).toEqual([...SENTIMENTOS].sort());
  });

  it("nota válida: inteiro de 1 a 5", () => {
    expect([NOTA_CONTATO_MIN, NOTA_CONTATO_MAX]).toEqual([1, 5]);
    for (const n of [1, 2, 3, 4, 5]) expect(notaContatoValida(n)).toBe(true);
    for (const n of [0, 6, 2.5, -1, Number.NaN, Number.POSITIVE_INFINITY, "3", null, undefined]) expect(notaContatoValida(n)).toBe(false);
  });

  it("resumo do card: média das notas e contagem de sentimentos; vazio → null", () => {
    expect(resumoAvaliacao([{ nota: null, sentimento: null }])).toBeNull();
    expect(
      resumoAvaliacao([
        { nota: 5, sentimento: null },
        { nota: 4, sentimento: null },
        { nota: null, sentimento: "POSITIVO" },
        { nota: null, sentimento: "NEGATIVO" },
        { nota: null, sentimento: "POSITIVO" },
        { nota: null, sentimento: null },
      ]),
    ).toEqual({ notas: 2, media: 4.5, sentimentos: { POSITIVO: 2, NEUTRO: 0, NEGATIVO: 1 } });
  });
});
