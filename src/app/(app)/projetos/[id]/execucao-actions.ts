"use server";

/** Server actions da execução (GAB-95): só traduzem e chamam o serviço, o mesmo do MCP. */
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { exigirEscrita } from "@/lib/auth/atual";
import { comTratamento, type Inesperado } from "@/lib/erros/registrar";
import { MENSAGEM_SEM_ACESSO_PROPOSTA, podeVerPropostaDoProjeto } from "@/lib/propostas/acesso";
import { adicionarEntrega, ajustarDataEntrega, cancelarEntrega, copiarCronogramaDaProposta, desmarcarEntrega, marcarEntregaFeita, MENSAGEM_ERRO_EXECUCAO, registrarCheckin, type ErroExecucao } from "@/lib/projetos/execucao";
import { MOTIVO_MAX, STATUS_CHECKIN } from "@/lib/projetos/execucao-regras";

export type EstadoExecucao = { ok?: true; erro?: string } | Inesperado;

const id = z.string().min(1).max(64);
const dia = z.string().max(20);
const motivo = z.string().max(MOTIVO_MAX * 4);
const novaEntrega = z.object({ titulo: z.string().max(1000), dia, valor: z.string().max(50).optional() }).strict();

function concluir(cardId: string, r: { ok: true } | { ok: false; erro: ErroExecucao }): EstadoExecucao {
  if (!r.ok) return { erro: MENSAGEM_ERRO_EXECUCAO[r.erro] };
  revalidatePath(`/projetos/${cardId}`);
  revalidatePath("/kanban");
  return { ok: true };
}

export async function copiarCronogramaAction(cardId: string): Promise<EstadoExecucao> {
  return comTratamento("execucao.copiar", async (): Promise<EstadoExecucao> => {
    const ator = await exigirEscrita();
    if (!id.safeParse(cardId).success) return { erro: "Dados inválidos." };
    if (!(await podeVerPropostaDoProjeto(ator, cardId))) return { erro: MENSAGEM_SEM_ACESSO_PROPOSTA };
    return concluir(cardId, await copiarCronogramaDaProposta(cardId, ator));
  });
}

export async function adicionarEntregaAction(cardId: string, dados: { titulo: string; dia: string; valor?: string }): Promise<EstadoExecucao> {
  return comTratamento("execucao.adicionarEntrega", async (): Promise<EstadoExecucao> => {
    const ator = await exigirEscrita();
    const p = novaEntrega.safeParse(dados);
    if (!id.safeParse(cardId).success || !p.success) return { erro: "Dados inválidos." };
    return concluir(cardId, await adicionarEntrega(cardId, p.data, ator));
  });
}

export async function marcarEntregaAction(cardId: string, entregaId: string, diaReal: string): Promise<EstadoExecucao> {
  return comTratamento("execucao.marcarEntrega", async (): Promise<EstadoExecucao> => {
    const ator = await exigirEscrita();
    if (!id.safeParse(cardId).success || !id.safeParse(entregaId).success || !dia.safeParse(diaReal).success) return { erro: "Dados inválidos." };
    return concluir(cardId, await marcarEntregaFeita(cardId, entregaId, diaReal, ator));
  });
}

export async function desmarcarEntregaAction(cardId: string, entregaId: string): Promise<EstadoExecucao> {
  return comTratamento("execucao.desmarcarEntrega", async (): Promise<EstadoExecucao> => {
    const ator = await exigirEscrita();
    if (!id.safeParse(cardId).success || !id.safeParse(entregaId).success) return { erro: "Dados inválidos." };
    return concluir(cardId, await desmarcarEntrega(cardId, entregaId, ator));
  });
}

export async function ajustarDataAction(cardId: string, entregaId: string, novoDia: string, porque: string): Promise<EstadoExecucao> {
  return comTratamento("execucao.ajustarData", async (): Promise<EstadoExecucao> => {
    const ator = await exigirEscrita();
    if (!id.safeParse(cardId).success || !id.safeParse(entregaId).success || !dia.safeParse(novoDia).success || !motivo.safeParse(porque).success) return { erro: "Dados inválidos." };
    return concluir(cardId, await ajustarDataEntrega(cardId, entregaId, { dia: novoDia, motivo: porque }, ator));
  });
}

export async function cancelarEntregaAction(cardId: string, entregaId: string, porque: string): Promise<EstadoExecucao> {
  return comTratamento("execucao.cancelarEntrega", async (): Promise<EstadoExecucao> => {
    const ator = await exigirEscrita();
    if (!id.safeParse(cardId).success || !id.safeParse(entregaId).success || !motivo.safeParse(porque).success) return { erro: "Dados inválidos." };
    return concluir(cardId, await cancelarEntrega(cardId, entregaId, { motivo: porque }, ator));
  });
}

export async function registrarCheckinAction(cardId: string, status: string, porque: string): Promise<EstadoExecucao> {
  return comTratamento("execucao.checkin", async (): Promise<EstadoExecucao> => {
    const ator = await exigirEscrita();
    const s = z.enum(STATUS_CHECKIN).safeParse(status);
    if (!id.safeParse(cardId).success || !s.success || !motivo.safeParse(porque).success) return { erro: "Dados inválidos." };
    return concluir(cardId, await registrarCheckin(cardId, { status: s.data, motivo: porque }, ator));
  });
}
