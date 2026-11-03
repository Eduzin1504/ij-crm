import { describe, expect, it } from "vitest";
import type { Area, Papel } from "@prisma/client";
import { mensagemConflito, podeCriarProposta, ROTULO_STATUS_PROPOSTA } from "./regras";

const pessoa = (papel: Papel, area: Area | null = null, id = "eu") => ({ id, papel, area, cargos: [] });

describe("podeCriarProposta (quem cria; editar é da caneta)", () => {
  const meu = { responsavelId: "eu" };
  const deOutro = { responsavelId: "outro" };

  it("vendedor responsável cria; vendedor de outro projeto não", () => {
    expect(podeCriarProposta(pessoa("VENDEDOR"), meu)).toBe(true);
    expect(podeCriarProposta(pessoa("VENDEDOR"), deOutro)).toBe(false);
  });

  it("projetos não cria, mesmo sendo o responsável (o Projeto já pode estar com ele)", () => {
    expect(podeCriarProposta(pessoa("PROJETOS"), meu)).toBe(false);
  });

  it("gestão (gestor/admin) cria em qualquer projeto; visualizador nunca", () => {
    expect(podeCriarProposta(pessoa("GESTOR"), deOutro)).toBe(true);
    expect(podeCriarProposta(pessoa("ADMIN"), deOutro)).toBe(true);
    expect(podeCriarProposta(pessoa("VISUALIZADOR", "VENDAS"), meu)).toBe(false);
  });
});

describe("textos", () => {
  it("todo status tem rótulo; conflito diz quem e por onde", () => {
    expect(ROTULO_STATUS_PROPOSTA.RASCUNHO).toBe("Rascunho");
    expect(ROTULO_STATUS_PROPOSTA.INVIAVEL).toBe("Inviável");
    expect(mensagemConflito({ revisao: 4, por: "Gil", viaMcp: true })).toMatch(/por Gil \(via MCP\).*revisão 4.*Nada foi sobrescrito/);
  });
});
