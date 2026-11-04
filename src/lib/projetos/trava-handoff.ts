/**
 * Trava do marco Execução (GAB-93, spec fase 2 §4.2/§4.8 Q34): o Projeto só
 * entra em Execução, ou em qualquer fase depois dela no quadro Projetos, com o
 * handoff fechado (GP, checklist e resumo, `handoff-regras.ts`). Fase de ganho
 * do quadro também, onde quer que a Gestão a tenha posto: senão seria um atalho.
 * Vale para arraste e MCP (`moverCard` → `registrarMovimento`), card novo
 * (`criarCardTravado`), lixeira e Gestão de fases. Nem gestor força. O WhatsApp
 * só enxerga as fases de Vendas e trata card em Projetos como fechado
 * (`whatsapp/ciclo-vendas.ts`): não tem como pedir este movimento, e se um dia
 * tiver, `registrarMovimento` segura. O import do Pipefy não passa por aqui.
 *
 * Isentos (`isento_trava_handoff`): quem já estava no quadro Projetos no deploy
 * e o que vem do import. A trava só olha a ENTRADA: quem já está em Execução ou
 * depois anda livre lá dentro. Saindo de Perdido, conta onde o card estava
 * (a última TransicaoFase para o Perdido atual). Perdido nunca trava.
 *
 * Lixeira: `origem` null é trava estrita, e `restaurarCard` só a aplica se o card
 * não estava além de Execução quando foi excluído. A posição fica gravada na
 * EXCLUSAO (`alemDaExecucao`), porque a fase pode ser reordenada ou arquivada com
 * o card na lixeira, e "já esteve em Execução" não diz onde ele estava.
 *
 * Concorrência: lê com a linha do card em FOR SHARE, depois do lock de quadro
 * (a ordem documentada: quadro → linha). As edições do handoff tomam a linha em
 * FOR UPDATE, então o movimento vê a edição confirmada, nunca uma pela metade.
 */
import type { Fase, Prisma } from "@prisma/client";
import { ErroDeRegra } from "./erros";
import { avaliarHandoff, descreverPendencias, type AvaliacaoHandoff } from "./handoff-regras";
import { PIPELINE_PROJETOS } from "./terminal-regras";
import { alemDoContrato } from "./trava-contrato";

type Tx = Prisma.TransactionClient;

export const SELECAO_HANDOFF = {
  responsavelId: true,
  isentoTravaContrato: true,
  isentoTravaHandoff: true,
  dataGanho: true,
  proposta: { select: { status: true, versaoEnviada: true } },
  anexos: { where: { contratoAssinado: true, deletadoEm: null }, orderBy: { criadoEm: "desc" }, take: 1, select: { id: true, nome: true } },
  handoff: {
    select: {
      gpProjeto: { select: { id: true, nome: true, ativo: true, papel: true, area: true, cargos: true } },
      contatosEm: true,
      kickoffEm: true,
      acessosEm: true,
      resumoContexto: true,
      resumoCombinados: true,
      resumoRiscos: true,
      resumoValoriza: true,
      resumoEm: true,
      resumoPor: { select: { nome: true } },
    },
  },
} as const satisfies Prisma.ProjetoSelect;

export async function faseExecucao(tx: Tx): Promise<Fase | null> {
  return tx.fase.findUnique({ where: { marco: "EXECUCAO" } });
}

/** A fase está no marco Execução ou depois dele, no quadro dele (mesma conta de posição do contrato). Puro. */
export function alemDaExecucao(f: Parameters<typeof alemDoContrato>[0], execucao: Parameters<typeof alemDoContrato>[1]): boolean {
  return alemDoContrato(f, execucao);
}

/** O destino exige o handoff fechado? Puro. GAB-95: é também o que conta como "estar em Execução" para o cronograma. */
export function destinoExigeHandoff(destino: Fase, execucao: Fase): boolean {
  if (destino.pipelineId !== execucao.pipelineId || destino.tipoTerminal === "PERDIDO") return false;
  return destino.tipoTerminal === "GANHO" || alemDaExecucao(destino, execucao);
}

/** A fase é a de edição do handoff (quadro Projetos, antes de Execução, fora de terminal)? Puro. `execucao` null = quadro sem o marco. */
export function faseDeHandoff(fase: Fase, pipelineChave: string, execucao: Fase | null): boolean {
  return pipelineChave === PIPELINE_PROJETOS && !fase.isTerminal && !(execucao && alemDaExecucao(fase, execucao));
}

