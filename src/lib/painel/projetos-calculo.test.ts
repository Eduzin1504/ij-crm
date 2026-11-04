import { describe, expect, it } from "vitest";
import {
  atrasoDaEntrega,
  esperasDoCliente,
  montarCaneta,
  montarExecucao,
  propostaParada,
  situacaoDoProjeto,
  type EntregaAtiva,
  type PeriodoCaneta,
  type ProjetoEmExecucao,
  type ProjetoEncerrado,
} from "./projetos-calculo";

// Quarta, 11/11/2026, 12h em São Paulo.
const AGORA = new Date("2026-11-11T15:00:00Z");
const NOVEMBRO = { primeiroDia: "2026-11-01", ultimoDia: "2026-11-30", inicio: new Date("2026-11-01T03:00:00Z"), fim: new Date("2026-12-01T03:00:00Z") };

const ANA = { id: "ana", nome: "Ana", ativo: true };
const BIA = { id: "bia", nome: "Bia", ativo: true };

function entrega(previstoOriginal: string, extra: Partial<EntregaAtiva> = {}): EntregaAtiva {
  return { previstoOriginal, previstoAtual: previstoOriginal, realizado: null, ajustes: 0, ...extra };
}

function projeto(extra: Partial<ProjetoEmExecucao> = {}): ProjetoEmExecucao {
  return { id: "p1", titulo: "Site", fase: "Em execução", gp: ANA, entregas: [], ultimoCheckin: null, inicioAcompanhamento: new Date("2026-10-01T12:00:00Z"), semanasCobradas: 0, ...extra };
}

describe("atraso de uma entrega (dias além do previsto original, o que a proposta combinou)", () => {
  it("feita: data real − original; adiantada não fica negativa", () => {
    expect(atrasoDaEntrega(entrega("2026-11-01", { realizado: "2026-11-04" }), "2026-11-11")).toBe(3);
    expect(atrasoDaEntrega(entrega("2026-11-05", { realizado: "2026-11-01" }), "2026-11-11")).toBe(0);
  });

  it("pendente vencida conta até hoje", () => {
    expect(atrasoDaEntrega(entrega("2026-11-01"), "2026-11-11")).toBe(10);
  });

  it("pendente com data empurrada: ajuste não apaga o atraso frente à proposta", () => {
    expect(atrasoDaEntrega(entrega("2026-11-01", { previstoAtual: "2026-11-21" }), "2026-11-11")).toBe(20);
  });

  it("pendente no prazo: zero", () => {
    expect(atrasoDaEntrega(entrega("2026-11-20"), "2026-11-11")).toBe(0);
  });
});

