import { comTratamentoOauth, jsonOauth, lerFormulario } from "@/lib/mcp/http";
import { emitirToken } from "@/lib/mcp/oauth";

/** Token endpoint (OAuth 2.1): authorization_code + PKCE e refresh_token com rotação. */
export async function POST(req: Request) {
  return comTratamentoOauth("mcp.oauth.token", async () => {
    const r = await emitirToken(await lerFormulario(req));
    if (r.ok) return jsonOauth(r.token);
    return jsonOauth(r.erro, r.erro.error === "invalid_client" ? 401 : 400);
  });
}
