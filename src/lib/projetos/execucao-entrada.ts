/**
 * Entrada em Execução (GAB-95, spec §4.10): a cópia do cronograma da proposta final
 * para o previsto do Projeto. Todo caminho que coloca um card em Execução ou além
 * passa por `aoEntrarEmExecucao`: arraste, MCP e WhatsApp (`registrarMovimento`), lixeira
 * (`restaurarCard`) e Gestão de fases (remover com migração, reordenar).
 *
 * Idempotente: só copia se nada impede (`IMPEDE_COPIA`). Sair e voltar acha as entregas e não
 * recopia; nada aqui apaga. Quem tem entrega manual ativa também não recebe a cópia, para não
 * misturar dois cronogramas. A linha do card fica travada, e o índice único (projeto, ordem)
 * segura uma cópia dupla no banco.
 *
 * O import do Pipefy não passa por aqui: é histórico, como nas travas.
 */
import type { Fase, Prisma } from "@prisma/client";
import { diaValido, lerEstruturadoGravado, type Entrega } from "@/lib/propostas/estruturado";
import { diaNoIntervalo } from "./execucao-regras";
import { diaParaColuna } from "./execucao-semana";
import { alemDaExecucao, destinoExigeHandoff, faseExecucao } from "./trava-handoff";

type Tx = Prisma.TransactionClient;

/** Entregas da versão final (a proposta ACEITA, que não muda mais). null = não há proposta final. */
export async function entregasDaPropostaFinal(tx: Pick<Tx, "proposta" | "propostaVersao">, projetoId: string): Promise<{ versao: number; entregas: Entrega[] } | null> {
  const p = await tx.proposta.findUnique({ where: { projetoId }, select: { id: true, status: true, versaoEnviada: true } });
  if (p?.status !== "ACEITA" || p.versaoEnviada === null) return null;
  const v = await tx.propostaVersao.findUnique({ where: { propostaId_numero: { propostaId: p.id, numero: p.versaoEnviada } }, select: { estruturado: true } });
  if (!v) return null;
  return { versao: p.versaoEnviada, entregas: lerEstruturadoGravado(v.estruturado).entregas };
}

/** Cabe em DECIMAL(14,2). */
const VALOR_GRAVAVEL = /^\d{1,12}(\.\d{1,2})?$/;

/**
 * O que dá para copiar. O snapshot é validado ao salvar, e a leitura é defensiva: linha estranha não
 * pode barrar o movimento do card. Data inválida fica de fora (`ignoradas`); valor inválido vira null. Puro.
 */
export function separarCopiaveis(entregas: readonly Entrega[]): { validas: Entrega[]; ignoradas: number; valoresInvalidos: number } {
  const comData = entregas.filter((e) => diaValido(e.dia) && diaNoIntervalo(e.dia));
  const validas = comData.map((e) => (e.valor === null || VALOR_GRAVAVEL.test(e.valor) ? e : { ...e, valor: null }));
  return { validas, ignoradas: entregas.length - comData.length, valoresInvalidos: comData.filter((e, i) => e.valor !== validas[i].valor).length };
}

/**
 * Entrega que impede copiar: toda ativa, e toda que já veio da proposta, mesmo cancelada (cancelar não
 * ressuscita na volta). Só a manual cancelada não conta: lançar errado e cancelar não tira a cópia de quem tem proposta.
 */
export const IMPEDE_COPIA = { OR: [{ canceladaEm: null }, { origem: "PROPOSTA" }] } as const satisfies Prisma.ProjetoEntregaWhereInput;

/** Copia da proposta final se nada impede. Devolve quantas copiou. */
export async function copiarDaPropostaFinal(tx: Tx, a: { projetoId: string; porId: string | null; em: Date }): Promise<number> {
  await tx.$queryRaw`SELECT id FROM oportunidade WHERE id = ${a.projetoId} FOR UPDATE`;
  if ((await tx.projetoEntrega.count({ where: { projetoId: a.projetoId, ...IMPEDE_COPIA } })) > 0) return 0;
  const final = await entregasDaPropostaFinal(tx, a.projetoId);
  if (!final) return 0;
  const { validas, ignoradas, valoresInvalidos } = separarCopiaveis(final.entregas);
  if (ignoradas > 0 || valoresInvalidos > 0) {
    console.warn(`[execucao] projeto ${a.projetoId}, v${final.versao}: ${ignoradas} entrega(s) com data inválida ficaram fora da cópia e ${valoresInvalidos} com valor inválido ficaram sem valor`);
  }
  if (validas.length === 0) return 0;
  // Manual cancelada mantém a linha: a ordem continua depois dela.
  const { _max } = await tx.projetoEntrega.aggregate({ where: { projetoId: a.projetoId }, _max: { ordem: true } });
  const inicio = (_max.ordem ?? -1) + 1;
  await tx.projetoEntrega.createMany({
    data: validas.map((e, i) => {
      const dia = diaParaColuna(e.dia);
      return { projetoId: a.projetoId, ordem: inicio + i, titulo: e.titulo, valor: e.valor, previstoOriginal: dia, previstoAtual: dia, origem: "PROPOSTA" as const, propostaVersao: final.versao };
    }),
  });
  await tx.timeline.create({ data: { projetoId: a.projetoId, tipo: "EXECUCAO", payload: { evento: "cronograma_copiado", versao: final.versao, entregas: validas.length, ignoradas }, usuarioId: a.porId, em: a.em } });
  return validas.length;
}

/**
 * O card acaba de ficar em Execução ou além. `novaEntrada`: veio de fora dessa região
 * (e não só andou entre subfases), então o lembrete de check-in conta a partir de agora.
 */
export async function aoEntrarEmExecucao(tx: Tx, a: { projetoId: string; porId: string | null; em: Date; novaEntrada: boolean }): Promise<void> {
  if (a.novaEntrada) await tx.projeto.update({ where: { id: a.projetoId }, data: { execucaoDesde: a.em } });
  await copiarDaPropostaFinal(tx, a);
}

/** Gancho do movimento: `registrarMovimento` chama para todo destino. */
export async function aoMoverParaExecucao(tx: Tx, a: { projetoId: string; origem: Fase; destino: Fase; porId: string; em: Date }): Promise<void> {
  const ex = await faseExecucao(tx);
  if (!ex || !destinoExigeHandoff(a.destino, ex)) return;
  // Sair de terminal (Finalizado reaberto) também recomeça a conta. De Perdido, `alemDaExecucao` já é false.
  const novaEntrada = a.origem.isTerminal || !alemDaExecucao(a.origem, ex);
  await aoEntrarEmExecucao(tx, { projetoId: a.projetoId, porId: a.porId, em: a.em, novaEntrada });
}