describe("situação de um projeto em execução", () => {
  it("previstas × feitas no período, atrasadas, atraso acumulado e ajustes", () => {
    const s = situacaoDoProjeto(
      projeto({
        entregas: [
          entrega("2026-10-20", { realizado: "2026-11-02" }), // fora do período pelo previsto, feita nele: 13 dias
          entrega("2026-11-03", { realizado: "2026-11-03" }), // no prazo
          entrega("2026-11-05"), // vencida: 6 dias
          entrega("2026-11-08", { previstoAtual: "2026-11-25", ajustes: 2 }), // empurrada: 17 dias, não "atrasada" hoje
          entrega("2026-12-10"), // futura
        ],
      }),
      NOVEMBRO,
      AGORA,
    );
    expect(s).toMatchObject({ semPrevisto: false, totalEntregas: 5, feitas: 2, previstasNoPeriodo: 3, feitasNoPeriodo: 2, atrasadas: 1, atrasoDias: 36, ajustes: 2 });
  });

  it("atrasada é a mesma conta do ver_cronograma: pendente com previsto atual antes de hoje", () => {
    const hoje = situacaoDoProjeto(projeto({ entregas: [entrega("2026-11-11")] }), NOVEMBRO, AGORA);
    const ontem = situacaoDoProjeto(projeto({ entregas: [entrega("2026-11-10")] }), NOVEMBRO, AGORA);
    expect(hoje.atrasadas).toBe(0);
    expect(ontem.atrasadas).toBe(1);
  });

  it("hoje é o dia de São Paulo: 22h de domingo em SP já é segunda em UTC", () => {
    const domingo22h = new Date("2026-11-16T01:00:00Z");
    const s = situacaoDoProjeto(projeto({ entregas: [entrega("2026-11-15")] }), NOVEMBRO, domingo22h);
    expect(s.atrasadas).toBe(0);
    expect(s.atrasoDias).toBe(0);
  });

  it("sem cronograma (migrado): 'sem previsto', zeros e sem atraso", () => {
    expect(situacaoDoProjeto(projeto({ entregas: [] }), NOVEMBRO, AGORA)).toMatchObject({ semPrevisto: true, totalEntregas: 0, feitas: 0, previstasNoPeriodo: 0, feitasNoPeriodo: 0, atrasadas: 0, atrasoDias: 0, ajustes: 0 });
  });

  it("cronograma fora do período não é 'sem previsto'", () => {
    expect(situacaoDoProjeto(projeto({ entregas: [entrega("2027-01-10")] }), NOVEMBRO, AGORA)).toMatchObject({ semPrevisto: false, previstasNoPeriodo: 0 });
  });

  describe("sem check-in na semana (segunda a domingo de São Paulo)", () => {
    const checkin = (semana: string) => ({ status: "VERDE" as const, motivo: "ok", semana, em: new Date(`${semana}T15:00:00Z`) });

    it("sem check-in nesta semana, com o acompanhamento de antes: entra", () => {
      expect(situacaoDoProjeto(projeto({ ultimoCheckin: checkin("2026-11-02") }), NOVEMBRO, AGORA).semCheckinNaSemana).toBe(true);
      expect(situacaoDoProjeto(projeto(), NOVEMBRO, AGORA).semCheckinNaSemana).toBe(true);
    });

    it("com check-in nesta semana: fora", () => {
      expect(situacaoDoProjeto(projeto({ ultimoCheckin: checkin("2026-11-09") }), NOVEMBRO, AGORA).semCheckinNaSemana).toBe(false);
    });

    it("a semana em que entrou em Execução não é cobrada, como no lembrete", () => {
      expect(situacaoDoProjeto(projeto({ inicioAcompanhamento: new Date("2026-11-09T12:00:00Z") }), NOVEMBRO, AGORA).semCheckinNaSemana).toBe(false);
    });

    it("migrado sem entrega nem check-in (inicio null) não é cobrado", () => {
      expect(situacaoDoProjeto(projeto({ inicioAcompanhamento: null }), NOVEMBRO, AGORA).semCheckinNaSemana).toBe(false);
    });

    it("domingo 23h30 de SP ainda é a semana que o check-in gravou", () => {
      const domingo = new Date("2026-11-16T02:30:00Z");
      expect(situacaoDoProjeto(projeto({ ultimoCheckin: checkin("2026-11-09") }), NOVEMBRO, domingo).semCheckinNaSemana).toBe(false);
      const segunda = new Date("2026-11-16T03:30:00Z");
      expect(situacaoDoProjeto(projeto({ ultimoCheckin: checkin("2026-11-09") }), NOVEMBRO, segunda).semCheckinNaSemana).toBe(true);
    });
  });
});

