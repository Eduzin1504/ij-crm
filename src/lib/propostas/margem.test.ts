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

  it("sem trecho na tela vai depois dos outros; trecho acima da lista encosta no topo", () => {
    const r = posicoesNaMargem([
      { id: "geral", alvo: null, altura: 20 },
      { id: "acima", alvo: -40, altura: 30 },
    ]);
    expect(r.topos).toEqual({ acima: 0, geral: 30 + VAO_MARGEM });
  });
});
