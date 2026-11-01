"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { exigirEscrita } from "@/lib/auth/atual";
import { comTratamento, type Inesperado } from "@/lib/erros/registrar";
import { mensagemFalhaPrazo } from "@/lib/prazos/mensagens";
import { criarPrazo, editarPrazo, excluirPrazo, marcarPrazoFeito, type ResultadoPrazo } from "@/lib/prazos/prazos";

export type EstadoPrazoAcao = { erro?: string; ok?: true } | Inesperado;

const id = z.string().min(1).max(64);
const dados = z.object({ titulo: z.string().max(1000), dia: z.string().max(20), responsavelId: id });

function responder(r: ResultadoPrazo): EstadoPrazoAcao {
  if (r.ok) {
    revalidatePath("/calendario");
    revalidatePath("/semana");
    revalidatePath("/projetos/[id]", "page");
    return { ok: true };
  }
  return { erro: mensagemFalhaPrazo(r) };
}

export async function criarPrazoAction(entrada: { titulo: string; dia: string; responsavelId: string; projetoId?: string | null }): Promise<EstadoPrazoAcao> {
  return comTratamento("calendario.criarPrazo", async (): Promise<EstadoPrazoAcao> => {
    const ator = await exigirEscrita();
    const p = dados.extend({ projetoId: id.nullable().optional() }).safeParse(entrada);
    if (!p.success) return { erro: "Dados inválidos." };
    return responder(await criarPrazo(ator, p.data));
  });
}

export async function editarPrazoAction(prazoId: string, entrada: { titulo: string; dia: string; responsavelId: string }): Promise<EstadoPrazoAcao> {
  return comTratamento("calendario.editarPrazo", async (): Promise<EstadoPrazoAcao> => {
    const ator = await exigirEscrita();
    const p = dados.safeParse(entrada);
    if (!id.safeParse(prazoId).success || !p.success) return { erro: "Dados inválidos." };
    return responder(await editarPrazo(ator, prazoId, p.data));
  });
}

export async function concluirPrazoAction(prazoId: string, feito: boolean): Promise<EstadoPrazoAcao> {
  return comTratamento("calendario.concluirPrazo", async (): Promise<EstadoPrazoAcao> => {
    const ator = await exigirEscrita();
    if (!id.safeParse(prazoId).success || typeof feito !== "boolean") return { erro: "Dados inválidos." };
    return responder(await marcarPrazoFeito(ator, prazoId, feito));
  });
}

export async function excluirPrazoAction(prazoId: string): Promise<EstadoPrazoAcao> {
  return comTratamento("calendario.excluirPrazo", async (): Promise<EstadoPrazoAcao> => {
    const ator = await exigirEscrita();
    if (!id.safeParse(prazoId).success) return { erro: "Dados inválidos." };
    return responder(await excluirPrazo(ator, prazoId));
  });
}
