/**
 * GET /api/projetos/[id]/proposta/pdf?versao=N — PDF da proposta (GAB-89):
 * a versão final (texto + parte estruturada) no template atual. Leitura:
 * qualquer usuário logado (como a página da proposta); sem sessão → 401.
 * `versao` (opcional) fixa a versão que o link baixa: se a final mudou, 409
 * com o texto do porquê (o link do MCP/da tela ficou velho).
 *
 * Gerado na hora (pdf-lib, sem navegador; nada vai para o disco): proposta
 * típica ~60 ms; a maior possível (100 mil caracteres, ~45 páginas) ~0,5 s e
 * ~45 MB de heap no pico — cabe no --max-old-space-size=256 do container.
 */
import { semSessao, respostaTexto, erroInesperado } from "@/lib/anexos/resposta";
import { cabecalhoDownload } from "@/lib/anexos/tipos";
import { usuarioAtual } from "@/lib/auth/atual";
import { mensagemDaFalha, pdfDaProposta } from "@/lib/propostas/propostas";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    if (!(await usuarioAtual())) return semSessao();
    const { id } = await params;
    const bruta = new URL(req.url).searchParams.get("versao");
    const versao = bruta === null ? undefined : /^\d{1,9}$/.test(bruta) ? Number(bruta) : NaN;
    if (Number.isNaN(versao) || id.length > 64) return respostaTexto(400, "Link inválido.");
    const r = await pdfDaProposta(id, versao);
    if (!r.ok) {
      const status = r.erro === "PROJETO_NAO_ENCONTRADO" || r.erro === "PROPOSTA_NAO_ENCONTRADA" || r.erro === "VERSAO_NAO_ENCONTRADA" ? 404 : 409;
      return respostaTexto(status, mensagemDaFalha(r));
    }
    return new Response(new Uint8Array(r.bytes), {
      status: 200,
      headers: {
        "content-type": "application/pdf",
        "content-length": String(r.bytes.length),
        "content-disposition": cabecalhoDownload(r.nomeArquivo),
        "x-content-type-options": "nosniff",
        "cache-control": "private, no-store",
      },
    });
  } catch (e) {
    return erroInesperado("api.proposta.pdf", e);
  }
}
