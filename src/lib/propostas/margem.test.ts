import { describe, expect, it } from "vitest";
import { posicoesNaMargem, VAO_MARGEM } from "./margem";

describe("posicoesNaMargem", () => {
  it("cada cartão na altura do trecho; o de baixo desce se colidir", () => {
    const r = posicoesNaMargem([
      { id: "b", alvo: 110, altura: 50 },
      { id: "a", alvo: 100, altura: 50 },
      { id: "c", alvo: 500, altura: 30 },
    ]);
    expect(r.topos).toEqual({ a: 100, b: 150 + VAO_MARGEM, c: 500 });
    expect(r.altura).toBe(530);
  });

  it("sem trecho na tela (geral, alterado) fica no topo da margem; quem tem trecho desce se colidir", () => {
    const r = posicoesNaMargem([
      { id: "geral", alvo: null, altura: 20 },
      { id: "acima", alvo: -40, altura: 30 },
    ]);
    expect(r.topos).toEqual({ geral: 0, acima: 20 + VAO_MARGEM });
    expect(posicoesNaMargem([{ id: "geral", alvo: null, altura: 20 }, { id: "longe", alvo: 900, altura: 30 }]).topos).toEqual({ geral: 0, longe: 900 });
  });
});
