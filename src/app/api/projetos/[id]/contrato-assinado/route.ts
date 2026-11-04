/**
 * POST /api/projetos/[id]/contrato-assinado — marca o contrato como assinado
 * com o PDF (GAB-99). Rota, e não server action, pelo mesmo motivo do upload de
 * anexos (limite de corpo próprio); mesma ordem de defesas de
 * src/app/api/projetos/[id]/anexos/route.ts. Corpo = o PDF cru; nome em
 * `X-Nome-Arquivo` e valor em `X-Valor-Fechado` (encodeURIComponent). As regras
 * são do serviço, o mesmo do MCP.
 */
import { NextResponse } from "next/server";
import { ANEXO_MAX_BYTES, MENSAGEM_ERRO_ANEXO } from "@/lib/anexos/tipos";
import { usuarioAtual } from "@/lib/auth/atual";
import { podeEscrever } from "@/lib/auth/papeis";
import { registrarErro } from "@/lib/erros/registrar";
import { lerCorpo, mesmoSite } from "@/lib/http/upload";
import { recusaDeEdicaoNoCard } from "@/lib/projetos/acesso-card";
import { MENSAGEM_ERRO_CONTRATO, marcarContratoAssinado, type ErroContratoAssinado } from "@/lib/projetos/contrato-assinado";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const falha = (status: number, erro: string, ref?: string) => NextResponse.json(ref ? { ok: false, erro, ref } : { ok: false, erro }, { status });

const STATUS: Partial<Record<ErroContratoAssinado, number>> = { SEM_PERMISSAO: 403, CARD_NAO_ENCONTRADO: 404, GRANDE_DEMAIS: 413 };

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const u = await usuarioAtual();
    if (!u) return falha(401, "Sessão expirada. Entre de novo.");
    if (!podeEscrever(u.papel)) return falha(403, "Seu acesso é só de leitura.");
    if (!mesmoSite(req)) return falha(403, "Origem não permitida.");
    const { id } = await params;
    if (id.length > 64) return falha(404, MENSAGEM_ERRO_CONTRATO.CARD_NAO_ENCONTRADO);
    const recusa = await recusaDeEdicaoNoCard(id, u);
    if (recusa) return falha(403, recusa);

    let nome = "";
    let valorFechado = "";
    try {
      nome = decodeURIComponent(req.headers.get("x-nome-arquivo") ?? "").slice(0, 1000);
      valorFechado = decodeURIComponent(req.headers.get("x-valor-fechado") ?? "").slice(0, 51);
    } catch {
      return falha(400, "Dados inválidos.");
    }
    if (!nome.trim()) return falha(400, "Escolha o PDF assinado.");

    const declarado = Number(req.headers.get("content-length") ?? "");
    if (Number.isFinite(declarado) && declarado > ANEXO_MAX_BYTES) return falha(413, MENSAGEM_ERRO_ANEXO.GRANDE_DEMAIS);
    const bytes = await lerCorpo(req, ANEXO_MAX_BYTES);
    if (bytes === null) return falha(413, MENSAGEM_ERRO_ANEXO.GRANDE_DEMAIS);

    const r = await marcarContratoAssinado(id, { valorFechado, arquivo: { nome, bytes } }, u);
    if (!r.ok) return falha(STATUS[r.erro] ?? 422, MENSAGEM_ERRO_CONTRATO[r.erro]);
    return NextResponse.json({ ok: true, mudou: r.mudou, anexo: r.anexo });
  } catch (e) {
    return falha(500, "INESPERADO", registrarErro("api.projetos.contratoAssinado", e));
  }
}
