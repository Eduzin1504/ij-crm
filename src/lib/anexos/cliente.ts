/**
 * Upload de anexo pelo navegador (GAB-84; reaproveitado pela proposta no
 * GAB-90). Vai pela rota (não por server action): limite próprio e erros em
 * JSON (src/app/api/projetos/[id]/anexos/route.ts). Tipo e tamanho são
 * conferidos de novo no servidor, pelos bytes; aqui o tamanho só evita subir à toa.
 */
import { FALHA_CONEXAO, type FalhaUI } from "@/lib/erros/cliente";
import { ANEXO_MAX_BYTES, MENSAGEM_ERRO_ANEXO } from "./tipos";

export type AnexoEnviado = { id: string; nome: string; semTexto: boolean };

export async function enviarAnexo(cardId: string, arquivo: File): Promise<{ ok: true; anexo: AnexoEnviado } | { ok: false; falha: FalhaUI }> {
  if (arquivo.size > ANEXO_MAX_BYTES) return { ok: false, falha: { texto: MENSAGEM_ERRO_ANEXO.GRANDE_DEMAIS } };
  let res: Response;
  try {
    res = await fetch(`/api/projetos/${encodeURIComponent(cardId)}/anexos`, {
      method: "POST",
      body: arquivo,
      headers: { "Content-Type": "application/octet-stream", "X-Nome-Arquivo": encodeURIComponent(arquivo.name) },
    });
  } catch {
    return { ok: false, falha: FALHA_CONEXAO };
  }
  let corpo: { ok?: boolean; erro?: string; ref?: string; anexo?: AnexoEnviado };
  try {
    corpo = (await res.json()) as typeof corpo;
  } catch {
    return { ok: false, falha: { texto: `Resposta inesperada do servidor (HTTP ${res.status}). Tente de novo.` } };
  }
  if (corpo.ok && corpo.anexo) return { ok: true, anexo: corpo.anexo };
  if (corpo.erro === "INESPERADO") return { ok: false, falha: { texto: "Não foi possível anexar o arquivo. Erro no servidor.", ref: corpo.ref } };
  return { ok: false, falha: { texto: corpo.erro ?? `Falha ao anexar (HTTP ${res.status}).` } };
}
