/**
 * Painel de vendas (GAB-94, spec fase 2 §4.14) — cálculo PURO sobre as linhas
 * já agregadas em SQL (`servico.ts`). Cada indicador é uma função; tela e MCP
 * chamam as mesmas, então os números são os mesmos.
 *
 * Definições (período = semana ou mês civil de São Paulo, [inicio, fim)):
 *
 * ESTAMOS CONVERTENDO?
 * - Ganhos, perdidos, conversão (ganhos ÷ (ganhos + perdidos)) e R$ fechado:
 *   as MESMAS regras do ranking (GAB-44) — ganho pela `data_ganho`, perda pela
 *   entrada no Perdido, só movimentos de gente (UI/WhatsApp; SISTEMA e IMPORT
 *   ficam de fora), ganho do vendedor que vendeu, perda do responsável.
 * - Por fase (fases abertas de Vendas): `entradas` = cards distintos que
 *   entraram na fase no período (criação conta); `saídas` = transições que
 *   SAÍRAM da fase no período, classificadas em avanço (fase de ordem maior,
 *   Ganho ou quadro Projetos), perda (Perdido) ou recuo (fase de ordem menor ou
 *   igual). Conversão da fase = avanços ÷ (avanços + perdas); recuo não fecha a
 *   passagem. Tempo médio na fase = média de (saída − entrada imediatamente
 *   anterior na mesma fase) das saídas do período. Só saídas/entradas por
 *   gente; a entrada que abre a estadia pode ser de qualquer origem (inclusive
 *   IMPORT do Pipefy, que tem a data real da fase).
 * - Valor em proposta e versões até fechar: dependem da Proposta (GAB-86),
 *   ainda inexistente — `SEM_DADOS_PROPOSTA` (ver `proposta.ts`).
 *
 * O TIME ESTÁ ENGAJADO? (por quem registrou)
 * - Interações = entradas da Timeline no período enquanto o card estava em
 *   Vendas: `MENSAGEM_WHATSAPP` (mensagem `#crm`; conta para quem MANDOU) e
 *   `NOTA` (tela ou MCP, separadas por `via_mcp`).
 * - Próximas ações feitas = NOTA de "Marcar feita". No prazo = feita até o dia
 *   (SP) marcado para ela. Taxa = no prazo ÷ feitas com data.
 *
 * OS LEADS ESTÃO SENDO ACOMPANHADOS? (situação de AGORA, não do período)
 * - Cards abertos em Vendas por responsável: sem próxima ação (sem data),
 *   próxima ação vencida (dia de SP antes de hoje) e dias desde o último
 *   contato (última NOTA/MENSAGEM_WHATSAPP; sem nenhuma, desde a criação).
 *
 * OS LEADS GOSTARAM DO CONTATO? `avaliacoesPorVendedor` (GAB-85): média das
 * notas 1–5 (ponderada pelo nº de notas) e contagem de sentimentos.
 *
 * Filtro por vendedor: cada indicador olha só as linhas daquela pessoa (dono
 * do card na conversão; quem registrou no engajamento; responsável no
 * acompanhamento; vendedor da avaliação).
 */
import type { AvaliacaoVendedor } from "@/lib/projetos/avaliacao-consulta";
import { faixaProximaAcao } from "@/lib/projetos/proxima-acao";
import { ORIGENS_QUE_PONTUAM, type Ganho, type Intervalo, type Perda } from "@/lib/ranking/calculo";
import { dentroDoPeriodo } from "@/lib/ranking/periodo";
import { SEM_DADOS_PROPOSTA, type IndicadorProposta } from "./proposta";

export type Pessoa = { id: string; nome: string; ativo: boolean };

const DIA_MS = 86_400_000;
const razao = (a: number, b: number) => (b > 0 ? a / b : null);
const doVendedor = (vendedorId: string | null) => (id: string | null) => vendedorId === null || id === vendedorId;

