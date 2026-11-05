/**
 * Serviço da execução do Projeto (GAB-95, spec fase 2 §4.10/§4.12): a porta única
 * da tela e do MCP. Cronograma previsto × realizado e check-in semanal, sem horas.
 * A cópia da proposta está em `execucao-entrada.ts`; as regras puras, em `execucao-regras.ts`.
 *
 * Permissão: `recusaDeExecucao` é o ponto único, com a pessoa RELIDA do banco.
 *
 * Só opera com o card em Execução ou subfase depois dela. Em Handoff, Finalizado e
 * Perdido o cronograma é registro: fica de pé e não muda. Toda escrita trava a linha do
 * card (FOR UPDATE) e relê a fase, como o handoff; o movimento segura a mesma linha.
 *
 * `previsto_original` nunca muda (também há trigger no banco). Ajuste muda `previsto_atual`
 * e deixa linha em `entrega_ajuste`. O texto de quem fez o quê vai para a Timeline,
 * visível a todos, como todo o resto do card.
 *
 * O painel (GAB-96) lê direto de `projeto_entrega` e `projeto_checkin`: colunas DATE e índices.
 * Entrega cancelada fica na tabela: filtre com `ENTREGA_ATIVA`.
 *
 * `obterCronograma` traz os dados da proposta (valor, versão, o que dá para copiar). Quem chama e não
 * vê a proposta (`podeVerPropostaDoProjeto`) passa por `cronogramaSemProposta`.
 */
import type { OrigemEntrega, Papel, Prisma, StatusCheckin } from "@prisma/client";
import { db } from "@/lib/db";
import { diaValido, ENTREGAS_MAX, TITULO_ENTREGA_MAX } from "@/lib/propostas/estruturado";
import { diaEmFuso } from "./aging";
import { MENSAGEM_ERRO_PROJETO } from "./erros";
import { copiarDaPropostaFinal, entregasDaPropostaFinal, IMPEDE_COPIA, separarCopiaveis } from "./execucao-entrada";
import { diaNoIntervalo, gpDoProjeto, lerMotivo, MOTIVO_MAX, podeOperarExecucao } from "./execucao-regras";
import { colunaParaDia, diaParaColuna, semanaDe } from "./execucao-semana";
import { lerDinheiro, PIPELINE_PROJETOS } from "./terminal-regras";
import { faseDeExecucaoAberta, faseExecucao } from "./trava-handoff";

type Tx = Prisma.TransactionClient;
type Ator = { id: string; papel: Papel };

export type ErroExecucao =
  | "SEM_PERMISSAO"
  | "CARD_NAO_ENCONTRADO"
  | "FORA_DA_EXECUCAO"
  | "ENTREGA_NAO_ENCONTRADA"
  | "ENTREGA_JA_FEITA"
  | "ENTREGA_CANCELADA"
  | "ENTREGA_INVALIDA"
  | "VALOR_INVALIDO"
  | "DIA_INVALIDO"
  | "DIA_NO_FUTURO"
  | "MOTIVO_INVALIDO"
  | "LIMITE_DE_ENTREGAS"
  | "CRONOGRAMA_JA_EXISTE"
  | "PROPOSTA_SEM_CRONOGRAMA";

export const MENSAGEM_ERRO_EXECUCAO: Record<ErroExecucao, string> = {
  SEM_PERMISSAO: "Só o GP do projeto opera o cronograma e o check-in, com o gestor de projetos e o admin como apoio.",
  CARD_NAO_ENCONTRADO: MENSAGEM_ERRO_PROJETO.CARD_NAO_ENCONTRADO,
  FORA_DA_EXECUCAO: "O cronograma e o check-in só mudam com o projeto em Execução. Fora dela ficam como registro.",
  ENTREGA_NAO_ENCONTRADA: "Entrega não encontrada neste projeto.",
  ENTREGA_JA_FEITA: "Essa entrega já está feita. Desmarque antes de ajustar a data prevista ou cancelar.",
  ENTREGA_CANCELADA: "Essa entrega foi cancelada: não muda mais. Se ela voltou ao combinado, lance outra.",
  ENTREGA_INVALIDA: `Dê um nome à entrega (até ${TITULO_ENTREGA_MAX} caracteres).`,
  VALOR_INVALIDO: "Valor inválido: use reais no formato 12.500,00.",
  DIA_INVALIDO: "Data inválida: use AAAA-MM-DD.",
  DIA_NO_FUTURO: "A data real da entrega não pode estar no futuro.",
  MOTIVO_INVALIDO: `Escreva o motivo em uma linha, com até ${MOTIVO_MAX} caracteres.`,
  LIMITE_DE_ENTREGAS: `O cronograma pode ter até ${ENTREGAS_MAX} entregas.`,
  CRONOGRAMA_JA_EXISTE: "Este projeto já tem cronograma: a proposta não é copiada de novo.",
  PROPOSTA_SEM_CRONOGRAMA: "Não há proposta aceita com cronograma de entregas para copiar. Lance as entregas à mão.",
};