describe("montarExecucao", () => {
  const checkin = (status: "VERDE" | "AMARELO" | "VERMELHO") => ({ status, motivo: "m", semana: "2026-11-09", em: new Date("2026-11-10T12:00:00Z") });
  const projetos = [
    projeto({ id: "verde", titulo: "Verde", gp: ANA, ultimoCheckin: checkin("VERDE"), entregas: [entrega("2026-11-20")] }),
    projeto({ id: "amarelo", titulo: "Amarelo", gp: BIA, ultimoCheckin: checkin("AMARELO"), entregas: [entrega("2026-11-09")] }),
    projeto({ id: "vermelho", titulo: "Vermelho", gp: ANA, ultimoCheckin: { ...checkin("VERMELHO"), semana: "2026-11-02" }, entregas: [entrega("2026-11-01")] }),
    projeto({ id: "migrado", titulo: "Migrado", gp: BIA, inicioAcompanhamento: null }),
  ];

  it("totais, atrasados (o mais atrasado primeiro) e alertas", () => {
    const e = montarExecucao(projetos, [], NOVEMBRO, null, AGORA);
    expect(e.totais).toEqual({ emExecucao: 4, semPrevisto: 1, comAtraso: 2, previstasNoPeriodo: 3, feitasNoPeriodo: 0, previstasEncerrados: 0, feitasEncerrados: 0, atrasadas: 2, atrasoDias: 12, vermelhos: 1, amarelos: 1, semCheckin: 1 });
    expect(e.projetos.map((p) => p.id)).toEqual(["vermelho", "amarelo", "migrado", "verde"]);
    expect(e.atrasados.map((p) => p.id)).toEqual(["vermelho", "amarelo"]);
    expect(e.alertas.vermelhos.map((p) => p.id)).toEqual(["vermelho"]);
    expect(e.alertas.amarelos.map((p) => p.id)).toEqual(["amarelo"]);
    expect(e.alertas.semCheckin.map((p) => p.id)).toEqual(["vermelho"]);
  });

  it("projeto sem previsto não aparece como atrasado", () => {
    expect(montarExecucao(projetos, [], NOVEMBRO, null, AGORA).atrasados.map((p) => p.id)).not.toContain("migrado");
  });

  it("filtro por GP restringe tudo; as opções continuam sendo todos os GPs", () => {
    const e = montarExecucao(projetos, [], NOVEMBRO, "bia", AGORA);
    expect(e.projetos.map((p) => p.id).sort()).toEqual(["amarelo", "migrado"]);
    expect(e.totais.emExecucao).toBe(2);
    expect(e.gps).toEqual([
      { ...ANA, projetos: 2 },
      { ...BIA, projetos: 2 },
    ]);
  });

  it("encerrados: fora de atraso e alertas, mas previstas e feitas somam no total, à parte; respeitam o filtro", () => {
    const encerrado: ProjetoEncerrado = {
      id: "x",
      titulo: "Perdido",
      fase: "Perdido",
      tipo: "PERDIDO",
      gp: ANA,
      encerradoEm: new Date("2026-11-05T12:00:00Z"),
      entregas: [
        { previstoOriginal: "2026-11-02", realizado: "2026-11-02" },
        { previstoOriginal: "2026-11-03", realizado: null },
        { previstoOriginal: "2026-10-03", realizado: "2026-10-03" },
      ],
    };
    const e = montarExecucao(projetos, [encerrado], NOVEMBRO, null, AGORA);
    expect(e.encerrados[0]).toMatchObject({ id: "x", semPrevisto: false, totalEntregas: 3, feitas: 2, previstasNoPeriodo: 2, feitasNoPeriodo: 1 });
    expect(e.totais).toMatchObject({ emExecucao: 4, previstasNoPeriodo: 5, feitasNoPeriodo: 1, previstasEncerrados: 2, feitasEncerrados: 1, atrasadas: 2, atrasoDias: 12, comAtraso: 2 });
    expect(e.projetos.map((p) => p.id)).not.toContain("x");
    const daBia = montarExecucao(projetos, [encerrado], NOVEMBRO, "bia", AGORA);
    expect(daBia.encerrados).toEqual([]);
    expect(daBia.totais.previstasEncerrados).toBe(0);
  });

  it("o mês passado não muda quando o projeto encerra", () => {
    const entregas = [entrega("2026-10-05", { realizado: "2026-10-06" }), entrega("2026-10-10")];
    const OUTUBRO = { primeiroDia: "2026-10-01", ultimoDia: "2026-10-31", inicio: new Date("2026-10-01T03:00:00Z"), fim: new Date("2026-11-01T03:00:00Z") };
    const aberto = montarExecucao([projeto({ entregas })], [], OUTUBRO, null, AGORA).totais;
    const fechado = montarExecucao([], [{ id: "p1", titulo: "Site", fase: "Finalizado", tipo: "FINALIZADO", gp: ANA, encerradoEm: AGORA, entregas }], OUTUBRO, null, AGORA).totais;
    expect([fechado.previstasNoPeriodo, fechado.feitasNoPeriodo]).toEqual([aberto.previstasNoPeriodo, aberto.feitasNoPeriodo]);
  });
});

describe("propostaParada: a caneta está com alguém que precisa agir", () => {
  const aberto = { quadro: "vendas", faseTerminal: false };
  it.each(["RASCUNHO", "EM_ANALISE", "EM_AJUSTE", "REVISAO_PEDIDA", "PRONTA_PARA_ENVIO"] as const)("%s conta", (status) => {
    expect(propostaParada({ status, ...aberto })).toBe(true);
  });
  it.each(["ENVIADA", "ACEITA", "RECUSADA", "INVIAVEL"] as const)("%s não conta: é a vez do cliente ou acabou", (status) => {
    expect(propostaParada({ status, ...aberto })).toBe(false);
  });
  it("card em Projetos: a proposta congelou; card em fase terminal: acabou", () => {
    expect(propostaParada({ status: "EM_AJUSTE", quadro: "projetos", faseTerminal: false })).toBe(false);
    expect(propostaParada({ status: "EM_AJUSTE", quadro: "vendas", faseTerminal: true })).toBe(false);
  });
});

