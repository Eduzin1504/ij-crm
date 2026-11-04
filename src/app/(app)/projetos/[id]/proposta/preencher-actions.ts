"use server";

import { z } from "zod";
import { exigirEscrita } from "@/lib/auth/atual";
import { comTratamento, type Inesperado } from "@/lib/erros/registrar";
import type { Documento } from "@/lib/propostas/documento";
import { markdownParaDocumento } from "@/lib/propostas/markdown";
import { recusaDaProposta } from "@/lib/propostas/acesso";
import { sugerirDeAnexo } from "@/lib/propostas/preenchimento";
import type { Sugestao } from "@/lib/propostas/sugestao";

/** Sugestão para a tela: o texto já como documento do editor. */
export type SugestaoUI = Omit<Sugestao, "markdown"> & { documento: Documento };

export type RespostaSugestao = { ok: true; sugestao: SugestaoUI } | { ok: false; erro: string; ref?: string } | Inesperado;

const id = z.string().min(1).max(64);

/**
 * "Usar arquivo como base" (GAB-90): só LÊ e sugere — nada é gravado aqui.
 * Aplicar é pelo editor, que grava pelas actions de sempre (autosave do texto
 * e "Salvar dados"), com a revisão atual. Falha da IA → texto + `ref` do log.
 */
export async function sugerirDeAnexoAction(projetoId: string, anexoId: string): Promise<RespostaSugestao> {
  return comTratamento("proposta.sugerirDeAnexo", async (): Promise<RespostaSugestao> => {
    const ator = await exigirEscrita();
    if (!id.safeParse(projetoId).success || !id.safeParse(anexoId).success) return { ok: false, erro: "Dados inválidos." };
    const recusa = await recusaDaProposta(projetoId, ator);
    if (recusa) return { ok: false, erro: recusa };
    const r = await sugerirDeAnexo(projetoId, anexoId, ator);
    if (!r.ok) return { ok: false, erro: r.mensagem, ...(r.ref ? { ref: r.ref } : {}) };
    const { markdown, ...resto } = r.sugestao;
    return { ok: true, sugestao: { ...resto, documento: markdownParaDocumento(markdown) } };
  });
}