/** Linhas da tabela: participantes (mesmo com zero) + quem aparece nos dados, por nome. */
function linhasPorPessoa<T>(
  pessoas: Map<string, Pessoa>,
  participantes: readonly string[],
  comDados: Iterable<string>,
  vendedorId: string | null,
  montar: (p: Pessoa) => T,
): (T & { usuario: Pessoa })[] {
  const ids = new Set([...participantes, ...comDados]);
  return [...ids]
    .filter((id) => vendedorId === null || id === vendedorId)
    .flatMap((id) => {
      const p = pessoas.get(id);
      return p ? [{ ...montar(p), usuario: p }] : [];
    })
    .sort((a, b) => a.usuario.nome.localeCompare(b.usuario.nome, "pt-BR"));
}

// ---------------------------------------------------------------- conversão

/** Linha do SQL de fluxo: uma por (fase, dono do card, tipo). */
export type LinhaFluxo = {
  tipo: "ENTRADA" | "SAIDA";
  faseId: string;
  faseNome: string;
  faseOrdem: number;
  donoId: string | null;
  entradas: number;
  avancos: number;
  perdas: number;
  recuos: number;
  /** Soma das estadias (em dias) que terminaram no período, e quantas são. */
  somaDias: number;
  estadias: number;
};

export type FaseVendas = { id: string; nome: string; ordem: number };

export type ConversaoFase = {
  faseId: string;
  nome: string;
  entradas: number;
  avancos: number;
  perdas: number;
  recuos: number;
  /** avanços ÷ (avanços + perdas); null sem nenhum dos dois. */
  conversao: number | null;
  tempoMedioDias: number | null;
};

export type Conversao = {
  ganhos: number;
  perdidos: number;
  /** ganhos ÷ (ganhos + perdidos); null sem fechados. */
  conversao: number | null;
  valorFechado: number;
  fases: ConversaoFase[];
  valorEmProposta: IndicadorProposta;
  versoesAteFechar: IndicadorProposta;
};

/**
 * `fases`: as fases abertas ATIVAS de Vendas, em ordem (aparecem mesmo zeradas);
 * fase arquivada só aparece se tiver movimento no período.
 */
export function montarConversao(
  fases: readonly FaseVendas[],
  fluxo: readonly LinhaFluxo[],
  fechamentos: { ganhos: readonly Ganho[]; perdas: readonly Perda[] },
  periodo: Intervalo,
  vendedorId: string | null,
): Conversao {
  const filtro = doVendedor(vendedorId);
  const porGente = (o: Ganho["origem"]) => o !== null && ORIGENS_QUE_PONTUAM.has(o);
  const ganhos = fechamentos.ganhos.filter((g) => porGente(g.origem) && dentroDoPeriodo(g.dataGanho, periodo) && filtro(g.responsavelId));
  const perdidos = fechamentos.perdas.filter((p) => porGente(p.origem) && dentroDoPeriodo(p.em, periodo) && filtro(p.responsavelId)).length;

  const acc = new Map<string, FaseVendas & { entradas: number; avancos: number; perdas: number; recuos: number; somaDias: number; estadias: number }>();
  const zero = (f: FaseVendas) => ({ ...f, entradas: 0, avancos: 0, perdas: 0, recuos: 0, somaDias: 0, estadias: 0 });
  for (const f of fases) acc.set(f.id, zero(f));
  for (const l of fluxo) {
    if (!filtro(l.donoId)) continue;
    let a = acc.get(l.faseId);
    if (!a) acc.set(l.faseId, (a = zero({ id: l.faseId, nome: l.faseNome, ordem: l.faseOrdem })));
    a.entradas += l.entradas;
    a.avancos += l.avancos;
    a.perdas += l.perdas;
    a.recuos += l.recuos;
    a.somaDias += l.somaDias;
    a.estadias += l.estadias;
  }
  const ativas = new Set(fases.map((f) => f.id));
  const linhas = [...acc.values()]
    .filter((a) => ativas.has(a.id) || a.entradas + a.avancos + a.perdas + a.recuos > 0)
    .sort((x, y) => x.ordem - y.ordem || x.nome.localeCompare(y.nome, "pt-BR"));

  return {
    ganhos: ganhos.length,
    perdidos,
    conversao: razao(ganhos.length, ganhos.length + perdidos),
    valorFechado: ganhos.reduce((s, g) => s + (g.valorFechado ?? 0), 0),
    fases: linhas.map((a) => ({
      faseId: a.id,
      nome: a.nome,
      entradas: a.entradas,
      avancos: a.avancos,
      perdas: a.perdas,
      recuos: a.recuos,
      conversao: razao(a.avancos, a.avancos + a.perdas),
      tempoMedioDias: razao(a.somaDias, a.estadias),
    })),
    valorEmProposta: SEM_DADOS_PROPOSTA,
    versoesAteFechar: SEM_DADOS_PROPOSTA,
  };
}