describe("montarCaneta", () => {
  const periodo = (extra: Partial<PeriodoCaneta> = {}): PeriodoCaneta => ({
    projetoId: "p1",
    titulo: "Site",
    usuario: ANA,
    lado: "VENDAS",
    status: "EM_AJUSTE",
    inicio: new Date("2026-11-09T15:00:00Z"),
    fim: null,
    parada: true,
    fimDoCard: null,
    esperas: [],
    rascunhoEm: null,
    ...extra,
  });

  it("parada agora: dias desde que a caneta chegou, com a mais antiga e a média por pessoa", () => {
    const c = montarCaneta([periodo(), periodo({ projetoId: "p2", titulo: "App", inicio: new Date("2026-11-07T15:00:00Z") }), periodo({ projetoId: "p3", titulo: "Bot", usuario: BIA, lado: "PROJETOS", inicio: new Date("2026-11-11T03:00:00Z") })], 2, NOVEMBRO, null, AGORA);
    expect(c.semDono).toBe(2);
    expect(c.paradas).toBe(3);
    expect(c.porPessoa.map((l) => [l.usuario.id, l.paradas, l.maiorDias, l.mediaDias])).toEqual([
      ["ana", 2, 4, 3],
      ["bia", 1, 0.5, 0.5],
    ]);
    expect(c.maisParadas.map((m) => [m.projetoId, m.dias])).toEqual([
      ["p2", 4],
      ["p1", 2],
      ["p3", 0.5],
    ]);
  });

  it("no período: soma o tempo com a caneta dentro do intervalo, cortado nas pontas e em agora", () => {
    const c = montarCaneta(
      [
        // Começou antes do período: conta só de 01/11 03:00Z até 03/11 03:00Z.
        periodo({ inicio: new Date("2026-10-20T03:00:00Z"), fim: new Date("2026-11-03T03:00:00Z"), parada: false }),
        // Aberta, parada: até agora, nunca até o fim do mês.
        periodo({ inicio: new Date("2026-11-10T15:00:00Z") }),
        // Fora do período.
        periodo({ inicio: new Date("2026-10-01T03:00:00Z"), fim: new Date("2026-10-02T03:00:00Z"), parada: false }),
      ],
      0,
      NOVEMBRO,
      null,
      AGORA,
    );
    expect(c.noPeriodoDias).toBe(3);
    expect(c.porPessoa[0]).toMatchObject({ paradas: 1, noPeriodoDias: 3 });
  });

  it("espera pelo cliente não conta: tira o intervalo entre o envio e a resposta", () => {
    const c = montarCaneta(
      [periodo({ inicio: new Date("2026-11-02T15:00:00Z"), fim: new Date("2026-11-08T15:00:00Z"), parada: false, status: "ACEITA", esperas: [{ de: new Date("2026-11-03T15:00:00Z"), ate: new Date("2026-11-08T15:00:00Z") }] })],
      0,
      NOVEMBRO,
      null,
      AGORA,
    );
    expect(c.noPeriodoDias).toBe(1);
  });

  it("enviada, ainda sem resposta: não está parada e o tempo depois do envio não conta", () => {
    const c = montarCaneta([periodo({ inicio: new Date("2026-11-08T15:00:00Z"), parada: false, status: "ENVIADA", esperas: [{ de: new Date("2026-11-09T15:00:00Z"), ate: null }] })], 0, NOVEMBRO, null, AGORA);
    expect(c.paradas).toBe(0);
    expect(c.maisParadas).toEqual([]);
    expect(c.noPeriodoDias).toBe(1);
  });

  it("aberta em proposta encerrada, com o card em Vendas: não conta em nada", () => {
    const c = montarCaneta([periodo({ parada: false, status: "ACEITA" })], 0, NOVEMBRO, null, AGORA);
    expect(c).toMatchObject({ paradas: 0, noPeriodoDias: 0, porPessoa: [] });
  });

  it("aberta com o card encerrado ou fora de Vendas: conta até lá, e não some nem cresce depois", () => {
    const congelada = periodo({ parada: false, inicio: new Date("2026-11-02T15:00:00Z"), fimDoCard: new Date("2026-11-05T15:00:00Z") });
    expect(montarCaneta([congelada], 0, NOVEMBRO, null, AGORA)).toMatchObject({ paradas: 0, noPeriodoDias: 3 });
    expect(montarCaneta([congelada], 0, NOVEMBRO, null, new Date("2026-11-20T15:00:00Z")).noPeriodoDias).toBe(3);
  });

  it("reenvio: tira a espera de cada envio, não só a do último", () => {
    const c = montarCaneta(
      [
        periodo({
          inicio: new Date("2026-11-01T15:00:00Z"),
          fim: new Date("2026-11-10T15:00:00Z"),
          parada: false,
          esperas: [
            { de: new Date("2026-11-02T15:00:00Z"), ate: new Date("2026-11-04T15:00:00Z") },
            { de: new Date("2026-11-06T15:00:00Z"), ate: new Date("2026-11-09T15:00:00Z") },
          ],
        }),
      ],
      0,
      NOVEMBRO,
      null,
      AGORA,
    );
    expect(c.noPeriodoDias).toBe(4);
  });

  it("última edição: secundária, desde o rascunho, ou desde a chegada se o rascunho é anterior", () => {
    const editou = montarCaneta([periodo({ rascunhoEm: new Date("2026-11-10T15:00:00Z") })], 0, NOVEMBRO, null, AGORA).maisParadas[0];
    expect(editou).toMatchObject({ dias: 2, ultimaEdicaoDias: 1 });
    const antes = montarCaneta([periodo({ rascunhoEm: new Date("2026-10-10T15:00:00Z") })], 0, NOVEMBRO, null, AGORA).maisParadas[0];
    expect(antes).toMatchObject({ dias: 2, ultimaEdicaoDias: 2 });
  });

  it("filtro por pessoa: só as linhas dela", () => {
    const c = montarCaneta([periodo(), periodo({ usuario: BIA, projetoId: "p2" })], 0, NOVEMBRO, "bia", AGORA);
    expect(c.porPessoa.map((l) => l.usuario.id)).toEqual(["bia"]);
    expect(c.paradas).toBe(1);
    expect(c.maisParadas.map((m) => m.projetoId)).toEqual(["p2"]);
    expect(c.pessoas.map((p) => p.id)).toEqual(["ana", "bia"]);
  });

  it("sem dados: tudo zerado, sem quebrar", () => {
    expect(montarCaneta([], 0, NOVEMBRO, null, AGORA)).toEqual({ paradas: 0, mediaDias: null, noPeriodoDias: 0, semDono: 0, pessoas: [], porPessoa: [], maisParadas: [] });
  });
});

