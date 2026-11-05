/**
 * GET /api/projetos/[id]/proposta/pdf?versao=N — PDF da proposta (GAB-89):
 * a versão final (texto + parte estruturada) no template atual. Leitura:
 * quem vê a proposta (GAB-98, como a página dela); sem sessão → 401, sem acesso → 403.
 * `versao` (opcional) fixa a versão que o link baixa: se a final mudou, 409
 * com o texto do porquê (o link do MCP/da tela ficou velho).
 * `rascunho=1` (GAB-100, "Ver PDF"): prévia do rascunho atual, aberta no navegador.
 *
 * Gerado na hora (pdf-lib, sem navegador; nada vai para o disco): com as imagens do modelo, proposta
 * típica ~0,2 s; a maior possível (100 mil caracteres, ~45 páginas) ~0,5 s e
 * ~45 MB de heap no pico — cabe no --max-old-space-size=256 do container.
 * No máximo GERACOES_PDF_MAX ao mesmo tempo no processo: acima disso, 503 com
 * a ref (a mesma do log) e `retry-after`.
 */
import { semSessao, respostaTexto, erroInesperado } from "@/lib/anexos/resposta";
import { cabecalhoDownload } from "@/lib/anexos/tipos";
import { usuarioAtual } from "@/lib/auth/atual";
import { MENSAGEM_SEM_ACESSO_PROPOSTA, podeVerPropostaDoProjeto } from "@/lib/propostas/acesso";
import { GERACOES_PDF_MAX, mensagemDaFalha, pdfDaProposta, pdfDoRascunho } from "@/lib/propostas/propostas";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const eu = await usuarioAtual();
    if (!eu) return semSessao();
    const { id } = await params;
    const busca = new URL(req.url).searchParams;
    const rascunho = busca.get("rascunho") === "1";
    const bruta = busca.get("versao");
    const versao = bruta === null ? undefined : /^\d{1,9}$/.test(bruta) ? Number(bruta) : NaN;
    if (Number.isNaN(versao) || id.length > 64) return respostaTexto(400, "Link inválido.");
    if (!(await podeVerPropostaDoProjeto(eu, id))) return respostaTexto(403, MENSAGEM_SEM_ACESSO_PROPOSTA);
    const r = rascunho ? await pdfDoRascunho(id) : await pdfDaProposta(id, versao);
    if (!r.ok && r.erro === "PDF_OCUPADO") {
      // Não é falha do servidor, mas fica rastreável: a mesma ref no corpo, no header e no log.
      const ref = crypto.randomUUID().replace(/-/g, "").slice(0, 8);
      console.warn(`[api.proposta.pdf] ref=${ref} PDF_OCUPADO limite=${GERACOES_PDF_MAX} projeto=${id}`);
      return respostaTexto(503, `${mensagemDaFalha(r)} (ref: ${ref})`, { "x-erro-ref": ref, "retry-after": "5" });
    }
    if (!r.ok) {
      const status = r.erro === "PROJETO_NAO_ENCONTRADO" || r.erro === "PROPOSTA_NAO_ENCONTRADA" || r.erro === "VERSAO_NAO_ENCONTRADA" ? 404 : 409;
      return respostaTexto(status, mensagemDaFalha(r));
    }
    return new Response(new Uint8Array(r.bytes), {
      status: 200,
      headers: {
        "content-type": "application/pdf",
        "content-length": String(r.bytes.length),
        "content-disposition": rascunho ? cabecalhoDownload(r.nomeArquivo).replace(/^attachment/, "inline") : cabecalhoDownload(r.nomeArquivo),
        "x-content-type-options": "nosniff",
        "cache-control": "private, no-store",
      },
    });
  } catch (e) {
    return erroInesperado("api.proposta.pdf", e);
  }
}
