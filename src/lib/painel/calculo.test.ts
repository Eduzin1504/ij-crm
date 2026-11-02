import { describe, expect, it } from "vitest";
import type { Ganho, Perda } from "@/lib/ranking/calculo";
import { resolverPeriodo } from "@/lib/ranking/periodo";
import { diasSemContato, LIMITE_PARADOS, montarAcompanhamento, montarConversao, montarEngajamento, montarSatisfacao, type CardAberto, type LinhaFluxo, type Pessoa } from "./calculo";
import { SEM_DADOS_PROPOSTA } from "./proposta";

const sp = (iso: string) => new Date(`${iso}-03:00`);
const MES = resolverPeriodo("mes", "2026-10-15", sp("2026-11-01T12:00:00")); // outubro/2026

const ana: Pessoa = { id: "ana", nome: "Ana", ativo: true };
const bia: Pessoa = { id: "bia", nome: "Bia", ativo: true };
const ivo: Pessoa = { id: "ivo", nome: "Ivo", ativo: false };
const PESSOAS = new Map([ana, bia, ivo].map((p) => [p.id, p]));
const PARTICIPANTES = ["ana", "bia"];

const ganho = (id: string, dono: string, em: Date, valor: number | null, origem: Ganho["origem"] = "UI"): Ganho => ({
  projetoId: id,
  titulo: id,
  responsavelId: dono,
  dataGanho: em,
  valorFechado: valor,
  criadoEm: sp("2026-09-01T10:00:00"),
  origem,
});
const perda = (id: string, dono: string, em: Date, origem: Perda["origem"] = "UI"): Perda => ({ projetoId: id, responsavelId: dono, em, origem });

const fluxo = (f: { id: string; nome: string; ordem: number }, dono: string, tipo: LinhaFluxo["tipo"], n: Partial<LinhaFluxo>): LinhaFluxo => ({
  tipo,
  faseId: f.id,
  faseNome: f.nome,
  faseOrdem: f.ordem,
  donoId: dono,
  entradas: 0,
  avancos: 0,
  perdas: 0,
  recuos: 0,
  somaDias: 0,
  estadias: 0,
  ...n,
});

const CONTATO = { id: "f1", nome: "Primeiro contato", ordem: 0 };
const REUNIAO = { id: "f2", nome: "Reunião", ordem: 1 };
const ARQUIVADA = { id: "f9", nome: "Antiga", ordem: 5 };

