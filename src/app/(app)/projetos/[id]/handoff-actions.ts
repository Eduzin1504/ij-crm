"use server";

/** Server actions do handoff (GAB-93): só traduzem e chamam o serviço, o mesmo do MCP. */
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { exigirEscrita } from "@/lib/auth/atual";
import { comTratamento, type Inesperado } from "@/lib/erros/registrar";
import { recusaDeEdicaoNoCard, recusaDoChecklistHandoff } from "@/lib/projetos/acesso-card";
import { definirContratoNoHandoff, designarGpDoProjeto, marcarItemHandoff, MENSAGEM_ERRO_HANDOFF, moverParaExecucao, salvarResumoHandoff } from "@/lib/projetos/handoff";
import { ITENS_MANUAIS, RESUMO_CAMPO_MAX, type CampoResumo, type ItemManual } from "@/lib/projetos/handoff-regras";

export type EstadoHandoff = { ok?: true; erro?: string } | Inesperado;

const id = z.string().min(1).max(64);
const parte = z.string().max(RESUMO_CAMPO_MAX + 1000);
const resumo = z.object({ contexto: parte, combinados: parte, riscos: parte, valoriza: parte }).partial().strict();

function concluir(cardId: string, r: { ok: true } | { ok: false; erro: keyof typeof MENSAGEM_ERRO_HANDOFF }): EstadoHandoff {
  if (!r.ok) return { erro: MENSAGEM_ERRO_HANDOFF[r.erro] };
  revalidatePath(`/projetos/${cardId}`);
  return { ok: true };
}

export async function designarGpAction(cardId: string, gpId: string): Promise<EstadoHandoff> {
  return comTratamento("handoff.designarGp", async (): Promise<EstadoHandoff> => {
    const ator = await exigirEscrita();
    if (!id.safeParse(cardId).success || !id.safeParse(gpId).success) return { erro: "Dados inválidos." };
    return concluir(cardId, await designarGpDoProjeto(cardId, gpId, ator));
  });
}

export async function marcarItemAction(cardId: string, item: ItemManual, feito: boolean): Promise<EstadoHandoff> {
  return comTratamento("handoff.marcarItem", async (): Promise<EstadoHandoff> => {
    const ator = await exigirEscrita();
    if (!id.safeParse(cardId).success || !z.enum(ITENS_MANUAIS).safeParse(item).success || typeof feito !== "boolean") return { erro: "Dados inválidos." };
    const recusa = await recusaDoChecklistHandoff(cardId, ator);
    if (recusa) return { erro: recusa };
    return concluir(cardId, await marcarItemHandoff(cardId, item, feito, ator));
  });
}

export async function salvarResumoAction(cardId: string, partes: Partial<Record<CampoResumo, string>>): Promise<EstadoHandoff> {
  return comTratamento("handoff.salvarResumo", async (): Promise<EstadoHandoff> => {
    const ator = await exigirEscrita();
    const p = resumo.safeParse(partes);
    if (!id.safeParse(cardId).success || !p.success) return { erro: "Dados inválidos." };
    return concluir(cardId, await salvarResumoHandoff(cardId, p.data, ator));
  });
}

export async function definirContratoAction(cardId: string, anexoId: string): Promise<EstadoHandoff> {
  return comTratamento("handoff.definirContrato", async (): Promise<EstadoHandoff> => {
    const ator = await exigirEscrita();
    if (!id.safeParse(cardId).success || !id.safeParse(anexoId).success) return { erro: "Dados inválidos." };
    const recusa = await recusaDoChecklistHandoff(cardId, ator);
    if (recusa) return { erro: recusa };
    return concluir(cardId, await definirContratoNoHandoff(cardId, anexoId, ator));
  });
}

export async function moverParaExecucaoAction(cardId: string): Promise<EstadoHandoff> {
  return comTratamento("handoff.moverParaExecucao", async (): Promise<EstadoHandoff> => {
    const ator = await exigirEscrita();
    if (!id.safeParse(cardId).success) return { erro: "Dados inválidos." };
    const recusa = await recusaDeEdicaoNoCard(cardId, ator);
    if (recusa) return { erro: recusa };
    const r = await moverParaExecucao(cardId, ator);
    if (!r.ok) return { erro: r.erro };
    revalidatePath(`/projetos/${cardId}`);
    revalidatePath("/kanban");
    return { ok: true };
  });
}