// ---------------------------------------------------------------- engajamento

/** Linha do SQL de interações: uma por quem registrou. */
export type LinhaInteracoes = {
  usuarioId: string;
  whatsapp: number;
  tela: number;
  mcp: number;
  acoesFeitas: number;
  /** Feitas que tinham dia marcado; destas, quantas até esse dia (SP). */
  acoesComPrazo: number;
  acoesNoPrazo: number;
};

export type MetricasEngajamento = Omit<LinhaInteracoes, "usuarioId"> & {
  interacoes: number;
  /** acoesNoPrazo ÷ acoesComPrazo; null sem ações com data. */
  taxaNoPrazo: number | null;
};

export type Engajamento = { porVendedor: (MetricasEngajamento & { usuario: Pessoa })[]; time: MetricasEngajamento };

function metricasEngajamento(ls: readonly LinhaInteracoes[]): MetricasEngajamento {
  const soma = (k: keyof Omit<LinhaInteracoes, "usuarioId">) => ls.reduce((s, l) => s + l[k], 0);
  const m = { whatsapp: soma("whatsapp"), tela: soma("tela"), mcp: soma("mcp"), acoesFeitas: soma("acoesFeitas"), acoesComPrazo: soma("acoesComPrazo"), acoesNoPrazo: soma("acoesNoPrazo") };
  return { ...m, interacoes: m.whatsapp + m.tela + m.mcp, taxaNoPrazo: razao(m.acoesNoPrazo, m.acoesComPrazo) };
}

export function montarEngajamento(linhas: readonly LinhaInteracoes[], pessoas: Map<string, Pessoa>, participantes: readonly string[], vendedorId: string | null): Engajamento {
  const filtro = doVendedor(vendedorId);
  const doFiltro = linhas.filter((l) => filtro(l.usuarioId));
  const porId = new Map(doFiltro.map((l) => [l.usuarioId, l]));
  return {
    porVendedor: linhasPorPessoa(pessoas, participantes, porId.keys(), vendedorId, (p) => metricasEngajamento(porId.has(p.id) ? [porId.get(p.id)!] : [])),
    time: metricasEngajamento(doFiltro),
  };
}

// ---------------------------------------------------------------- acompanhamento

/** Card aberto em Vendas agora. */
export type CardAberto = {
  id: string;
  titulo: string;
  responsavelId: string;
  faseNome: string;
  proximaAcaoEm: Date | null;
  criadoEm: Date;
  /** Última NOTA/MENSAGEM_WHATSAPP do card; null = nenhuma. */
  ultimoContatoEm: Date | null;
};

export type MetricasAcompanhamento = {
  abertos: number;
  semProximaAcao: number;
  vencidas: number;
  /** Média de dias desde o último contato (ou desde a criação, sem contato); null sem cards. */
  mediaDiasSemContato: number | null;
  /** Cards sem nenhuma interação registrada. */
  semContatoRegistrado: number;
};

export type CardParado = { id: string; titulo: string; responsavel: Pessoa | null; fase: string; diasSemContato: number; ultimoContatoEm: Date | null };