describe("montarConversao", () => {
  const fechamentos = {
    ganhos: [
      ganho("g1", "ana", sp("2026-10-05T10:00:00"), 10_000),
      ganho("g2", "ana", sp("2026-10-20T10:00:00"), null),
      ganho("g3", "bia", sp("2026-10-31T23:59:00"), 5_000),
      ganho("g4", "bia", sp("2026-11-01T00:00:00"), 7_000), // novembro: fora
      ganho("g5", "bia", sp("2026-10-10T10:00:00"), 9_000, "IMPORT"), // importado do Pipefy: não conta
    ],
    perdas: [perda("p1", "ana", sp("2026-10-07T10:00:00")), perda("p2", "bia", sp("2026-10-08T10:00:00"), "SISTEMA"), perda("p3", "bia", sp("2026-10-09T10:00:00"))],
  };
  const linhas: LinhaFluxo[] = [
    fluxo(CONTATO, "ana", "ENTRADA", { entradas: 4 }),
    fluxo(CONTATO, "ana", "SAIDA", { avancos: 2, perdas: 1, recuos: 0, somaDias: 6, estadias: 3 }),
    fluxo(CONTATO, "bia", "SAIDA", { avancos: 1, perdas: 0, recuos: 1, somaDias: 4, estadias: 1 }),
    fluxo(ARQUIVADA, "bia", "SAIDA", { avancos: 1, somaDias: 1, estadias: 1 }),
  ];

  it("ganhos, perdidos, conversão e R$ fechado com as regras do ranking (só gente, no período)", () => {
    const c = montarConversao([CONTATO, REUNIAO], linhas, fechamentos, MES, null);
    expect(c).toMatchObject({ ganhos: 3, perdidos: 2, conversao: 3 / 5, valorFechado: 15_000 });
  });

  it("por fase: entradas, avanço/perda/recuo, conversão = avanços ÷ (avanços + perdas), tempo médio", () => {
    const c = montarConversao([CONTATO, REUNIAO], linhas, fechamentos, MES, null);
    expect(c.fases).toEqual([
      { faseId: "f1", nome: "Primeiro contato", entradas: 4, avancos: 3, perdas: 1, recuos: 1, conversao: 3 / 4, tempoMedioDias: 10 / 4 },
      { faseId: "f2", nome: "Reunião", entradas: 0, avancos: 0, perdas: 0, recuos: 0, conversao: null, tempoMedioDias: null },
      // Arquivada só aparece porque teve movimento.
      { faseId: "f9", nome: "Antiga", entradas: 0, avancos: 1, perdas: 0, recuos: 0, conversao: 1, tempoMedioDias: 1 },
    ]);
  });

  it("filtro por vendedor olha só os cards/fechamentos dele", () => {
    const c = montarConversao([CONTATO, REUNIAO], linhas, fechamentos, MES, "bia");
    expect(c).toMatchObject({ ganhos: 1, perdidos: 1, conversao: 0.5, valorFechado: 5_000 });
    expect(c.fases[0]).toMatchObject({ entradas: 0, avancos: 1, perdas: 0, recuos: 1, conversao: 1, tempoMedioDias: 4 });
  });

  it("valor em proposta e versões até fechar: sem dados até a Proposta (GAB-86)", () => {
    const c = montarConversao([], [], { ganhos: [], perdas: [] }, MES, null);
    expect(c).toMatchObject({ ganhos: 0, perdidos: 0, conversao: null, valorFechado: 0, fases: [] });
    expect(c.valorEmProposta).toEqual(SEM_DADOS_PROPOSTA);
    expect(c.versoesAteFechar).toEqual({ disponivel: false, motivo: expect.stringContaining("GAB-86") });
  });
});

describe("montarEngajamento", () => {
  const linhas = [
    { usuarioId: "ana", whatsapp: 5, tela: 3, mcp: 1, acoesFeitas: 3, acoesComPrazo: 2, acoesNoPrazo: 1 },
    { usuarioId: "ivo", whatsapp: 2, tela: 0, mcp: 0, acoesFeitas: 0, acoesComPrazo: 0, acoesNoPrazo: 0 },
  ];

  it("por vendedor (participantes mesmo zerados + quem tem dado) e total do time", () => {
    const e = montarEngajamento(linhas, PESSOAS, PARTICIPANTES, null);
    expect(e.porVendedor.map((l) => [l.usuario.id, l.interacoes, l.taxaNoPrazo])).toEqual([
      ["ana", 9, 0.5],
      ["bia", 0, null],
      ["ivo", 2, null],
    ]);
    expect(e.time).toEqual({ whatsapp: 7, tela: 3, mcp: 1, interacoes: 11, acoesFeitas: 3, acoesComPrazo: 2, acoesNoPrazo: 1, taxaNoPrazo: 0.5 });
  });

  it("filtro por vendedor", () => {
    const e = montarEngajamento(linhas, PESSOAS, PARTICIPANTES, "bia");
    expect(e.porVendedor.map((l) => l.usuario.id)).toEqual(["bia"]);
    expect(e.time.interacoes).toBe(0);
  });
});

