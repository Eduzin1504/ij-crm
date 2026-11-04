/**
 * Painel de projetos (GAB-96, spec fase 2 §4.14): "o projeto está andando de acordo com a
 * proposta?". Cálculo PURO; tela e MCP chamam o mesmo serviço (`projetos-servico.ts`), então os
 * números são os mesmos. Dias civis de São Paulo. Os textos das fórmulas estão em `definicoes.ts`.
 *
 * Só o que `projeto_entrega` grava: previsto original, previsto atual e data real. Entrega
 * cancelada não chega aqui (o serviço filtra com `ENTREGA_ATIVA`), nem os ajustes dela.
 */
import type { Area, StatusCheckin, StatusProposta } from "@prisma/client";
import { diaEmFuso } from "@/lib/projetos/aging";
import { semanaCobravel, semanaDe } from "@/lib/projetos/execucao-semana";
import { diasAte } from "@/lib/projetos/proxima-acao";
import { PIPELINE_VENDAS } from "@/lib/projetos/terminal-regras";
import { STATUS_EM_CURSO } from "@/lib/propostas/caneta";
import type { Pessoa } from "./calculo";

const DIA_MS = 86_400_000;
const razao = (a: number, b: number) => (b > 0 ? a / b : null);
const porNome = (a: string, b: string) => a.localeCompare(b, "pt-BR");

export type PeriodoDoPainel = { primeiroDia: string; ultimoDia: string; inicio: Date; fim: Date };

// ---------------------------------------------------------------- execução

export type EntregaAtiva = {
  previstoOriginal: string;
  previstoAtual: string;
  realizado: string | null;
  /** Ajustes de data desta entrega. */
  ajustes: number;
};

export type UltimoCheckin = { status: StatusCheckin; motivo: string; /** Segunda da semana (SP). */ semana: string; em: Date };

export type ProjetoEmExecucao = {
  id: string;
  titulo: string;
  fase: string;
  /** Quem responde pela execução (`gpDoProjeto`). */
  gp: Pessoa;
  entregas: EntregaAtiva[];
  ultimoCheckin: UltimoCheckin | null;
  /** `inicioDoAcompanhamento`: null = nada a cobrar ainda. */
  inicioAcompanhamento: Date | null;
  /** Semanas que o lembrete já cobrou (`lembrete_checkin`). */
  semanasCobradas: number;
};

export type SituacaoProjeto = {
  id: string;
  titulo: string;
  fase: string;
  gp: Pessoa;
  /** Nenhuma entrega ativa: migrado sem cronograma, ou tudo cancelado. */
  semPrevisto: boolean;
  totalEntregas: number;
  feitas: number;
  previstasNoPeriodo: number;
  feitasNoPeriodo: number;
  atrasadas: number;
  atrasoDias: number;
  ajustes: number;
  ultimoCheckin: UltimoCheckin | null;
  semCheckinNaSemana: boolean;
  semanasCobradas: number;
};

/** Dias além do previsto ORIGINAL. Pendente conta até hoje ou até a nova data, o que vier depois: o ajuste não apaga o atraso. */
export function atrasoDaEntrega(e: EntregaAtiva, hoje: string): number {
  const ate = e.realizado ?? (e.previstoAtual > hoje ? e.previstoAtual : hoje);
  return Math.max(0, diasAte(e.previstoOriginal, ate));
}

const noPeriodo = (dia: string, p: PeriodoDoPainel) => dia >= p.primeiroDia && dia <= p.ultimoDia;

export function situacaoDoProjeto(p: ProjetoEmExecucao, periodo: PeriodoDoPainel, agora: Date): SituacaoProjeto {
  const hoje = diaEmFuso(agora);
  const semana = semanaDe(agora);
  const conta = (f: (e: EntregaAtiva) => boolean) => p.entregas.filter(f).length;
  return {
    id: p.id,
    titulo: p.titulo,
    fase: p.fase,
    gp: p.gp,
    semPrevisto: p.entregas.length === 0,
    totalEntregas: p.entregas.length,
    feitas: conta((e) => e.realizado !== null),
    previstasNoPeriodo: conta((e) => noPeriodo(e.previstoOriginal, periodo)),
    feitasNoPeriodo: conta((e) => e.realizado !== null && noPeriodo(e.realizado, periodo)),
    // A mesma conta de `atrasada` em `obterCronograma`.
    atrasadas: conta((e) => e.realizado === null && e.previstoAtual < hoje),
    atrasoDias: p.entregas.reduce((s, e) => s + atrasoDaEntrega(e, hoje), 0),
    ajustes: p.entregas.reduce((s, e) => s + e.ajustes, 0),
    ultimoCheckin: p.ultimoCheckin,
    semCheckinNaSemana: semanaCobravel(p.inicioAcompanhamento, semana) && p.ultimoCheckin?.semana !== semana,
    semanasCobradas: p.semanasCobradas,
  };
}

