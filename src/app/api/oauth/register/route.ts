import { ipDoCliente } from "@/lib/auth/ip";
import { comTratamentoOauth, freioRegistroMcp, jsonOauth } from "@/lib/mcp/http";
import { registrarCliente } from "@/lib/mcp/oauth";

/** Dynamic Client Registration (RFC 7591) do conector MCP (GAB-83). */
export async function POST(req: Request) {
  return comTratamentoOauth("mcp.oauth.registrar", async () => {
    const ip = ipDoCliente(req.headers);
    if (freioRegistroMcp.bloqueado(ip)) {
      return jsonOauth({ error: "invalid_client_metadata", error_description: "Muitos registros deste IP. Tente de novo em uma hora." }, 429);
    }
    freioRegistroMcp.registrarFalha(ip);
    const meta = await req.json().catch(() => null);
    const r = await registrarCliente(meta);
    return r.ok ? jsonOauth(r.cliente, 201) : jsonOauth(r.erro, 400);
  });
}
