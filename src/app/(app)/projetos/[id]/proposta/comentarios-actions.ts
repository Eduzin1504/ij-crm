"use server";

import { z } from "zod";
import { exigirUsuario } from "@/lib/auth/atual";
import { comTratamento, type Inesperado } from "@/lib/erros/registrar";
import { CONTEXTO_ANCORA, TRECHO_MAX } from "@/lib/propostas/ancora";
import { COMENTARIO_MAX, comentar, MENSAGEM_ERRO_COMENTARIO, reabrirComentario, resolverComentario, responderComentario, type ErroComentario } from "@/lib/propostas/comentarios";

/**
 * Comentários da proposta (GAB-91). O serviço confere se a pessoa está ativa e
 * vê a proposta (GAB-98, `lib/propostas/comentarios.ts`), para a tela e o MCP.
 * Sem revalidatePath: a tela atualiza pelo polling (e já recarrega na hora).
 */
export type RespostaComentario = { ok: true } | { ok: false; erro: string } | Inesperado;

const id = z.string().min(1).max(64);
// Folga sobre o limite: o serviço apara e dá a mensagem certa (TEXTO_LONGO).
const texto = z.string().max(COMENTARIO_MAX * 2);
const ancora = z.object({ trecho: z.string().min(1).max(TRECHO_MAX), antes: z.string().max(CONTEXTO_ANCORA * 2), depois: z.string().max(CONTEXTO_ANCORA * 2) });

const INVALIDO: RespostaComentario = { ok: false, erro: "Dados inválidos." };
const resposta = (r: { ok: true } | { ok: false; erro: ErroComentario }): RespostaComentario => (r.ok ? { ok: true } : { ok: false, erro: MENSAGEM_ERRO_COMENTARIO[r.erro] });

export async function comentarAction(projetoId: string, t: string, trecho: unknown): Promise<RespostaComentario> {
  return comTratamento("proposta.comentar", async () => {
    const eu = await exigirUsuario();
    const a = z.object({ projetoId: id, texto, trecho: ancora.nullable() }).safeParse({ projetoId, texto: t, trecho: trecho ?? null });
    if (!a.success) return INVALIDO;
    return resposta(await comentar(a.data.projetoId, { texto: a.data.texto, trecho: a.data.trecho }, eu));
  });
}

export async function responderComentarioAction(comentarioId: string, t: string): Promise<RespostaComentario> {
  return comTratamento("proposta.responderComentario", async () => {
    const eu = await exigirUsuario();
    const a = z.object({ comentarioId: id, texto }).safeParse({ comentarioId, texto: t });
    if (!a.success) return INVALIDO;
    return resposta(await responderComentario(a.data.comentarioId, a.data.texto, eu));
  });
}

export async function resolverComentarioAction(comentarioId: string, resolver: boolean): Promise<RespostaComentario> {
  return comTratamento("proposta.resolverComentario", async () => {
    const eu = await exigirUsuario();
    const a = id.safeParse(comentarioId);
    if (!a.success || typeof resolver !== "boolean") return INVALIDO;
    return resposta(await (resolver ? resolverComentario(a.data, eu) : reabrirComentario(a.data, eu)));
  });
}