describe("esperasDoCliente", () => {
  const d = (dia: string) => new Date(`${dia}T12:00:00Z`);
  const SEM_COLUNA = { enviadaEm: null, respondidaEm: null };

  it("cada envio até a resposta, em qualquer resposta", () => {
    const eventos = [
      { evento: "enviada", em: d("2026-11-01") },
      { evento: "revisao_pedida", em: d("2026-11-03") },
      { evento: "enviada", em: d("2026-11-05") },
      { evento: "recusada", em: d("2026-11-06") },
    ];
    expect(esperasDoCliente(eventos, { enviadaEm: d("2026-11-05"), respondidaEm: d("2026-11-06") })).toEqual([
      { de: d("2026-11-01"), ate: d("2026-11-03") },
      { de: d("2026-11-05"), ate: d("2026-11-06") },
    ]);
  });

  it("envio sem resposta fica aberto", () => {
    expect(esperasDoCliente([{ evento: "enviada", em: d("2026-11-01") }], SEM_COLUNA)).toEqual([{ de: d("2026-11-01"), ate: null }]);
  });

  it("dado sem evento cai nas colunas; sem envio nenhum, vazio", () => {
    expect(esperasDoCliente([], { enviadaEm: d("2026-11-01"), respondidaEm: d("2026-11-02") })).toEqual([{ de: d("2026-11-01"), ate: d("2026-11-02") }]);
    expect(esperasDoCliente([], SEM_COLUNA)).toEqual([]);
  });
});
