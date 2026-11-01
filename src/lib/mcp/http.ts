/**
 * Respostas HTTP dos endpoints OAuth (`/api/oauth/*`). Formato das RFCs
 * (`error`/`error_description`), `no-store` em tudo que carrega token. Exceção
 * inesperada → 500 `server_error` com a `ref` do log na descrição.
 */
import { Limitador } from "@/lib/auth/limitador";
import { mensagemInesperada, registrarErro } from "@/lib/erros/registrar";

export function jsonOauth(corpo: object, status = 200): Response {
  return Response.json(corpo, { status, headers: { "Cache-Control": "no-store", Pragma: "no-cache" } });
}

export async function comTratamentoOauth(contexto: string, corpo: () => Promise<Response>): Promise<Response> {
  try {
    return await corpo();
  } catch (e) {
    const ref = registrarErro(contexto, e);
    return jsonOauth({ error: "server_error", error_description: mensagemInesperada(ref) }, 500);
  }
}

/** Form-urlencoded (RFC 6749 §4.1.3) → objeto; aceita JSON também, por tolerância. */
export async function lerFormulario(req: Request): Promise<Record<string, string | undefined>> {
  const tipo = req.headers.get("content-type") ?? "";
  if (tipo.includes("application/json")) {
    const j = (await req.json().catch(() => null)) as Record<string, unknown> | null;
    return Object.fromEntries(Object.entries(j ?? {}).flatMap(([k, v]) => (typeof v === "string" ? [[k, v]] : [])));
  }
  const p = new URLSearchParams(await req.text());
  return Object.fromEntries(p.entries());
}

// DCR é aberto (sem login): freio por IP. 20 registros/hora bastam para ≤15 pessoas reconectando.
const g = globalThis as unknown as { freioRegistroMcp?: Limitador };
export const freioRegistroMcp = (g.freioRegistroMcp ??= new Limitador({ maxFalhas: 20, janelaMs: 60 * 60 * 1000 }));
