/**
 * GET /api/avisos — polling do sino (GAB-88). Barato de propósito: sem
 * `?lista=1` é só a contagem dos não lidos do usuário da sessão (uma query no
 * índice usuario_id + lido_em). Com `?lista=1` (sino aberto) traz também os
 * mais recentes. Marcar como lido é server action (`components/shell/sino-actions.ts`).
 */
import { NextResponse } from "next/server";
import { usuarioAtual } from "@/lib/auth/atual";
import { contarNaoLidos, listarAvisos } from "@/lib/avisos/avisos";
import { registrarErro } from "@/lib/erros/registrar";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SEM_CACHE = { "cache-control": "no-store" };

export async function GET(req: Request) {
  try {
    const u = await usuarioAtual();
    if (!u) return NextResponse.json({ erro: "Sessão expirada. Entre de novo." }, { status: 401, headers: SEM_CACHE });
    const lista = new URL(req.url).searchParams.get("lista") === "1";
    const [naoLidos, avisos] = await Promise.all([contarNaoLidos(u.id), lista ? listarAvisos(u.id) : null]);
    return NextResponse.json(avisos ? { naoLidos, avisos } : { naoLidos }, { headers: SEM_CACHE });
  } catch (e) {
    const ref = registrarErro("api.avisos", e);
    return NextResponse.json({ erro: "Erro no servidor.", ref }, { status: 500, headers: SEM_CACHE });
  }
}