/** Card em Finalizado ou Perdido, encerrado no período ou com entrega nele. */
export type ProjetoEncerrado = {
  id: string;
  titulo: string;
  fase: string;
  tipo: "FINALIZADO" | "PERDIDO";
  gp: Pessoa;
  encerradoEm: Date;
  entregas: Pick<EntregaAtiva, "previstoOriginal" | "realizado">[];
};

/** Registro: fora de atraso e alertas. Só previstas e feitas entram no total, para o mês passado não mudar quando um card encerra. */
export type SituacaoEncerrado = Omit<ProjetoEncerrado, "entregas"> & {
  semPrevisto: boolean;
  totalEntregas: number;
  feitas: number;
  previstasNoPeriodo: number;
  feitasNoPeriodo: number;
};

export type TotaisExecucao = {
  emExecucao: number;
  semPrevisto: number;
  comAtraso: number;
  /** Com os encerrados: é o que mantém um período passado estável. */
  previstasNoPeriodo: number;
  feitasNoPeriodo: number;
  /** A parte dos encerrados nas duas somas acima. */
  previstasEncerrados: number;
  feitasEncerrados: number;
  atrasadas: number;
  atrasoDias: number;
  vermelhos: number;
  amarelos: number;
  semCheckin: number;
};

export type ExecucaoProjetos = {
  totais: TotaisExecucao;
  /** O mais atrasado primeiro. */
  projetos: SituacaoProjeto[];
  /** Com entrega pendente vencida. */
  atrasados: SituacaoProjeto[];
  alertas: { vermelhos: SituacaoProjeto[]; amarelos: SituacaoProjeto[]; semCheckin: SituacaoProjeto[] };
  encerrados: SituacaoEncerrado[];
  /** Opções do filtro: todos os GPs com projeto em execução. */
  gps: (Pessoa & { projetos: number })[];
};

const GRAVIDADE = (a: SituacaoProjeto, b: SituacaoProjeto) => b.atrasoDias - a.atrasoDias || b.atrasadas - a.atrasadas || porNome(a.titulo, b.titulo);

export function montarExecucao(projetos: readonly ProjetoEmExecucao[], encerrados: readonly ProjetoEncerrado[], periodo: PeriodoDoPainel, gpId: string | null, agora: Date): ExecucaoProjetos {
  const gps = new Map<string, Pessoa & { projetos: number }>();
  for (const p of projetos) {
    const g = gps.get(p.gp.id);
    gps.set(p.gp.id, { ...p.gp, projetos: (g?.projetos ?? 0) + 1 });
  }
  const doFiltro = (p: { gp: Pessoa }) => gpId === null || p.gp.id === gpId;
  const linhas = projetos
    .filter(doFiltro)
    .map((p) => situacaoDoProjeto(p, periodo, agora))
    .sort(GRAVIDADE);
  const soma = (f: (s: SituacaoProjeto) => number) => linhas.reduce((t, s) => t + f(s), 0);
  const comStatus = (status: StatusCheckin) => linhas.filter((s) => s.ultimoCheckin?.status === status);
  const atrasados = linhas.filter((s) => s.atrasadas > 0);
  const alertas = { vermelhos: comStatus("VERMELHO"), amarelos: comStatus("AMARELO"), semCheckin: linhas.filter((s) => s.semCheckinNaSemana) };
  const fechados = encerrados
    .filter(doFiltro)
    .map(({ entregas, ...e }): SituacaoEncerrado => ({
      ...e,
      semPrevisto: entregas.length === 0,
      totalEntregas: entregas.length,
      feitas: entregas.filter((x) => x.realizado !== null).length,
      previstasNoPeriodo: entregas.filter((x) => noPeriodo(x.previstoOriginal, periodo)).length,
      feitasNoPeriodo: entregas.filter((x) => x.realizado !== null && noPeriodo(x.realizado, periodo)).length,
    }))
    .sort((a, b) => b.encerradoEm.getTime() - a.encerradoEm.getTime());
  const previstasEncerrados = fechados.reduce((t, e) => t + e.previstasNoPeriodo, 0);
  const feitasEncerrados = fechados.reduce((t, e) => t + e.feitasNoPeriodo, 0);
  return {
    totais: {
      emExecucao: linhas.length,
      semPrevisto: linhas.filter((s) => s.semPrevisto).length,
      comAtraso: atrasados.length,
      previstasNoPeriodo: soma((s) => s.previstasNoPeriodo) + previstasEncerrados,
      feitasNoPeriodo: soma((s) => s.feitasNoPeriodo) + feitasEncerrados,
      previstasEncerrados,
      feitasEncerrados,
      atrasadas: soma((s) => s.atrasadas),
      atrasoDias: soma((s) => s.atrasoDias),
      vermelhos: alertas.vermelhos.length,
      amarelos: alertas.amarelos.length,
      semCheckin: alertas.semCheckin.length,
    },
    projetos: linhas,
    atrasados,
    alertas,
    encerrados: fechados,
    gps: [...gps.values()].sort((a, b) => porNome(a.nome, b.nome)),
  };
}

