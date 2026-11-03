import { describe, expect, it } from "vitest";
import { diaValido, estruturadoParaEntrada, interpretarEstruturado, lerEstruturadoGravado, somaDasParcelas, valorParaCampo } from "./estruturado";

describe("interpretarEstruturado (validação no servidor)", () => {
  it("vazio é válido: tudo nulo, sem entregas", () => {
    expect(interpretarEstruturado({})).toEqual({ ok: true, valor: { valor: null, prazoDias: null, escopoResumo: null, entregas: [] } });
    expect(interpretarEstruturado(undefined)).toMatchObject({ ok: true });
  });

  it("valor em reais (BR), ≥ 0; prazo em dias inteiros 1–3650", () => {
    expect(interpretarEstruturado({ valor: "R$ 12.500,5", prazoDias: 60 })).toMatchObject({ ok: true, valor: { valor: "12500.50", prazoDias: 60 } });
    expect(interpretarEstruturado({ valor: "0" })).toMatchObject({ ok: true, valor: { valor: "0.00" } });
    for (const valor of ["-1", "abc", "1,234", "12.50"]) expect(interpretarEstruturado({ valor }).ok, valor).toBe(false);
    for (const prazoDias of ["0", "1.5", "-3", "3651", "dez"]) expect(interpretarEstruturado({ prazoDias }).ok, prazoDias).toBe(false);
  });

  it("cronograma: ordem do usuário preservada; nome, data real e valor validados com o número da entrega", () => {
    const r = interpretarEstruturado({ entregas: [{ titulo: " Fase  2 ", dia: "2027-01-10" }, { titulo: "Fase 1", dia: "2026-12-01", valor: "1.000,00" }] });
    expect(r).toEqual({ ok: true, valor: expect.objectContaining({ entregas: [{ titulo: "Fase 2", dia: "2027-01-10", valor: null }, { titulo: "Fase 1", dia: "2026-12-01", valor: "1000.00" }] }) });
    expect(interpretarEstruturado({ entregas: [{ titulo: "a", dia: "2026-01-01" }, { titulo: "", dia: "2026-01-01" }] })).toEqual({ ok: false, erro: "Entrega 2: dê um nome (até 200 caracteres)." });
    expect(interpretarEstruturado({ entregas: [{ titulo: "a", dia: "2026-13-01" }] })).toEqual({ ok: false, erro: "Entrega 1: data inválida (use AAAA-MM-DD)." });
    expect(interpretarEstruturado({ entregas: [{ titulo: "a", dia: "2026-01-01", valor: "-5" }] }).ok).toBe(false);
    expect(interpretarEstruturado({ entregas: Array.from({ length: 51 }, () => ({ titulo: "a", dia: "2026-01-01" })) }).ok).toBe(false);
  });

  it("campos desconhecidos e tipos errados são recusados", () => {
    expect(interpretarEstruturado({ valor: 10 }).ok).toBe(false);
    expect(interpretarEstruturado({ outro: "x" }).ok).toBe(false);
    expect(interpretarEstruturado({ entregas: [{ titulo: "a", dia: "2026-01-01", extra: 1 }] }).ok).toBe(false);
  });

  it("escopo resumido até 2000 caracteres", () => {
    expect(interpretarEstruturado({ escopoResumo: "x".repeat(2001) }).ok).toBe(false);
    expect(interpretarEstruturado({ escopoResumo: "  " })).toMatchObject({ ok: true, valor: { escopoResumo: null } });
  });
});

describe("apoio", () => {
  it("diaValido rejeita dia que não existe", () => {
    expect(diaValido("2028-02-29")).toBe(true);
    expect(diaValido("2027-02-29")).toBe(false);
    expect(diaValido("01/02/2027")).toBe(false);
  });

  it("gravado → formulário → gravado é o mesmo", () => {
    const e = { valor: "12500.00", prazoDias: 30, escopoResumo: "Site", entregas: [{ titulo: "A", dia: "2026-12-01", valor: "1500.50" }] };
    expect(valorParaCampo("1234567.80")).toBe("1.234.567,80");
    expect(interpretarEstruturado(estruturadoParaEntrada(e))).toEqual({ ok: true, valor: e });
    expect(lerEstruturadoGravado(e)).toEqual(e);
    expect(lerEstruturadoGravado("lixo")).toEqual({ valor: null, prazoDias: null, escopoResumo: null, entregas: [] });
  });

  it("soma das parcelas em centavos (sem erro de ponto flutuante)", () => {
    expect(somaDasParcelas([{ titulo: "a", dia: "2026-01-01", valor: "0.10" }, { titulo: "b", dia: "2026-01-02", valor: "0.20" }])).toBe("0.30");
    expect(somaDasParcelas([{ titulo: "a", dia: "2026-01-01", valor: null }])).toBeNull();
  });
});
