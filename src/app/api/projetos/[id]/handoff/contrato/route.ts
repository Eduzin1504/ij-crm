/**
 * POST /api/projetos/[id]/handoff/contrato — anexa o PDF assinado pelo checklist
 * de handoff (GAB-93), para quem chegou aqui sem ele. Rota, e não server action,
 * pelo limite de corpo próprio; mesma ordem de defesas de ../../anexos/route.ts.
 * Corpo = o PDF cru; nome em `X-Nome-Arquivo` (encodeURIComponent). As regras são
 * do serviço, o mesmo do MCP.
 */
import { NextResponse } from "next/server";
import { ANEXO_MAX_BYTES, MENSAGEM_ERRO_ANEXO } from "@/lib/anexos/tipos";
import { usuarioAtual } from "@/lib/auth/atual";
import { podeEscrever } from "@/lib/auth/papeis";
import { registrarErro } from "@/lib/erros/registrar";
import { lerCorpo, mesmoSite } from "@/lib/http/upload";
import { anexarContratoNoHandoff, MENSAGEM_ERRO_HANDOFF, type ErroHandoff } from "@/lib/projetos/handoff";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const falha = (status: number, erro: string, ref?: string) => NextResponse.json(ref ? { ok: false, erro, ref } : { ok: false, erro }, { status });

const STATUS: Partial<Record<ErroHandoff, number>> = { SEM_PERMISSAO: 403, CARD_NAO_ENCONTRADO: 404, GRANDE_DEMAIS: 413 };

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const u = await usuarioAtual();
    if (!u) return falha(401, "Sessão expirada. Entre de novo.");
    if (!podeEscrever(u.papel)) return falha(403, "Seu acesso é só de leitura.");
    if (!mesmoSite(req)) return falha(403, "Origem não permitida.");
    const { id } = await params;
    if (id.length > 64) return falha(404, MENSAGEM_ERRO_HANDOFF.CARD_NAO_ENCONTRADO);

    let nome = "";
    try {
      nome = decodeURIComponent(req.headers.get("x-nome-arquivo") ?? "").slice(0, 1000);
    } catch {
      return falha(400, "Dados inválidos.");
    }
    if (!nome.trim()) return falha(400, "Escolha o PDF assinado.");

    const declarado = Number(req.headers.get("content-length") ?? "");
    if (Number.isFinite(declarado) && declarado > ANEXO_MAX_BYTES) return falha(413, MENSAGEM_ERRO_ANEXO.GRANDE_DEMAIS);
    const bytes = await lerCorpo(req, ANEXO_MAX_BYTES);
    if (bytes === null) return falha(413, MENSAGEM_ERRO_ANEXO.GRANDE_DEMAIS);

    const r = await anexarContratoNoHandoff(id, { nome, bytes }, u);
    if (!r.ok) return falha(STATUS[r.erro] ?? 422, MENSAGEM_ERRO_HANDOFF[r.erro]);
    return NextResponse.json({ ok: true, anexo: r.anexo });
  } catch (e) {
    return falha(500, "INESPERADO", registrarErro("api.projetos.handoff.contrato", e));
  }
}