describe("montarAcompanhamento", () => {
  const agora = sp("2026-11-01T15:00:00");
  const card = (id: string, resp: string, prox: Date | null, contato: Date | null, criado = sp("2026-10-01T10:00:00")): CardAberto => ({
    id,
    titulo: `Card ${id}`,
    responsavelId: resp,
    faseNome: "Reunião",
    proximaAcaoEm: prox,
    criadoEm: criado,
    ultimoContatoEm: contato,
  });
  const cards = [
    card("a", "ana", null, sp("2026-10-30T10:00:00")), // sem próxima ação; 2 dias
    card("b", "ana", sp("2026-10-31T00:00:00"), sp("2026-10-22T10:00:00")), // vencida (ontem); 10 dias
    card("c", "ana", sp("2026-11-01T00:00:00"), sp("2026-11-01T09:00:00")), // hoje: não vence; 0 dia
    card("d", "bia", sp("2026-11-05T00:00:00"), null), // sem contato: desde a criação (31 dias)
  ];

  it("dias sem contato: do último contato, ou da criação sem nenhum", () => {
    expect(diasSemContato(cards[1], agora)).toBe(10);
    expect(diasSemContato(cards[3], agora)).toBe(31);
  });

  it("sem próxima ação, vencidas, média de dias sem contato e mais parados", () => {
    const a = montarAcompanhamento(cards, PESSOAS, PARTICIPANTES, null, agora);
    expect(a).toMatchObject({ abertos: 4, semProximaAcao: 1, vencidas: 1, mediaDiasSemContato: (2 + 10 + 0 + 31) / 4, semContatoRegistrado: 1 });
    expect(a.porResponsavel.map((l) => [l.usuario.id, l.abertos, l.semProximaAcao, l.vencidas, l.mediaDiasSemContato])).toEqual([
      ["ana", 3, 1, 1, 4],
      ["bia", 1, 0, 0, 31],
    ]);
    expect(a.maisParados.map((c) => [c.id, c.diasSemContato, c.responsavel?.nome])).toEqual([
      ["d", 31, "Bia"],
      ["b", 10, "Ana"],
      ["a", 2, "Ana"],
      ["c", 0, "Ana"],
    ]);
  });

  it("paradosDe (ranking oculto): a lista sai dos cards da pessoa ANTES do corte de 10", () => {
    const daAna = Array.from({ length: LIMITE_PARADOS + 1 }, (_, i) => card(`ana${i}`, "ana", null, null, sp("2026-01-01T10:00:00")));
    const daBia = card("bia1", "bia", null, sp("2026-10-31T10:00:00"));
    const a = montarAcompanhamento([...daAna, daBia], PESSOAS, PARTICIPANTES, null, agora, { paradosDe: "bia" });
    expect(a.maisParados.map((c) => c.id)).toEqual(["bia1"]);
    expect(a.abertos).toBe(LIMITE_PARADOS + 2); // totais continuam do time
  });

  it("filtro por responsável e limite da lista de parados", () => {
    const muitos = Array.from({ length: LIMITE_PARADOS + 3 }, (_, i) => card(`x${i}`, "bia", null, null));
    const a = montarAcompanhamento([...cards, ...muitos], PESSOAS, PARTICIPANTES, "bia", agora);
    expect(a.abertos).toBe(LIMITE_PARADOS + 4);
    expect(a.porResponsavel.map((l) => l.usuario.id)).toEqual(["bia"]);
    expect(a.maisParados).toHaveLength(LIMITE_PARADOS);
  });
});

describe("montarSatisfacao", () => {
  const avaliacoes = [
    { vendedorId: "ana", notas: 2, notaMedia: 4.5, positivos: 1, neutros: 0, negativos: 0 },
    { vendedorId: "bia", notas: 1, notaMedia: 3, positivos: 0, neutros: 1, negativos: 2 },
  ];

  it("média ponderada pelo nº de notas e distribuição do sentimento", () => {
    const s = montarSatisfacao(avaliacoes, PESSOAS, PARTICIPANTES, null);
    expect(s.time).toEqual({ notas: 3, notaMedia: 4, positivos: 1, neutros: 1, negativos: 2 });
    expect(s.porVendedor.map((l) => [l.usuario.id, l.notaMedia])).toEqual([
      ["ana", 4.5],
      ["bia", 3],
    ]);
  });

  it("sem notas: média null; filtro por vendedor", () => {
    expect(montarSatisfacao([], PESSOAS, PARTICIPANTES, null).time.notaMedia).toBeNull();
    expect(montarSatisfacao(avaliacoes, PESSOAS, PARTICIPANTES, "ana").time).toEqual({ notas: 2, notaMedia: 4.5, positivos: 1, neutros: 0, negativos: 0 });
  });
});