// ---------------------------------------------------------------- caneta

export const STATUS_PARADOS: readonly StatusProposta[] = [...STATUS_EM_CURSO, "PRONTA_PARA_ENVIO"];

/**
 * A caneta está parada com alguém que precisa agir? Pingue-pongue em curso ou pronta para envio,
 * com o card aberto em Vendas. Enviada é a vez do cliente; em Projetos a proposta já congelou.
 */
export function propostaParada(p: { status: StatusProposta; quadro: string; faseTerminal: boolean }): boolean {
  return p.quadro === PIPELINE_VENDAS && !p.faseTerminal && STATUS_PARADOS.includes(p.status);
}

/** Um período de `proposta_caneta`. */
export type PeriodoCaneta = {
  projetoId: string;
  titulo: string;
  usuario: Pessoa;
  lado: Area;
  status: StatusProposta;
  inicio: Date;
  fim: Date | null;
  /** `propostaParada`. */
  parada: boolean;
  /** Card encerrado ou fora de Vendas: desde quando (`fase_desde`). A caneta aberta para de contar aí. */
  fimDoCard: Date | null;
  /** Esperas pela resposta do cliente nesta proposta (`esperasDoCliente`): não são tempo parado com a pessoa. */
  esperas: EsperaDoCliente[];
  /** Última gravação do rascunho. */
  rascunhoEm: Date | null;
};

export type EsperaDoCliente = { de: Date; ate: Date | null };

/** Eventos da Timeline que abrem e fecham a espera pelo cliente. */
export const EVENTOS_DE_ENVIO = ["enviada", "revisao_pedida", "aceita", "recusada"] as const;

/**
 * Cada envio até a resposta, pela Timeline (eventos em ordem). Proposta sem o evento (dado anterior a
 * ele) cai nas colunas, que só guardam o último envio.
 */
export function esperasDoCliente(eventos: readonly { evento: string; em: Date }[], colunas: { enviadaEm: Date | null; respondidaEm: Date | null }): EsperaDoCliente[] {
  const esperas: EsperaDoCliente[] = [];
  let aberta: Date | null = null;
  for (const e of eventos) {
    if (e.evento === "enviada") aberta ??= e.em;
    else if (aberta) {
      esperas.push({ de: aberta, ate: e.em });
      aberta = null;
    }
  }
  if (aberta) esperas.push({ de: aberta, ate: null });
  if (esperas.length === 0 && colunas.enviadaEm) return [{ de: colunas.enviadaEm, ate: colunas.respondidaEm }];
  return esperas;
}

export type LinhaCaneta = {
  usuario: Pessoa;
  /** Propostas com a caneta parada com ela agora. */
  paradas: number;
  maiorDias: number | null;
  mediaDias: number | null;
  /** Tempo com a caneta dentro do período. */
  noPeriodoDias: number;
};

export type PropostaParada = {
  projetoId: string;
  titulo: string;
  usuario: Pessoa;
  lado: Area;
  status: StatusProposta;
  /** Desde que a caneta chegou: a métrica principal. */
  dias: number;
  /** Desde a última edição do rascunho, ou desde a chegada, se foi antes dela. */
  ultimaEdicaoDias: number;
};

export type TempoCaneta = {
  paradas: number;
  mediaDias: number | null;
  noPeriodoDias: number;
  /** Em curso sem ninguém com a caneta: o GP do lado precisa pegar. Não acompanha o filtro por pessoa: não há pessoa. */
  semDono: number;
  /** Quem tem linha, sem o filtro: opções do filtro por pessoa. */
  pessoas: Pessoa[];
  /** Quem segura há mais tempo primeiro. */
  porPessoa: LinhaCaneta[];
  /** As `LIMITE_PARADAS` há mais tempo paradas. */
  maisParadas: PropostaParada[];
};

