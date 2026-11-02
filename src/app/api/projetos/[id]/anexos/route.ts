/**
 * POST /api/projetos/[id]/anexos — upload de anexo do Projeto (GAB-84). Route
 * handler (não server action) pelo mesmo motivo do import do Pipefy: limite de
 * corpo próprio (`ANEXO_MAX_BYTES`) sem subir o das actions.
 *
 * Ordem: sessão e escrita PRIMEIRO (401/403 em JSON, sem ler o corpo), origem
 * do mesmo site, Content-Length acima do limite → 413; sem Content-Length os
 * bytes são contados no streaming. Corpo = o arquivo cru; nome no header
 * `X-Nome-Arquivo` (encodeURIComponent). Tipo e tamanho são validados de novo
 * no serviço, pelos bytes (src/lib/anexos/tipos.ts) — o `Content-Type` do
 * cliente é ignorado.
 */
import { NextResponse } from "next/server";
import { anexarArquivo } from "@/lib/anexos/anexos";
import { ANEXO_MAX_BYTES, MENSAGEM_ERRO_ANEXO, type ErroAnexo } from "@/lib/anexos/tipos";
import { usuarioAtual } from "@/lib/auth/atual";
import { podeEscrever } from "@/lib/auth/papeis";
import { registrarErro } from "@/lib/erros/registrar";
import { lerCorpo, mesmoSite } from "@/lib/http/upload";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const falha = (status: number, erro: string, ref?: string) => NextResponse.json(ref ? { ok: false, erro, ref } : { ok: false, erro }, { status });

const STATUS: Partial<Record<ErroAnexo, number>> = { SEM_PERMISSAO: 403, CARD_NAO_ENCONTRADO: 404, DUPLICADO: 409, GRANDE_DEMAIS: 413 };

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const u = await usuarioAtual();
    if (!u) return falha(401, "Sessão expirada. Entre de novo.");
    if (!podeEscrever(u.papel)) return falha(403, "Seu acesso é só de leitura: não dá para anexar arquivos.");
    if (!mesmoSite(req)) return falha(403, "Origem não permitida.");
    const { id } = await params;
    if (id.length > 64) return falha(404, MENSAGEM_ERRO_ANEXO.CARD_NAO_ENCONTRADO);

    let nome = "";
    try {
      nome = decodeURIComponent(req.headers.get("x-nome-arquivo") ?? "").slice(0, 1000);
    } catch {
      return falha(400, "Nome de arquivo inválido.");
    }
    if (!nome.trim()) return falha(400, "Escolha um arquivo.");

    const declarado = Number(req.headers.get("content-length") ?? "");
    if (Number.isFinite(declarado) && declarado > ANEXO_MAX_BYTES) return falha(413, MENSAGEM_ERRO_ANEXO.GRANDE_DEMAIS);
    const bytes = await lerCorpo(req, ANEXO_MAX_BYTES);
    if (bytes === null) return falha(413, MENSAGEM_ERRO_ANEXO.GRANDE_DEMAIS);

    const r = await anexarArquivo(id, { nome, bytes }, u);
    if (!r.ok) return falha(STATUS[r.erro] ?? 422, MENSAGEM_ERRO_ANEXO[r.erro]);
    return NextResponse.json({ ok: true, anexo: r.anexo }, { status: 201 });
  } catch (e) {
    return falha(500, "INESPERADO", registrarErro("api.projetos.anexos", e));
  }
}