/** A fase é a de operar a execução (Execução ou subfase depois dela, fora de terminal)? Puro. GAB-95. */
export function faseDeExecucaoAberta(fase: Fase, pipelineChave: string, execucao: Fase | null): boolean {
  return pipelineChave === PIPELINE_PROJETOS && !fase.isTerminal && !!execucao && alemDaExecucao(fase, execucao);
}

/** O que a EXCLUSAO do card grava sobre a posição dele (vazio = não estava além de Execução). */
export async function posicaoNaExclusao(tx: Tx, fase: Fase): Promise<{ alemDaExecucao?: true }> {
  const ex = await faseExecucao(tx);
  return ex && destinoExigeHandoff(fase, ex) ? { alemDaExecucao: true } : {};
}

/** Quando foi excluído, o card estava além de Execução? Sem a marca = não (card anterior a ela no quadro Projetos é isento). */
export async function estavaAlemDaExecucao(tx: Tx, projetoId: string): Promise<boolean> {
  const e = await tx.timeline.findFirst({ where: { projetoId, tipo: "EXCLUSAO" }, orderBy: [{ em: "desc" }, { id: "desc" }], select: { payload: true } });
  const payload = e?.payload;
  return !!payload && typeof payload === "object" && !Array.isArray(payload) && payload.alemDaExecucao === true;
}

/** Por que a trava pegou. `faltando` vazio = card novo (nem tem handoff). */
export type TravaHandoff = { erro: "HANDOFF_INCOMPLETO"; faltando: string };

export async function travaDoHandoff(tx: Tx, a: { projetoId: string | null; origem: Fase | null; destino: Fase }): Promise<TravaHandoff | null> {
  const ex = await faseExecucao(tx);
  if (!ex || !destinoExigeHandoff(a.destino, ex)) return null;
  if (!a.projetoId) return { erro: "HANDOFF_INCOMPLETO", faltando: "" };
  await tx.$queryRaw`SELECT id FROM oportunidade WHERE id = ${a.projetoId} FOR SHARE`;
  const card = await tx.projeto.findUniqueOrThrow({ where: { id: a.projetoId }, select: SELECAO_HANDOFF });
  if (card.isentoTravaHandoff) return null;
  if (a.origem) {
    let efetiva: Parameters<typeof alemDoContrato>[0] = a.origem;
    if (a.origem.tipoTerminal === "PERDIDO") {
      const t = await tx.transicaoFase.findFirst({
        where: { projetoId: a.projetoId, paraFaseId: a.origem.id, deFaseId: { not: null } },
        orderBy: [{ em: "desc" }, { id: "desc" }],
        select: { deFase: { select: { pipelineId: true, ordem: true, criadoEm: true, tipoTerminal: true } } },
      });
      if (t?.deFase) efetiva = t.deFase;
    }
    if (alemDaExecucao(efetiva, ex)) return null;
  }
  const { pendencias } = avaliarHandoff(card);
  return pendencias.length ? { erro: "HANDOFF_INCOMPLETO", faltando: descreverPendencias(pendencias) } : null;
}

/** Lança o erro da trava (desfaz a transação) se ela pega. */
export async function exigirTravaDoHandoff(tx: Tx, a: { projetoId: string | null; origem: Fase | null; destino: Fase }): Promise<void> {
  const trava = await travaDoHandoff(tx, a);
  if (trava) throw new ErroDeRegra(trava.erro, trava.faltando || undefined);
}

/**
 * Cards vivos da fase que a trava seguraria se fossem levados para Execução ou
 * depois: não isentos e com pendência. Usado pela Gestão de fases (remover com
 * migração, reordenar), que mexe em vários cards sem `registrarMovimento`. Por
 * coluna há poucos cards, e a regra é a mesma do movimento.
 */
export async function contarCardsComHandoffPendente(tx: Tx, faseId: string): Promise<number> {
  const cards = await tx.projeto.findMany({ where: { faseId, deletadoEm: null, isentoTravaHandoff: false }, select: SELECAO_HANDOFF });
  return cards.filter((c) => avaliarHandoff(c).pendencias.length > 0).length;
}

export type { AvaliacaoHandoff };
