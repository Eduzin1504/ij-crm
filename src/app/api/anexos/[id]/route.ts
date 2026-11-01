/**
 * GET /api/anexos/[id] — download de anexo do Projeto (GAB-84). Qualquer
 * usuário logado (VISUALIZADOR inclusive); anexo excluído ou de card na
 * lixeira → 404. Sem URL pública: sem sessão é 401 (o proxy já barra sem
 * cookie; aqui a sessão é validada de verdade).
 *
 * Sempre `attachment` com o nome sanitizado e o mime detectado pelos bytes no
 * upload (nunca o do cliente). O id é conferido antes de virar caminho no disco.
 */
import { obterAnexoParaDownload } from "@/lib/anexos/anexos";
import { lerArquivo } from "@/lib/anexos/armazenamento";
import { ehIdDeAnexo, erroInesperado, naoEncontrado, SEGURANCA_ANEXO, semSessao } from "@/lib/anexos/resposta";
import { cabecalhoDownload } from "@/lib/anexos/tipos";
import { usuarioAtual } from "@/lib/auth/atual";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    if (!(await usuarioAtual())) return semSessao();
    const { id } = await params;
    if (!ehIdDeAnexo(id)) return naoEncontrado();
    const anexo = await obterAnexoParaDownload(id);
    if (!anexo) return naoEncontrado();
    const bytes = await lerArquivo(anexo.id);
    return new Response(new Uint8Array(bytes), {
      status: 200,
      headers: {
        ...SEGURANCA_ANEXO,
        "content-type": anexo.mime,
        "content-length": String(bytes.length),
        "content-disposition": cabecalhoDownload(anexo.nome),
      },
    });
  } catch (e) {
    return erroInesperado("api.anexos.download", e);
  }
}
