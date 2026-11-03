/**
 * Trava do marco Montando contrato (GAB-89, spec fase 2 §4.2 Q34): o Projeto
 * só chega a Montando contrato — ou a qualquer fase depois dele no quadro de
 * Vendas (subfases, Ganho) — com a proposta ACEITA pelo cliente. Vale para o
 * arraste no Kanban e o MCP (`moverCard` → `registrarMovimento`), o WhatsApp
 * (`registrarMovimento`, e o plano do ATUALIZAR/CRIAR antes, para responder no
 * grupo o que falta) e card novo criado direto nessas fases
 * (`criarCardTravado`). Nem gestor força. O import do Pipefy (histórico) não
 * passa por aqui.
 *
 * Cards migrados que já estão além do marco Proposta não são afetados
 * [escolha do agente, spec §4.2]: a trava só olha a ENTRADA nessa região do
 * quadro. A migração do ciclo único (GAB-81) pôs o marco Proposta logo antes
 * de Montando contrato, então "além de Proposta" = "em Montando contrato ou
 * depois": quem já está lá anda livre lá dentro (subfase → Ganho, Ganho →
 * Montando contrato). Saindo de Perdido, conta onde o card estava quando foi
 * perdido (a última TransicaoFase para o Perdido atual).
 */
import type { Fase, Prisma, StatusProposta } from "@prisma/client";
import { ErroDeRegra } from "./erros";

type Tx = Prisma.TransactionClient;

type PosicaoFase = Pick<Fase, "pipelineId" | "ordem" | "criadoEm" | "tipoTerminal">;

/** A fase está no marco Montando contrato ou depois dele, no quadro dele (Perdido não conta: é "em qualquer ponto"). Puro. */
export function alemDoContrato(f: PosicaoFase, mc: Pick<Fase, "pipelineId" | "ordem" | "criadoEm">): boolean {
  if (f.pipelineId !== mc.pipelineId || f.tipoTerminal === "PERDIDO") return false;
  return f.ordem > mc.ordem || (f.ordem === mc.ordem && f.criadoEm.getTime() >= mc.criadoEm.getTime());
}

export async function faseMontandoContrato(tx: Tx): Promise<Fase | null> {
  return tx.fase.findUnique({ where: { marco: "MONTANDO_CONTRATO" } });
}

/**
 * Por que o movimento/criação esbarra na trava (null = passa). `projetoId`
 * null = card novo (não tem proposta); `origem` null = card nascendo.
 * Devolve o status da proposta (null = sem proposta) para dizer o que falta.
 */
export async function travaDoContrato(
  tx: Tx,
  a: { projetoId: string | null; origem: Fase | null; destino: Fase },
): Promise<{ status: StatusProposta | null } | null> {
  const mc = await faseMontandoContrato(tx);
  if (!mc || !alemDoContrato(a.destino, mc)) return null;
  if (a.origem) {
    let efetiva: PosicaoFase = a.origem;
    if (a.origem.tipoTerminal === "PERDIDO" && a.projetoId) {
      const t = await tx.transicaoFase.findFirst({
        where: { projetoId: a.projetoId, paraFaseId: a.origem.id, deFaseId: { not: null } },
        orderBy: [{ em: "desc" }, { id: "desc" }],
        select: { deFase: { select: { pipelineId: true, ordem: true, criadoEm: true, tipoTerminal: true } } },
      });
      if (t?.deFase) efetiva = t.deFase;
    }
    if (alemDoContrato(efetiva, mc)) return null;
  }
  if (!a.projetoId) return { status: null };
  const p = await tx.proposta.findUnique({ where: { projetoId: a.projetoId }, select: { status: true } });
  if (p?.status === "ACEITA") return null;
  return { status: p?.status ?? null };
}

/** Lança `PROPOSTA_NAO_ACEITA` (desfaz a transação) se a trava pega. */
export async function exigirTravaDoContrato(tx: Tx, a: { projetoId: string | null; origem: Fase | null; destino: Fase }): Promise<void> {
  if (await travaDoContrato(tx, a)) throw new ErroDeRegra("PROPOSTA_NAO_ACEITA");
}

/**
 * Cards vivos da fase que a trava seguraria se fossem levados para além de
 * Montando contrato: sem proposta, ou com proposta não aceita. Usado pela
 * Gestão de fases (remover com migração, reordenar), que mexe em vários
 * cards de uma vez sem passar por `registrarMovimento`.
 */
export async function contarCardsSemPropostaAceita(tx: Tx, faseId: string): Promise<number> {
  return tx.projeto.count({ where: { faseId, deletadoEm: null, NOT: { proposta: { is: { status: "ACEITA" } } } } });
}
