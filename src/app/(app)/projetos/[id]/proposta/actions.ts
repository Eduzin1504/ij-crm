"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { exigirEscrita } from "@/lib/auth/atual";
import { comTratamento, type Inesperado } from "@/lib/erros/registrar";
import type { ConflitoCliente } from "@/lib/propostas/autosave";
import type { Documento } from "@/lib/propostas/documento";
import { estruturadoParaEntrada, type FormularioEstruturado } from "@/lib/propostas/estruturado";
import { markdownParaDocumento } from "@/lib/propostas/markdown";
import { criarProposta, mensagemDaFalha, salvarRascunho, salvarVersao, type Falha } from "@/lib/propostas/propostas";

/** Conflito para a tela: o estado atual do servidor já como documento do editor. */
export type ConflitoUI = ConflitoCliente & { documento: Documento; estruturado: FormularioEstruturado };

/**
 * `erro` = texto pronto; `conflito` quando outra aba/pessoa/o MCP gravou
 * antes (nada foi sobrescrito). Exceção → `INESPERADO` com a `ref` do log.
 */
export type RespostaProposta = { ok: true; revisao: number; numero?: number } | { ok?: false; erro: string; conflito?: ConflitoUI } | Inesperado;

const id = z.string().min(1).max(64);
const revisaoSchema = z.number().int().min(0);

function falhaParaTela(f: Falha): RespostaProposta {
  if (f.erro !== "CONFLITO") return { ok: false, erro: mensagemDaFalha(f) };
  const c = f.conflito;
  return {
    ok: false,
    erro: mensagemDaFalha(f),
    conflito: {
      revisao: c.revisao,
      por: c.por,
      viaMcp: c.viaMcp,
      em: c.em?.toISOString() ?? null,
      documento: markdownParaDocumento(c.markdown),
      estruturado: estruturadoParaEntrada(c.estruturado),
    },
  };
}

function revalidar(projetoId: string) {
  revalidatePath(`/projetos/${projetoId}`);
  revalidatePath(`/projetos/${projetoId}/proposta`);
  revalidatePath("/propostas");
  revalidatePath("/kanban");
}

export async function criarPropostaAction(projetoId: string): Promise<RespostaProposta> {
  return comTratamento("proposta.criar", async (): Promise<RespostaProposta> => {
    const ator = await exigirEscrita();
    if (!id.safeParse(projetoId).success) return { erro: "Dados inválidos." };
    const r = await criarProposta(projetoId, ator);
    if (!r.ok) return falhaParaTela(r);
    revalidar(projetoId);
    return { ok: true, revisao: r.revisao };
  });
}

/** Autosave do texto (JSON do editor; o servidor valida e converte para Markdown). */
export async function salvarTextoAction(projetoId: string, revisao: number, documento: unknown): Promise<RespostaProposta> {
  return comTratamento("proposta.salvarTexto", async (): Promise<RespostaProposta> => {
    const ator = await exigirEscrita();
    if (!id.safeParse(projetoId).success || !revisaoSchema.safeParse(revisao).success) return { erro: "Dados inválidos." };
    const r = await salvarRascunho(projetoId, { revisao, conteudo: { documento } }, ator);
    if (!r.ok) return falhaParaTela(r);
    return { ok: true, revisao: r.revisao };
  });
}

export async function salvarEstruturadoAction(projetoId: string, revisao: number, estruturado: unknown): Promise<RespostaProposta> {
  return comTratamento("proposta.salvarEstruturado", async (): Promise<RespostaProposta> => {
    const ator = await exigirEscrita();
    if (!id.safeParse(projetoId).success || !revisaoSchema.safeParse(revisao).success) return { erro: "Dados inválidos." };
    const r = await salvarRascunho(projetoId, { revisao, estruturado }, ator);
    if (!r.ok) return falhaParaTela(r);
    revalidatePath("/propostas");
    return { ok: true, revisao: r.revisao };
  });
}

/** "Salvar versão": manda junto o texto do editor e a parte estruturada do formulário. */
export async function salvarVersaoAction(
  projetoId: string,
  revisao: number,
  dados: { documento?: unknown; estruturado?: unknown; nota?: string },
): Promise<RespostaProposta> {
  return comTratamento("proposta.salvarVersao", async (): Promise<RespostaProposta> => {
    const ator = await exigirEscrita();
    if (!id.safeParse(projetoId).success || !revisaoSchema.safeParse(revisao).success || (dados.nota !== undefined && typeof dados.nota !== "string")) {
      return { erro: "Dados inválidos." };
    }
    const r = await salvarVersao(
      projetoId,
      {
        revisao,
        nota: dados.nota,
        ...(dados.documento !== undefined ? { conteudo: { documento: dados.documento } } : {}),
        ...(dados.estruturado !== undefined ? { estruturado: dados.estruturado } : {}),
      },
      ator,
    );
    if (!r.ok) return falhaParaTela(r);
    revalidar(projetoId);
    return { ok: true, revisao: r.revisao, numero: r.numero };
  });
}
