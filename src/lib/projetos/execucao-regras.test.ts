import { describe, expect, it } from "vitest";
import { diaNoIntervalo, gpDoProjeto, lerMotivo, MOTIVO_MAX, podeOperarExecucao } from "./execucao-regras";
import { inicioDoAcompanhamento, semanaCobrada, semanaCobravel, semanaDe } from "./execucao-semana";

const pessoa = (id: string, papel: "ADMIN" | "GESTOR" | "VENDEDOR" | "PROJETOS" | "VISUALIZADOR", area: "VENDAS" | "PROJETOS" | null = null, extra: { ativo?: boolean; cargos?: "GP"[] } = {}) => ({
  id,
  papel,
  area,
  cargos: extra.cargos ?? [],
  ativo: extra.ativo ?? true,
});

describe("podeOperarExecucao", () => {
  it("GP do projeto opera; colega da área só lê, mesmo com o cargo de GP de projetos", () => {
    expect(podeOperarExecucao(pessoa("gp", "PROJETOS", "PROJETOS"), "gp")).toBe(true);
    expect(podeOperarExecucao(pessoa("par", "PROJETOS", "PROJETOS"), "gp")).toBe(false);
    expect(podeOperarExecucao(pessoa("chefe", "PROJETOS", "PROJETOS", { cargos: ["GP"] }), "gp")).toBe(false);
  });

  it("apoio: admin e gestor de projetos ou sem área; gestor de vendas não", () => {
    expect(podeOperarExecucao(pessoa("a", "ADMIN"), "gp")).toBe(true);
    expect(podeOperarExecucao(pessoa("g", "GESTOR"), "gp")).toBe(true);
    expect(podeOperarExecucao(pessoa("g", "GESTOR", "PROJETOS"), "gp")).toBe(true);
    expect(podeOperarExecucao(pessoa("g", "GESTOR", "VENDAS"), "gp")).toBe(false);
  });

  it("visualizador e inativo nunca, nem sendo o GP gravado", () => {
    expect(podeOperarExecucao(pessoa("gp", "VISUALIZADOR"), "gp")).toBe(false);
    expect(podeOperarExecucao(pessoa("gp", "PROJETOS", "PROJETOS", { ativo: false }), "gp")).toBe(false);
    expect(podeOperarExecucao(pessoa("a", "ADMIN", null, { ativo: false }), "gp")).toBe(false);
  });
});

describe("gpDoProjeto", () => {
  const valido = pessoa("gp", "PROJETOS", "PROJETOS");
  it("o designado vale, mesmo com o responsável trocado", () => {
    expect(gpDoProjeto({ responsavelId: "outro", gpDesignado: valido })).toBe("gp");
  });
  it("sem designado, ou se ele não vale mais, é o responsável", () => {
    expect(gpDoProjeto({ responsavelId: "r", gpDesignado: null })).toBe("r");
    expect(gpDoProjeto({ responsavelId: "r", gpDesignado: undefined })).toBe("r");
    expect(gpDoProjeto({ responsavelId: "r", gpDesignado: { ...valido, ativo: false } })).toBe("r");
    expect(gpDoProjeto({ responsavelId: "r", gpDesignado: pessoa("gp", "VENDEDOR", "VENDAS") })).toBe("r");
  });
});

describe("lerMotivo", () => {
  it("vira uma linha; vazio e comprido demais são recusados", () => {
    expect(lerMotivo("  atraso\n do  cliente ")).toBe("atraso do cliente");
    expect(lerMotivo("   ")).toBeNull();
    expect(lerMotivo("x".repeat(MOTIVO_MAX))).toHaveLength(MOTIVO_MAX);
    expect(lerMotivo("x".repeat(MOTIVO_MAX + 1))).toBeNull();
  });
});

describe("diaNoIntervalo", () => {
  it("barra ano errado", () => {
    expect(diaNoIntervalo("2026-11-04")).toBe(true);
    expect(diaNoIntervalo("0202-11-04")).toBe(false);
    expect(diaNoIntervalo("2101-01-01")).toBe(false);
  });
});

describe("semana em São Paulo", () => {
  it("segunda a domingo, no fuso de São Paulo e não no do servidor", () => {
    // 04/11/2026 é quarta. Dom 08/11 23h30 em SP já é segunda em UTC.
    expect(semanaDe(new Date("2026-11-04T15:00:00Z"))).toBe("2026-11-02");
    expect(semanaDe(new Date("2026-11-09T02:30:00Z"))).toBe("2026-11-02");
    expect(semanaDe(new Date("2026-11-09T03:00:00Z"))).toBe("2026-11-09");
  });

  it("cobra a semana que acabou de passar", () => {
    expect(semanaCobrada(new Date("2026-11-09T03:00:00Z"))).toBe("2026-11-02");
    expect(semanaCobrada(new Date("2026-11-09T02:30:00Z"))).toBe("2026-10-26");
  });

  it("a semana da entrada não é cobrada; sem início, nada é cobrado", () => {
    const quarta = new Date("2026-11-04T15:00:00Z");
    expect(semanaCobravel(quarta, "2026-11-02")).toBe(false);
    expect(semanaCobravel(quarta, "2026-11-09")).toBe(true);
    expect(semanaCobravel(null, "2026-11-09")).toBe(false);
  });
});

describe("inicioDoAcompanhamento (lembrete e painel usam a mesma regra)", () => {
  const a = new Date("2026-10-01T12:00:00Z");
  const b = new Date("2026-10-08T12:00:00Z");
  it("vale a entrada em Execução; sem ela, a primeira data que houver; sem nenhuma, null", () => {
    expect(inicioDoAcompanhamento(b, [a])).toEqual(b);
    expect(inicioDoAcompanhamento(null, [b, a, undefined, null])).toEqual(a);
    expect(inicioDoAcompanhamento(null, [undefined])).toBeNull();
  });
});