export type ResultadoExecucao<T = object> = ({ ok: true } & T) | { ok: false; erro: ErroExecucao };

class Falha extends Error {
  constructor(readonly erro: ErroExecucao) {
    super(erro);
  }
}

async function emTransacao<T>(corpo: (tx: Tx) => Promise<T>): Promise<T | { ok: false; erro: ErroExecucao }> {
  try {
    return await db.$transaction(corpo);
  } catch (e) {
    if (e instanceof Falha) return { ok: false, erro: e.erro };
    throw e;
  }
}

const SELECAO_GP = { select: { gpProjeto: { select: { id: true, nome: true, ativo: true, papel: true, area: true, cargos: true } } } } as const;

/** O ponto único da permissão: `null` = pode operar. A tela usa `podeOperarExecucao` com o mesmo `gpId`. */
export async function recusaDeExecucao(tx: Tx | typeof db, porId: string, gpId: string): Promise<ErroExecucao | null> {
  const p = await tx.usuario.findUnique({ where: { id: porId }, select: { id: true, papel: true, area: true, cargos: true, ativo: true } });
  return p && podeOperarExecucao(p, gpId) ? null : "SEM_PERMISSAO";
}

/** Trava a linha, confere a permissão e que o card está em Execução. */
async function abrirParaOperar(tx: Tx, projetoId: string, por: Ator): Promise<void> {
  const linha = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM oportunidade WHERE id = ${projetoId} AND deletado_em IS NULL FOR UPDATE`;
  if (linha.length === 0) throw new Falha("CARD_NAO_ENCONTRADO");
  const card = await tx.projeto.findUniqueOrThrow({ where: { id: projetoId }, select: { responsavelId: true, fase: true, pipeline: { select: { chave: true } }, handoff: SELECAO_GP } });
  const recusa = await recusaDeExecucao(tx, por.id, gpDoProjeto({ responsavelId: card.responsavelId, gpDesignado: card.handoff?.gpProjeto }));
  if (recusa) throw new Falha(recusa);
  if (!faseDeExecucaoAberta(card.fase, card.pipeline.chave, await faseExecucao(tx))) throw new Falha("FORA_DA_EXECUCAO");
}

/** Entrega do cronograma ativo: cancelada não muda mais. */
async function lerEntrega(tx: Tx, projetoId: string, entregaId: string) {
  const e = await tx.projetoEntrega.findFirst({ where: { id: entregaId, projetoId } });
  if (!e) throw new Falha("ENTREGA_NAO_ENCONTRADA");
  if (e.canceladaEm) throw new Falha("ENTREGA_CANCELADA");
  return e;
}

/** Filtro do cronograma ativo: é o que entra em contas, inclusive as do painel. */
export const ENTREGA_ATIVA = { canceladaEm: null } as const satisfies Prisma.ProjetoEntregaWhereInput;

const diaAceito = (dia: string) => diaValido(dia) && diaNoIntervalo(dia);

// ---------------------------------------------------------------- leitura

export type VisaoAjuste = { de: string; para: string; motivo: string; por: string; em: Date };

export type VisaoEntrega = {
  id: string;
  titulo: string;
  valor: string | null;
  /** O que foi combinado: não muda nunca. */
  previstoOriginal: string;
  /** Vale agora: igual ao original até um ajuste. */
  previsto: string;
  realizado: string | null;
  atrasada: boolean;
  origem: OrigemEntrega;
  propostaVersao: number | null;
  ajustes: VisaoAjuste[];
};

export type VisaoCancelada = { id: string; titulo: string; valor: string | null; previstoOriginal: string; propostaVersao: number | null; motivo: string; em: Date };

export type VisaoCheckin = { id: string; status: StatusCheckin; motivo: string; semana: string; por: string; em: Date };

export type VisaoCronograma = {
  /** Dá para operar: card em Execução ou subfase depois dela. */
  emExecucao: boolean;
  /** Id e nome de quem responde pela execução. */
  gp: { id: string; nome: string };
  /** Responsável do card agora: pode ter mudado depois da designação. */
  responsavelId: string;
  /** GP designado no handoff? false = é o responsável, sem GP válido. */
  gpDesignado: boolean;
  isento: boolean;
  /** O cronograma ativo. */
  entregas: VisaoEntrega[];
  /** Fora do cronograma, mantidas como registro. */
  canceladas: VisaoCancelada[];
  /** Mais recentes primeiro (até `CHECKINS_NA_VISAO`). */
  checkins: VisaoCheckin[];
  /** Já há check-in na semana corrente (segunda a domingo, São Paulo). */
  checkinNaSemana: boolean;
  /** Nada impede a cópia e há proposta final: quantas dá para copiar, sem as inválidas (0 = nada a copiar). */
  copiaveis: number;
};

export const CHECKINS_NA_VISAO = 12;

/** Cronograma e check-ins de um card do quadro Projetos (null = fora dele ou inexistente). Leitura para todos. */
export async function obterCronograma(projetoId: string, agora = new Date()): Promise<VisaoCronograma | null> {
  const [card, ex] = await Promise.all([
    db.projeto.findFirst({
      where: { id: projetoId, deletadoEm: null },
      select: {
        responsavelId: true,
        isentoTravaHandoff: true,
        fase: true,
        pipeline: { select: { chave: true } },
        responsavel: { select: { id: true, nome: true } },
        handoff: SELECAO_GP,
        entregas: { orderBy: { ordem: "asc" }, include: { ajustes: { orderBy: [{ em: "asc" }, { id: "asc" }], include: { por: { select: { nome: true } } } } } },
        checkins: { orderBy: [{ em: "desc" }, { id: "desc" }], take: CHECKINS_NA_VISAO, include: { por: { select: { nome: true } } } },
      },
    }),
    db.fase.findUnique({ where: { marco: "EXECUCAO" } }),
  ]);
  if (!card || card.pipeline.chave !== PIPELINE_PROJETOS) return null;
  const gpId = gpDoProjeto({ responsavelId: card.responsavelId, gpDesignado: card.handoff?.gpProjeto });
  const hoje = diaEmFuso(agora);
  const semana = semanaDe(agora);
  const emExecucao = faseDeExecucaoAberta(card.fase, card.pipeline.chave, ex);
  const impedida = card.entregas.some((e) => e.canceladaEm === null || e.origem === "PROPOSTA");
  const final = emExecucao && !impedida ? await entregasDaPropostaFinal(db, projetoId) : null;
  const designado = card.handoff?.gpProjeto;
  return {
    emExecucao,
    gp: designado && designado.id === gpId ? { id: designado.id, nome: designado.nome } : card.responsavel,
    responsavelId: card.responsavelId,
    gpDesignado: designado?.id === gpId,
    isento: card.isentoTravaHandoff,
    canceladas: card.entregas.flatMap((e) =>
      e.canceladaEm
        ? [{ id: e.id, titulo: e.titulo, valor: e.valor?.toFixed(2) ?? null, previstoOriginal: colunaParaDia(e.previstoOriginal), propostaVersao: e.propostaVersao, motivo: e.motivoCancelamento ?? "", em: e.canceladaEm }]
        : [],
    ),
    entregas: card.entregas.filter((e) => !e.canceladaEm).map((e) => {
      const previsto = colunaParaDia(e.previstoAtual);
      const realizado = e.realizadoEm ? colunaParaDia(e.realizadoEm) : null;
      return {
        id: e.id,
        titulo: e.titulo,
        valor: e.valor?.toFixed(2) ?? null,
        previstoOriginal: colunaParaDia(e.previstoOriginal),
        previsto,
        realizado,
        atrasada: realizado === null && previsto < hoje,
        origem: e.origem,
        propostaVersao: e.propostaVersao,
        ajustes: e.ajustes.map((a) => ({ de: colunaParaDia(a.de), para: colunaParaDia(a.para), motivo: a.motivo, por: a.por.nome, em: a.em })),
      };
    }),
    checkins: card.checkins.map((c) => ({ id: c.id, status: c.status, motivo: c.motivo, semana: colunaParaDia(c.semana), por: c.por.nome, em: c.em })),
    checkinNaSemana: card.checkins.some((c) => colunaParaDia(c.semana) === semana),
    copiaveis: final ? separarCopiaveis(final.entregas, hoje).validas.length : 0,
  };
}

/** A visão para quem não vê a proposta: título e datas ficam; valor, versão e o que dá para copiar saem. */
export function cronogramaSemProposta(c: VisaoCronograma): VisaoCronograma {
  return {
    ...c,
    copiaveis: 0,
    entregas: c.entregas.map((e) => ({ ...e, valor: null, propostaVersao: null })),
    canceladas: c.canceladas.map((e) => ({ ...e, valor: null, propostaVersao: null })),
  };
}

// ---------------------------------------------------------------- escrita

/** Copia a proposta final para quem entrou em Execução antes de haver cronograma (deploy, import). */
export async function copiarCronogramaDaProposta(projetoId: string, por: Ator): Promise<ResultadoExecucao<{ entregas: number }>> {
  return emTransacao(async (tx) => {
    await abrirParaOperar(tx, projetoId, por);
    if ((await tx.projetoEntrega.count({ where: { projetoId, ...IMPEDE_COPIA } })) > 0) throw new Falha("CRONOGRAMA_JA_EXISTE");
    const entregas = await copiarDaPropostaFinal(tx, { projetoId, porId: por.id, em: new Date() });
    if (entregas === 0) throw new Falha("PROPOSTA_SEM_CRONOGRAMA");
    return { ok: true as const, entregas };
  });
}

/** Lança uma entrega à mão. A data informada é o previsto original dela. */
export async function adicionarEntrega(projetoId: string, dados: { titulo: string; dia: string; valor?: string }, por: Ator): Promise<ResultadoExecucao<{ entregaId: string }>> {
  const titulo = dados.titulo.replace(/\s+/g, " ").trim();
  if (!titulo || titulo.length > TITULO_ENTREGA_MAX) return { ok: false, erro: "ENTREGA_INVALIDA" };
  const dia = dados.dia.trim();
  if (!diaAceito(dia)) return { ok: false, erro: "DIA_INVALIDO" };
  const valor = lerDinheiro(dados.valor ?? "");
  if (!valor.ok) return { ok: false, erro: "VALOR_INVALIDO" };
  return emTransacao(async (tx) => {
    await abrirParaOperar(tx, projetoId, por);
    if ((await tx.projetoEntrega.count({ where: { projetoId, ...ENTREGA_ATIVA } })) >= ENTREGAS_MAX) throw new Falha("LIMITE_DE_ENTREGAS");
    const { _max } = await tx.projetoEntrega.aggregate({ where: { projetoId }, _max: { ordem: true } });
    const coluna = diaParaColuna(dia);
    const e = await tx.projetoEntrega.create({
      data: { projetoId, ordem: (_max.ordem ?? -1) + 1, titulo, valor: valor.valor, previstoOriginal: coluna, previstoAtual: coluna, origem: "MANUAL" },
      select: { id: true },
    });
    await tx.timeline.create({ data: { projetoId, tipo: "EXECUCAO", payload: { evento: "entrega_adicionada", entregaId: e.id, titulo, dia }, usuarioId: por.id } });
    return { ok: true as const, entregaId: e.id };
  });
}

/** Marca como feita na data real (padrão: hoje em São Paulo). Marcar de novo com outra data corrige. */
export async function marcarEntregaFeita(projetoId: string, entregaId: string, diaReal: string | null, por: Ator, agora = new Date()): Promise<ResultadoExecucao<{ mudou: boolean; dia: string }>> {
  const hoje = diaEmFuso(agora);
  const dia = diaReal?.trim() || hoje;
  if (!diaAceito(dia)) return { ok: false, erro: "DIA_INVALIDO" };
  if (dia > hoje) return { ok: false, erro: "DIA_NO_FUTURO" };
  return emTransacao(async (tx) => {
    await abrirParaOperar(tx, projetoId, por);
    const e = await lerEntrega(tx, projetoId, entregaId);
    if (e.realizadoEm && colunaParaDia(e.realizadoEm) === dia) return { ok: true as const, mudou: false, dia };
    await tx.projetoEntrega.update({ where: { id: e.id }, data: { realizadoEm: diaParaColuna(dia) } });
    await tx.timeline.create({
      data: {
        projetoId,
        tipo: "EXECUCAO",
        payload: { evento: "entrega_feita", entregaId: e.id, titulo: e.titulo, dia, previsto: colunaParaDia(e.previstoAtual), ...(e.realizadoEm ? { antes: colunaParaDia(e.realizadoEm) } : {}) },
        usuarioId: por.id,
      },
    });
    return { ok: true as const, mudou: true, dia };
  });
}

/** Desfaz a marcação (engano). A Timeline guarda o dia que estava. */
export async function desmarcarEntrega(projetoId: string, entregaId: string, por: Ator): Promise<ResultadoExecucao<{ mudou: boolean }>> {
  return emTransacao(async (tx) => {
    await abrirParaOperar(tx, projetoId, por);
    const e = await lerEntrega(tx, projetoId, entregaId);
    if (!e.realizadoEm) return { ok: true as const, mudou: false };
    await tx.projetoEntrega.update({ where: { id: e.id }, data: { realizadoEm: null } });
    await tx.timeline.create({ data: { projetoId, tipo: "EXECUCAO", payload: { evento: "entrega_desmarcada", entregaId: e.id, titulo: e.titulo, dia: colunaParaDia(e.realizadoEm) }, usuarioId: por.id } });
    return { ok: true as const, mudou: true };
  });
}

/** Ajusta a data prevista, com motivo. Só muda o previsto atual; o original fica. */
export async function ajustarDataEntrega(projetoId: string, entregaId: string, dados: { dia: string; motivo: string }, por: Ator): Promise<ResultadoExecucao<{ mudou: boolean }>> {
  const dia = dados.dia.trim();
  if (!diaAceito(dia)) return { ok: false, erro: "DIA_INVALIDO" };
  const motivo = lerMotivo(dados.motivo);
  if (!motivo) return { ok: false, erro: "MOTIVO_INVALIDO" };
  return emTransacao(async (tx) => {
    await abrirParaOperar(tx, projetoId, por);
    const e = await lerEntrega(tx, projetoId, entregaId);
    if (e.realizadoEm) throw new Falha("ENTREGA_JA_FEITA");
    const de = colunaParaDia(e.previstoAtual);
    if (de === dia) return { ok: true as const, mudou: false };
    const para = diaParaColuna(dia);
    await tx.projetoEntrega.update({ where: { id: e.id }, data: { previstoAtual: para } });
    await tx.entregaAjuste.create({ data: { entregaId: e.id, de: e.previstoAtual, para, motivo, porId: por.id } });
    await tx.timeline.create({ data: { projetoId, tipo: "EXECUCAO", payload: { evento: "data_ajustada", entregaId: e.id, titulo: e.titulo, de, para: dia, motivo }, usuarioId: por.id } });
    return { ok: true as const, mudou: true };
  });
}

/** Cancela com motivo: a linha fica, fora do cronograma ativo. Entrega feita precisa ser desmarcada antes. */
export async function cancelarEntrega(projetoId: string, entregaId: string, dados: { motivo: string }, por: Ator): Promise<ResultadoExecucao<{ mudou: boolean }>> {
  const motivo = lerMotivo(dados.motivo);
  if (!motivo) return { ok: false, erro: "MOTIVO_INVALIDO" };
  return emTransacao(async (tx) => {
    await abrirParaOperar(tx, projetoId, por);
    const e = await tx.projetoEntrega.findFirst({ where: { id: entregaId, projetoId } });
    if (!e) throw new Falha("ENTREGA_NAO_ENCONTRADA");
    if (e.canceladaEm) return { ok: true as const, mudou: false };
    if (e.realizadoEm) throw new Falha("ENTREGA_JA_FEITA");
    const agora = new Date();
    await tx.projetoEntrega.update({ where: { id: e.id }, data: { canceladaEm: agora, motivoCancelamento: motivo } });
    await tx.timeline.create({ data: { projetoId, tipo: "EXECUCAO", payload: { evento: "entrega_cancelada", entregaId: e.id, titulo: e.titulo, motivo }, usuarioId: por.id, em: agora } });
    return { ok: true as const, mudou: true };
  });
}

/** Check-in: cor e uma linha de motivo. Mais de um na semana vale, e o último é o status. */
export async function registrarCheckin(projetoId: string, dados: { status: StatusCheckin; motivo: string }, por: Ator, agora = new Date()): Promise<ResultadoExecucao<{ checkinId: string; semana: string }>> {
  const motivo = lerMotivo(dados.motivo);
  if (!motivo) return { ok: false, erro: "MOTIVO_INVALIDO" };
  const semana = semanaDe(agora);
  return emTransacao(async (tx) => {
    await abrirParaOperar(tx, projetoId, por);
    const c = await tx.projetoCheckin.create({ data: { projetoId, status: dados.status, motivo, semana: diaParaColuna(semana), porId: por.id, em: agora }, select: { id: true } });
    await tx.timeline.create({ data: { projetoId, tipo: "EXECUCAO", payload: { evento: "checkin", status: dados.status, motivo, semana }, usuarioId: por.id, em: agora } });
    return { ok: true as const, checkinId: c.id, semana };
  });
}
