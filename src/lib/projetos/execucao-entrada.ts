/**
 * Entrada em Execução (GAB-95, spec §4.10): a cópia do cronograma da proposta final
 * para o previsto do Projeto. Todo caminho que coloca um card em Execução ou além
 * passa por `aoEntrarEmExecucao`: arraste, MCP e WhatsApp (`registrarMovimento`), lixeira
 * (`restaurarCard`) e Gestão de fases (remover com migração, reordenar).
 *
 * Idempotente: só copia se o Projeto não tem nenhuma entrega. Sair e voltar acha as
 * entregas e não recopia; nada aqui apaga. Quem já lançou entrega manual também não recebe a
 * cópia, para não misturar dois cronogramas. A linha do card fica travada, e o índice
 * único (projeto, ordem) segura uma cópia dupla no banco.
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

/** Copia da proposta final se o Projeto não tem entrega. Devolve quantas copiou. */
export async function copiarDaPropostaFinal(tx: Tx, a: { projetoId: string; porId: string | null; em: Date }): Promise<number> {
  await tx.$queryRaw`SELECT id FROM oportunidade WHERE id = ${a.projetoId} FOR UPDATE`;
  if ((await tx.projetoEntrega.count({ where: { projetoId: a.projetoId } })) > 0) return 0;
  const final = await entregasDaPropostaFinal(tx, a.projetoId);
  if (!final) return 0;
  // Snapshot é validado ao salvar; a leitura é defensiva: linha estranha não pode barrar o movimento do card.
  const validas = final.entregas.filter((e) => diaValido(e.dia) && diaNoIntervalo(e.dia));
  if (validas.length < final.entregas.length) {
    console.warn(`[execucao] projeto ${a.projetoId}: ${final.entregas.length - validas.length} entrega(s) da v${final.versao} com data inválida ficaram fora da cópia`);
  }
  if (validas.length === 0) return 0;
  await tx.projetoEntrega.createMany({
    data: validas.map((e, ordem) => {
      const dia = diaParaColuna(e.dia);
      return { projetoId: a.projetoId, ordem, titulo: e.titulo, valor: e.valor, previstoOriginal: dia, previstoAtual: dia, origem: "PROPOSTA" as const, propostaVersao: final.versao };
    }),
  });
  await tx.timeline.create({ data: { projetoId: a.projetoId, tipo: "EXECUCAO", payload: { evento: "cronograma_copiado", versao: final.versao, entregas: validas.length }, usuarioId: a.porId, em: a.em } });
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
