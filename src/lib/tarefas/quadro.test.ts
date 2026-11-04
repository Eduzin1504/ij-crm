import { describe, expect, it } from "vitest";
import { agruparPorResponsavel, posicaoEntre, SEM_RESPONSAVEL } from "./quadro";

const pessoas = [
  { id: "p", nome: "Paula", fotoEm: null, ativo: true },
  { id: "e", nome: "Eduardo", fotoEm: null, ativo: true },
  { id: "x", nome: "Xavier", fotoEm: null, ativo: false },
  { id: "z", nome: "Zé sem tarefa", fotoEm: null, ativo: true },
];

describe("agruparPorResponsavel", () => {
  it("uma linha por pessoa com tarefa, em ordem de nome; 'Sem responsável' por último; pessoa sem tarefa não ganha linha", () => {
    const linhas = agruparPorResponsavel(
      [
        { id: "1", responsavelId: "p" },
        { id: "2", responsavelId: null },
        { id: "3", responsavelId: "e" },
        { id: "4", responsavelId: "p" },
        { id: "5", responsavelId: "x" },
      ],
      pessoas,
    );
    expect(linhas.map((l) => [l.chave, l.nome, l.tarefas.map((t) => t.id)])).toEqual([
      ["e", "Eduardo", ["3"]],
      ["p", "Paula", ["1", "4"]],
      ["x", "Xavier (inativo)", ["5"]],
      [SEM_RESPONSAVEL, "Sem responsável", ["2"]],
    ]);
  });

  it("sem tarefa sem dono, não há linha 'Sem responsável'; responsável fora da lista ainda aparece", () => {
    expect(agruparPorResponsavel([{ responsavelId: "p" }], pessoas).map((l) => l.chave)).toEqual(["p"]);
    expect(agruparPorResponsavel([{ responsavelId: "fantasma" }], pessoas).map((l) => l.nome)).toEqual(["Pessoa removida"]);
  });
});

describe("posicaoEntre", () => {
  it("fica no meio dos vizinhos; no fim, +1; no início, −1; coluna vazia, 1", () => {
    expect(posicaoEntre(1, 2)).toBe(1.5);
    expect(posicaoEntre(3, null)).toBe(4);
    expect(posicaoEntre(null, 1)).toBe(0);
    expect(posicaoEntre(null, null)).toBe(1);
  });
});