export type Acompanhamento = MetricasAcompanhamento & {
  porResponsavel: (MetricasAcompanhamento & { usuario: Pessoa })[];
  /** Os `LIMITE_PARADOS` cards há mais tempo sem contato. */
  maisParados: CardParado[];
};

export const LIMITE_PARADOS = 10;

export function diasSemContato(c: Pick<CardAberto, "ultimoContatoEm" | "criadoEm">, agora: Date): number {
  const desde = c.ultimoContatoEm ?? c.criadoEm;
  return Math.max(0, Math.floor((agora.getTime() - desde.getTime()) / DIA_MS));
}

function metricasAcompanhamento(cs: readonly CardAberto[], agora: Date): MetricasAcompanhamento {
  const faixas = cs.map((c) => faixaProximaAcao(c.proximaAcaoEm, agora));
  return {
    abertos: cs.length,
    semProximaAcao: faixas.filter((f) => f === "sem").length,
    vencidas: faixas.filter((f) => f === "vencida").length,
    mediaDiasSemContato: razao(
      cs.reduce((s, c) => s + diasSemContato(c, agora), 0),
      cs.length,
    ),
    semContatoRegistrado: cs.filter((c) => c.ultimoContatoEm === null).length,
  };
}

export function montarAcompanhamento(cards: readonly CardAberto[], pessoas: Map<string, Pessoa>, participantes: readonly string[], vendedorId: string | null, agora: Date): Acompanhamento {
  const filtro = doVendedor(vendedorId);
  const doFiltro = cards.filter((c) => filtro(c.responsavelId));
  const porResp = Map.groupBy(doFiltro, (c) => c.responsavelId);
  const maisParados = doFiltro
    .map((c) => ({ c, dias: diasSemContato(c, agora) }))
    .sort((a, b) => b.dias - a.dias || a.c.titulo.localeCompare(b.c.titulo, "pt-BR"))
    .slice(0, LIMITE_PARADOS)
    .map(({ c, dias }) => ({ id: c.id, titulo: c.titulo, responsavel: pessoas.get(c.responsavelId) ?? null, fase: c.faseNome, diasSemContato: dias, ultimoContatoEm: c.ultimoContatoEm }));
  return {
    ...metricasAcompanhamento(doFiltro, agora),
    porResponsavel: linhasPorPessoa(pessoas, participantes, porResp.keys(), vendedorId, (p) => metricasAcompanhamento(porResp.get(p.id) ?? [], agora)),
    maisParados,
  };
}

// ---------------------------------------------------------------- satisfação

export type MetricasSatisfacao = Omit<AvaliacaoVendedor, "vendedorId">;

export type Satisfacao = { porVendedor: (MetricasSatisfacao & { usuario: Pessoa })[]; time: MetricasSatisfacao };

function metricasSatisfacao(ls: readonly AvaliacaoVendedor[]): MetricasSatisfacao {
  const notas = ls.reduce((s, l) => s + l.notas, 0);
  const somaNotas = ls.reduce((s, l) => s + (l.notaMedia ?? 0) * l.notas, 0);
  return {
    notas,
    notaMedia: razao(somaNotas, notas),
    positivos: ls.reduce((s, l) => s + l.positivos, 0),
    neutros: ls.reduce((s, l) => s + l.neutros, 0),
    negativos: ls.reduce((s, l) => s + l.negativos, 0),
  };
}

export function montarSatisfacao(avaliacoes: readonly AvaliacaoVendedor[], pessoas: Map<string, Pessoa>, participantes: readonly string[], vendedorId: string | null): Satisfacao {
  const filtro = doVendedor(vendedorId);
  const doFiltro = avaliacoes.filter((a) => filtro(a.vendedorId));
  const porId = new Map(doFiltro.map((a) => [a.vendedorId, a]));
  return {
    porVendedor: linhasPorPessoa(pessoas, participantes, porId.keys(), vendedorId, (p) => metricasSatisfacao(porId.has(p.id) ? [porId.get(p.id)!] : [])),
    time: metricasSatisfacao(doFiltro),
  };
}
