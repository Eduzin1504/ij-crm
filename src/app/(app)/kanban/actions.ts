"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { exigirEscrita, exigirUsuario } from "@/lib/auth/atual";
import { comTratamento, type Inesperado } from "@/lib/erros/registrar";
import { descricaoSchema, ehCampoEditavel, interpretarCampo } from "@/lib/projetos/campos";
import { recusaDeCriarNoQuadro, recusaDeEdicaoNoCard } from "@/lib/projetos/acesso-card";
import { MENSAGEM_ERRO_PROJETO } from "@/lib/projetos/erros";
import { adicionarNota, criarCard, editarCard, moverCard } from "@/lib/projetos/projetos";
import type { DadosTerminal } from "@/lib/projetos/terminal-regras";
import { salvarVisualizacaoKanban } from "@/lib/preferencias/servico";

// Mesmo texto na tela e no conector MCP (GAB-83).
const MENSAGEM = MENSAGEM_ERRO_PROJETO;

/**
 * `erro` de regra = texto pronto em português. Exceção inesperada vira
 * `{ ok: false, erro: "INESPERADO", ref }` (logada com a ref; ver `registrarErro`).
 */
export type EstadoKanban = { erro?: string; ok?: true; /** id do card criado. */ id?: string } | Inesperado;

const id = z.string().min(1).max(64);

function revalidar(cardId?: string) {
  revalidatePath("/kanban");
  if (cardId) revalidatePath(`/projetos/${cardId}`);
}

/** `descricao`: opcional (formulário do + no Kanban). */
export async function criarCardAction(pipelineId: string, faseId: string, titulo: string, descricao?: string): Promise<EstadoKanban> {
  return comTratamento("kanban.criarCard", async (): Promise<EstadoKanban> => {
    const ator = await exigirEscrita();
    const p = z.object({ pipelineId: id, faseId: id, titulo: z.string().max(1000) }).safeParse({ pipelineId, faseId, titulo });
    if (!p.success) return { erro: "Dados inválidos." };
    const d = descricaoSchema.safeParse(descricao);
    if (!d.success) return { erro: d.error.issues[0].message };
    const recusa = await recusaDeCriarNoQuadro({ pipelineId: p.data.pipelineId }, ator);
    if (recusa) return { erro: recusa };
    const r = await criarCard({ ...p.data, descricao: d.data }, ator);
    if (!r.ok) return { erro: MENSAGEM[r.erro] };
    revalidar();
    return { ok: true, id: r.id };
  });
}

// Só a forma (strings curtas); o conteúdo é validado no gancho, dentro da transação.
const dadosTerminal = z
  .object({ valorFechado: z.string().max(50), motivo: z.string().max(50), detalhe: z.string().max(2000) })
  .partial()
  .strict();

/** `dados`: o que o diálogo de ganho/perdido coletou (ver `terminal-regras.ts`). */
export async function moverCardAction(cardId: string, paraFaseId: string, dados?: DadosTerminal): Promise<EstadoKanban> {
  return comTratamento("kanban.moverCard", async (): Promise<EstadoKanban> => {
    const ator = await exigirEscrita();
    if (!id.safeParse(cardId).success || !id.safeParse(paraFaseId).success) return { erro: "Dados inválidos." };
    const d = dadosTerminal.optional().safeParse(dados);
    if (!d.success) return { erro: "Dados inválidos." };
    const recusa = await recusaDeEdicaoNoCard(cardId, ator);
    if (recusa) return { erro: recusa };
    const r = await moverCard(cardId, paraFaseId, ator, { dadosTerminal: d.data });
    if (!r.ok) return { erro: MENSAGEM[r.erro] };
    revalidar(cardId);
    return { ok: true };
  });
}

export async function editarCampoAction(cardId: string, campo: string, bruto: string): Promise<EstadoKanban> {
  return comTratamento("kanban.editarCampo", async (): Promise<EstadoKanban> => {
    const ator = await exigirEscrita();
    if (!id.safeParse(cardId).success || !ehCampoEditavel(campo) || typeof bruto !== "string" || bruto.length > 10_000) {
      return { erro: "Dados inválidos." };
    }
    const v = interpretarCampo(campo, bruto);
    if (!v.ok) return { erro: v.erro };
    const recusa = await recusaDeEdicaoNoCard(cardId, ator);
    if (recusa) return { erro: recusa };
    const r = await editarCard(cardId, { [campo]: v.valor }, ator);
    if (!r.ok) return { erro: MENSAGEM[r.erro] };
    revalidar(cardId);
    return { ok: true };
  });
}

/** `nota` (GAB-85): avaliação do contato de 1 a 5, opcional (null/ausente = sem nota). */
export async function adicionarNotaAction(cardId: string, texto: string, nota: number | null = null): Promise<EstadoKanban> {
  return comTratamento("kanban.adicionarNota", async (): Promise<EstadoKanban> => {
    const ator = await exigirEscrita();
    if (!id.safeParse(cardId).success || typeof texto !== "string") return { erro: "Dados inválidos." };
    const r = await adicionarNota(cardId, texto, ator, { nota });
    if (!r.ok) return { erro: MENSAGEM[r.erro] };
    revalidar(cardId);
    return { ok: true };
  });
}

/**
 * Visualização do quadro (mostrar vazias, colunas abertas à mão) do usuário
 * DA SESSÃO: não recebe id de usuário, então ninguém grava a de outro. Sem
 * revalidate: a UI já aplicou otimista e o próximo render lê do banco.
 */
export async function salvarVisualizacaoKanbanAction(pipelineChave: string, visualizacao: { mostrarVazias: boolean; abertas: string[] }): Promise<EstadoKanban> {
  return comTratamento("kanban.salvarVisualizacao", async (): Promise<EstadoKanban> => {
    const ator = await exigirUsuario();
    if (!id.safeParse(pipelineChave).success) return { erro: "Dados inválidos." };
    const r = await salvarVisualizacaoKanban(ator.id, pipelineChave, visualizacao);
    if (!r.ok) return { erro: r.erro === "QUADRO_INEXISTENTE" ? "Quadro não encontrado." : "Dados inválidos." };
    return { ok: true };
  });
}