export const LIMITE_PARADAS = 10;

const umaCasa = (ms: number) => Math.round((ms / DIA_MS) * 10) / 10;
const sobreposicao = (a: number, b: number, c: number, d: number) => Math.max(0, Math.min(b, d) - Math.max(a, c));

/** Tempo do período de caneta dentro do intervalo do painel, sem a espera pelo cliente. */
function msNoPeriodo(p: PeriodoCaneta, intervalo: PeriodoDoPainel, agora: Date): number {
  // Aberto: até o card encerrar ou sair de Vendas; senão até agora, se está parado ou com o cliente (a espera sai abaixo).
  const fim = p.fim ?? p.fimDoCard ?? (p.parada || p.status === "ENVIADA" ? agora : null);
  if (!fim) return 0;
  const de = intervalo.inicio.getTime();
  const ate = Math.min(intervalo.fim.getTime(), agora.getTime());
  const total = sobreposicao(p.inicio.getTime(), fim.getTime(), de, ate);
  const espera = p.esperas.reduce((s, e) => s + sobreposicao(Math.max(p.inicio.getTime(), e.de.getTime()), Math.min(fim.getTime(), (e.ate ?? agora).getTime()), de, ate), 0);
  return Math.max(0, total - espera);
}

export function montarCaneta(periodos: readonly PeriodoCaneta[], semDono: number, intervalo: PeriodoDoPainel, pessoaId: string | null, agora: Date): TempoCaneta {
  const temLinha = (p: PeriodoCaneta) => (p.fim === null && p.parada) || msNoPeriodo(p, intervalo, agora) > 0;
  const comLinha = new Map(periodos.filter(temLinha).map((p) => [p.usuario.id, p.usuario]));
  const doFiltro = periodos.filter((p) => pessoaId === null || p.usuario.id === pessoaId);
  const paradas = doFiltro.filter((p) => p.fim === null && p.parada).map((p) => ({ p, ms: Math.max(0, agora.getTime() - p.inicio.getTime()) }));
  const noPeriodo = new Map<string, { usuario: Pessoa; ms: number }>();
  for (const p of doFiltro) {
    const ms = msNoPeriodo(p, intervalo, agora);
    if (ms > 0) noPeriodo.set(p.usuario.id, { usuario: p.usuario, ms: (noPeriodo.get(p.usuario.id)?.ms ?? 0) + ms });
  }
  const paradasPorId = Map.groupBy(paradas, (x) => x.p.usuario.id);
  const pessoas = new Map([...paradas.map((x) => [x.p.usuario.id, x.p.usuario] as const), ...[...noPeriodo.values()].map((n) => [n.usuario.id, n.usuario] as const)]);
  const media = (ms: readonly number[]) => {
    const r = razao(
      ms.reduce((s, m) => s + m, 0),
      ms.length,
    );
    return r === null ? null : umaCasa(r);
  };
  const porPessoa = [...pessoas.values()]
    .map((usuario): LinhaCaneta => {
      const ms = (paradasPorId.get(usuario.id) ?? []).map((x) => x.ms);
      return { usuario, paradas: ms.length, maiorDias: ms.length ? umaCasa(Math.max(...ms)) : null, mediaDias: media(ms), noPeriodoDias: umaCasa(noPeriodo.get(usuario.id)?.ms ?? 0) };
    })
    .sort((a, b) => (b.maiorDias ?? -1) - (a.maiorDias ?? -1) || b.noPeriodoDias - a.noPeriodoDias || porNome(a.usuario.nome, b.usuario.nome));
  return {
    paradas: paradas.length,
    mediaDias: media(paradas.map((x) => x.ms)),
    noPeriodoDias: umaCasa([...noPeriodo.values()].reduce((s, n) => s + n.ms, 0)),
    semDono,
    pessoas: [...comLinha.values()].sort((a, b) => porNome(a.nome, b.nome)),
    porPessoa,
    maisParadas: [...paradas]
      .sort((a, b) => b.ms - a.ms)
      .slice(0, LIMITE_PARADAS)
      .map(({ p, ms }) => ({
        projetoId: p.projetoId,
        titulo: p.titulo,
        usuario: p.usuario,
        lado: p.lado,
        status: p.status,
        dias: umaCasa(ms),
        ultimaEdicaoDias: umaCasa(Math.max(0, agora.getTime() - Math.max(p.inicio.getTime(), p.rascunhoEm?.getTime() ?? 0))),
      })),
  };
}
