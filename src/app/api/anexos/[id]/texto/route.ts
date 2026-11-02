/**
 * GET /api/anexos/[id]/texto — texto extraído do anexo no upload (GAB-84),
 * como text/plain para ler na aba. Mesmas regras do download (./../route.ts).
 * Escaneado/imagem (`semTexto`) → 404 explicando: o texto virá do OCR (GAB-90).
 */
import { lerTextoDoAnexo } from "@/lib/anexos/anexos";
import { ehIdDeAnexo, erroInesperado, naoEncontrado, respostaTexto, semSessao } from "@/lib/anexos/resposta";
import { usuarioAtual } from "@/lib/auth/atual";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    if (!(await usuarioAtual())) return semSessao();
    const { id } = await params;
    if (!ehIdDeAnexo(id)) return naoEncontrado();
    const anexo = await lerTextoDoAnexo(id);
    if (!anexo) return naoEncontrado();
    if (anexo.texto === null) return respostaTexto(404, "Anexo sem texto (escaneado ou imagem): o texto vai ser lido pelo OCR, que ainda não existe.");
    return respostaTexto(200, anexo.texto);
  } catch (e) {
    return erroInesperado("api.anexos.texto", e);
  }
}
