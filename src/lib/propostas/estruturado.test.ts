import { describe, expect, it } from "vitest";
import { datasPrevistas, diaValido, duracaoEmDias, estruturadoParaEntrada, interpretarEstruturado, lerEstruturadoGravado, mesmoEstruturado, normalizarDuracao, somaDasParcelas, valorParaCampo } from "./estruturado";

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
    expect(r).toEqual({ ok: true, valor: expect.objectContaining({ entregas: [{ titulo: "Fase 2", dia: "2027-01-10", duracao: null, valor: null }, { titulo: "Fase 1", dia: "2026-12-01", duracao: null, valor: "1000.00" }] }) });
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
    const e = { valor: "12500.00", prazoDias: 30, escopoResumo: "Site", entregas: [{ titulo: "A", dia: "2026-12-01", duracao: null, valor: "1500.50" }] };
    expect(valorParaCampo("1234567.80")).toBe("1.234.567,80");
    expect(interpretarEstruturado(estruturadoParaEntrada(e))).toEqual({ ok: true, valor: e });
    expect(lerEstruturadoGravado(e)).toEqual(e);
    expect(lerEstruturadoGravado("lixo")).toEqual({ valor: null, prazoDias: null, escopoResumo: null, entregas: [] });
  });

  it("soma das parcelas em centavos (sem erro de ponto flutuante)", () => {
    expect(somaDasParcelas([{ titulo: "a", dia: "2026-01-01", duracao: null, valor: "0.10" }, { titulo: "b", dia: "2026-01-02", duracao: null, valor: "0.20" }])).toBe("0.30");
    expect(somaDasParcelas([{ titulo: "a", dia: "2026-01-01", duracao: null, valor: null }])).toBeNull();
  });
});

describe("duração na entrega (GAB-100)", () => {
  it("entrega com data ou duração; a duração é normalizada", () => {
    const r = interpretarEstruturado({ entregas: [{ titulo: "A", duracao: "2 Sem" }, { titulo: "B", duracao: "1 semanas", valor: "1,00" }, { titulo: "C", dia: "2026-12-01" }, { titulo: "D", duracao: " 3 meses " }, { titulo: "E", duracao: "1 mês" }, { titulo: "F", duracao: "15 dias" }] });
    expect(r).toMatchObject({
      ok: true,
      valor: {
        entregas: [
          { titulo: "A", dia: null, duracao: "2 semanas", valor: null },
          { titulo: "B", dia: null, duracao: "1 semana", valor: "1.00" },
          { titulo: "C", dia: "2026-12-01", duracao: null, valor: null },
          { titulo: "D", dia: null, duracao: "3 meses", valor: null },
          { titulo: "E", dia: null, duracao: "1 mês", valor: null },
          { titulo: "F", dia: null, duracao: "15 dias", valor: null },
        ],
      },
    });
  });

  it("nem data nem duração, as duas, ou duração que não se entende são recusadas com o número da entrega", () => {
    expect(interpretarEstruturado({ entregas: [{ titulo: "a" }] })).toEqual({ ok: false, erro: 'Entrega 1: informe a data ou a duração (como "2 semanas").' });
    expect(interpretarEstruturado({ entregas: [{ titulo: "a", dia: "2026-01-01", duracao: "2 semanas" }] })).toEqual({ ok: false, erro: "Entrega 1: informe a data ou a duração, não as duas." });
    for (const duracao of ["logo", "0 dias", "2", "semanas", "dois meses", "1000 dias"]) expect(interpretarEstruturado({ entregas: [{ titulo: "a", duracao }] }).ok, duracao).toBe(false);
  });

  it("entrega antiga, gravada só com dia, continua válida e igual depois de relida", () => {
    const antiga = { valor: null, prazoDias: null, escopoResumo: null, entregas: [{ titulo: "A", dia: "2026-12-01", valor: null }] };
    const lida = lerEstruturadoGravado(antiga);
    expect(lida.entregas).toEqual([{ titulo: "A", dia: "2026-12-01", duracao: null, valor: null }]);
    // Reenviar o formulário de uma proposta antiga não conta como mudança (regra de §4.4, "concordar").
    const reenviada = interpretarEstruturado(estruturadoParaEntrada(lida));
    expect(reenviada.ok && mesmoEstruturado(reenviada.valor, lida)).toBe(true);
  });

  it("entrega só com duração não some ao reler; só linha sem nada é descartada", () => {
    const lida = lerEstruturadoGravado({ entregas: [{ titulo: "A", dia: null, duracao: "2 semanas", valor: null }, { titulo: "B" }, { titulo: "C", dia: "" }] });
    expect(lida.entregas).toEqual([{ titulo: "A", dia: null, duracao: "2 semanas", valor: null }]);
    const r = interpretarEstruturado(estruturadoParaEntrada(lida));
    expect(r.ok && mesmoEstruturado(r.valor, lida)).toBe(true);
  });

  it("datasPrevistas: durações em sequência a partir do início; data fixa vira o novo ponto de partida; nenhuma some", () => {
    const entregas = [
      { titulo: "A", dia: null, duracao: "2 semanas", valor: "10.00" },
      { titulo: "B", dia: null, duracao: "1 mês", valor: null },
      { titulo: "C", dia: "2027-06-01", duracao: null, valor: null },
      { titulo: "D", dia: null, duracao: "3 dias", valor: null },
    ];
    expect(datasPrevistas(entregas, "2026-12-20")).toEqual([
      { titulo: "A", dia: "2027-01-03", valor: "10.00" },
      { titulo: "B", dia: "2027-02-02", valor: null },
      { titulo: "C", dia: "2027-06-01", valor: null },
      { titulo: "D", dia: "2027-06-04", valor: null },
    ]);
    expect(duracaoEmDias("2 semanas")).toBe(14);
    expect(normalizarDuracao("x")).toBeNull();
  });
});
