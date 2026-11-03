/**
 * Ganchos da caneta chamados por OUTROS serviços, dentro da transação deles
 * (GAB-87). Módulo à parte, sem importar `projetos`/`auth/usuarios`, para não
 * criar ciclo: o Kanban (`registrarMovimento`) e a Gestão de usuários
 * (`atualizarUsuario`) chamam daqui.
 *
 * Ambos travam as linhas de proposta que tocam (`FOR UPDATE`), incrementam a
 * revisão (base velha vira CONFLITO) e registram na Timeline.
 */
import type { Prisma } from "@prisma/client";
import { ladoDe } from "@/lib/auth/areas";
import { estaComACaneta, STATUS_COM_CANETA, type Pessoa } from "./caneta";

type Tx = Prisma.TransactionClient;

/**
 * O Projeto saiu de Perdido pelo Kanban (card reaberto): a proposta Inviável
 * volta para o pingue-pongue — Em ajuste, com vendas e sem ninguém com a
 * caneta (o GP de vendas pega). GAB-89: a Recusada pelo cliente volta como
 * Revisão pedida (o cliente voltou a conversar: nova versão com vendas; se
 * mudar escopo/prazo/valor, passa por projetos). Outro status: nada.
 */
export async function reabrirPropostaInviavel(tx: Tx, projetoId: string, porId: string, em: Date): Promise<void> {
  const linhas = await tx.$queryRaw<{ id: string; status: string }[]>`SELECT id, status::text AS status FROM proposta WHERE oportunidade_id = ${projetoId} FOR UPDATE`;
  const p = linhas[0];
  if (!p || (p.status !== "INVIAVEL" && p.status !== "RECUSADA")) return;
  const recusada = p.status === "RECUSADA";
  await tx.propostaCaneta.updateMany({ where: { propostaId: p.id, fim: null }, data: { fim: em } });
  await tx.proposta.update({
    where: { id: p.id },
    data: {
      status: recusada ? "REVISAO_PEDIDA" : "EM_AJUSTE",
      canetaCom: { disconnect: true },
      canetaLado: "VENDAS",
      ...(recusada ? { motivoRecusa: null } : { motivoInviavel: null }),
      revisao: { increment: 1 },
      atualizadoEm: em,
    },
  });
  await tx.timeline.create({ data: { projetoId, tipo: "PROPOSTA", payload: { evento: "reaberta_do_perdido", ...(recusada ? { de: "RECUSADA" } : {}) }, usuarioId: porId, em } });
}

/**
 * Depois de a Gestão mudar papel/área/cargos/ativo de alguém: as canetas que
 * essa pessoa não pode mais segurar ficam com ninguém (o GP do lado pega), e o
 * período aberto em `proposta_caneta` fecha — o tempo com a caneta não infla.
 */
export async function liberarCanetasDe(tx: Tx, usuarioId: string, porId: string, em = new Date()): Promise<void> {
  const pessoa: (Pessoa & { nome: string }) | null = await tx.usuario.findUnique({
    where: { id: usuarioId },
    select: { id: true, nome: true, papel: true, area: true, cargos: true, ativo: true },
  });
  if (!pessoa) return;
  const ids = (await tx.$queryRaw<{ id: string }[]>`SELECT id FROM proposta WHERE caneta_com_id = ${usuarioId} ORDER BY id FOR UPDATE`).map((x) => x.id);
  if (ids.length === 0) return;
  const propostas = await tx.proposta.findMany({ where: { id: { in: ids } }, select: { id: true, projetoId: true, status: true, canetaComId: true, canetaLado: true } });
  for (const p of propostas) {
    if (!STATUS_COM_CANETA.includes(p.status) || estaComACaneta(pessoa, p)) continue;
    await tx.propostaCaneta.updateMany({ where: { propostaId: p.id, fim: null }, data: { fim: em } });
    await tx.proposta.update({ where: { id: p.id }, data: { canetaCom: { disconnect: true }, revisao: { increment: 1 }, atualizadoEm: em } });
    await tx.timeline.create({
      data: {
        projetoId: p.projetoId,
        tipo: "PROPOSTA",
        payload: { evento: "caneta_liberada", deId: pessoa.id, deNome: pessoa.nome, motivo: !pessoa.ativo ? "desativado" : ladoDe(pessoa) ? "mudou_de_lado" : "sem_lado" },
        usuarioId: porId,
        em,
      },
    });
  }
}
