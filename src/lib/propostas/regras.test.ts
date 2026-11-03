import { describe, expect, it } from "vitest";
import type { Area, Papel } from "@prisma/client";
import { mensagemConflito, podeEditarProposta, ROTULO_STATUS_PROPOSTA } from "./regras";

const pessoa = (papel: Papel, area: Area | null = null, id = "eu") => ({ id, papel, area, cargos: [] });

describe("podeEditarProposta (fatia antes da caneta)", () => {
  const meu = { responsavelId: "eu" };
  const deOutro = { responsavelId: "outro" };

  it("vendedor responsável edita; vendedor de outro projeto não", () => {
    expect(podeEditarProposta(pessoa("VENDEDOR"), meu)).toBe(true);
    expect(podeEditarProposta(pessoa("VENDEDOR"), deOutro)).toBe(false);
  });

  it("projetos só lê, mesmo sendo o responsável (o Projeto já pode estar com ele)", () => {
    expect(podeEditarProposta(pessoa("PROJETOS"), meu)).toBe(false);
  });

  it("gestão (gestor/admin) edita qualquer uma; visualizador nunca", () => {
    expect(podeEditarProposta(pessoa("GESTOR"), deOutro)).toBe(true);
    expect(podeEditarProposta(pessoa("ADMIN"), deOutro)).toBe(true);
    expect(podeEditarProposta(pessoa("VISUALIZADOR", "VENDAS"), meu)).toBe(false);
  });
});

describe("textos", () => {
  it("todo status tem rótulo; conflito diz quem e por onde", () => {
    expect(ROTULO_STATUS_PROPOSTA.RASCUNHO).toBe("Rascunho");
    expect(mensagemConflito({ revisao: 4, por: "Gil", viaMcp: true })).toMatch(/por Gil \(via MCP\).*revisão 4.*Nada foi sobrescrito/);
  });
});
