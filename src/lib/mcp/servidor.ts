/**
 * Endpoint MCP (`/api/mcp`, transporte Streamable HTTP do SDK oficial).
 *
 * Sem estado: cada POST traz o Bearer, monta um `McpServer` para a pessoa do
 * token e responde em JSON (sem SSE nem sessão em memória). Leve para ≤15
 * pessoas e sobrevive a reinício do container. GET/DELETE (stream de
 * notificações e fim de sessão) não existem sem sessão: 405, como o SDK
 * documenta para o modo stateless.
 *
 * Sem token válido → 401 com `WWW-Authenticate: Bearer resource_metadata=…`:
 * é o que faz o Claude descobrir o OAuth e abrir o login (o 401 é obrigatório).
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { mensagemInesperada, registrarErro } from "@/lib/erros/registrar";
import { executarFerramenta, FERRAMENTAS } from "./ferramentas";
import { autenticarAcesso, ESCOPO, type UsuarioMcp } from "./oauth";
import { urlMetadadosRecurso } from "./url";

export const NOME_SERVIDOR = "ij-crm";

const INSTRUCOES =
  "CRM da Inteli Júnior. Você age em nome da pessoa conectada, com as mesmas permissões do papel dela no CRM. " +
  "Comece por listar_fases (ids de quadros e fases) e buscar_projetos. Tudo que você grava aparece na Timeline do projeto como \"via MCP\". " +
  "Proposta (uma por projeto): ler_proposta devolve o Markdown, a parte estruturada e a revisão; editar_proposta e salvar_versao_proposta pedem essa revisão (conflito = alguém mexeu depois: leia de novo). " +
  "Excluir de vez, mesclar contatos e configurações ficam só na tela do CRM.";

/**
 * 401 do recurso. O header leva só ASCII (`error_description` em inglês: header
 * HTTP com acento quebra parser); o texto em português vai no corpo.
 */
function naoAutorizado(invalido = false): Response {
  const partes = [`resource_metadata="${urlMetadadosRecurso()}"`, `scope="${ESCOPO}"`];
  if (invalido) partes.unshift(`error="invalid_token"`, `error_description="Token invalid, expired or revoked"`);
  return Response.json(
    { erro: invalido ? "Token inválido, vencido ou revogado. Conecte de novo." : "Autenticação necessária." },
    { status: 401, headers: { "WWW-Authenticate": `Bearer ${partes.join(", ")}`, "Cache-Control": "no-store" } },
  );
}

/** Servidor MCP da pessoa: as ferramentas de `FERRAMENTAS`, executadas com o papel dela. */
export function criarServidorMcp(eu: UsuarioMcp): McpServer {
  const servidor = new McpServer({ name: NOME_SERVIDOR, version: "1.0.0" }, { instructions: INSTRUCOES });
  for (const f of FERRAMENTAS) {
    servidor.registerTool(
      f.nome,
      { title: f.titulo, description: f.descricao, inputSchema: f.entrada, annotations: { readOnlyHint: !f.escrita, destructiveHint: false, openWorldHint: false } },
      (args: unknown) => executarFerramenta(f.nome, args, eu),
    );
  }
  return servidor;
}

/** Bearer do header Authorization (nunca da query: a spec proíbe token na URL). */
function bearer(req: Request): string | null {
  const m = /^Bearer\s+(\S+)$/i.exec(req.headers.get("authorization") ?? "");
  return m ? m[1] : null;
}

export async function atenderMcp(req: Request): Promise<Response> {
  const token = bearer(req);
  if (!token) return naoAutorizado();
  try {
    const sessao = await autenticarAcesso(token);
    if (!sessao) return naoAutorizado(true);
    if (req.method !== "POST") {
      return Response.json({ erro: "Método não suportado (servidor sem sessão: só POST)." }, { status: 405, headers: { Allow: "POST" } });
    }
    const servidor = criarServidorMcp(sessao.usuario);
    const transporte = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    await servidor.connect(transporte);
    return await transporte.handleRequest(req);
  } catch (e) {
    // Falha fora de uma ferramenta (banco caiu na autenticação, SDK): JSON-RPC de erro com a ref do log.
    const ref = registrarErro("mcp.requisicao", e);
    return Response.json({ jsonrpc: "2.0", error: { code: -32603, message: mensagemInesperada(ref) }, id: null }, { status: 500 });
  }
}
