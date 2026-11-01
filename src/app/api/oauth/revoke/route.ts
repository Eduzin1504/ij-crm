import { comTratamentoOauth, jsonOauth, lerFormulario } from "@/lib/mcp/http";
import { revogarToken } from "@/lib/mcp/oauth";

/** RFC 7009: revoga a conexão do token. Sempre 200, mesmo para token desconhecido. */
export async function POST(req: Request) {
  return comTratamentoOauth("mcp.oauth.revogar", async () => {
    const { token } = await lerFormulario(req);
    if (!token) return jsonOauth({ error: "invalid_request", error_description: "Falta token." }, 400);
    await revogarToken(token);
    return new Response(null, { status: 200, headers: { "Cache-Control": "no-store" } });
  });
}
