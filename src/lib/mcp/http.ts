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

/** Maior corpo aceito nos endpoints OAuth (um registro DCR real tem < 2 KB). */
export const CORPO_MAX = 16 * 1024;

/**
 * Corpo como texto, no máximo `CORPO_MAX` bytes: recusa pelo Content-Length e
 * também lendo o stream (o header pode faltar ou mentir). `null` = grande demais.
 */
export async function lerCorpoLimitado(req: Request, max = CORPO_MAX): Promise<string | null> {
  const declarado = Number(req.headers.get("content-length") ?? "0");
  if (declarado > max) return null;
  if (!req.body) return "";
  const leitor = req.body.getReader();
  const partes: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await leitor.read();
    if (done) break;
    total += value.byteLength;
    if (total > max) {
      await leitor.cancel();
      return null;
    }
    partes.push(value);
  }
  return new TextDecoder().decode(Buffer.concat(partes));
}

/**
 * Form-urlencoded (RFC 6749 §4.1.3) → objeto; aceita JSON também, por
 * tolerância. Corpo acima de `CORPO_MAX` vira `{}` (o endpoint responde invalid_request).
 */
export async function lerFormulario(req: Request): Promise<Record<string, string | undefined>> {
  const corpo = await lerCorpoLimitado(req);
  if (corpo === null) return {};
  if ((req.headers.get("content-type") ?? "").includes("application/json")) {
    let j: unknown = null;
    try {
      j = JSON.parse(corpo);
    } catch {
      return {};
    }
    if (!j || typeof j !== "object") return {};
    return Object.fromEntries(Object.entries(j).flatMap(([k, v]) => (typeof v === "string" ? [[k, v]] : [])));
  }
  return Object.fromEntries(new URLSearchParams(corpo).entries());
}

// DCR é aberto (sem login): freio por IP. 20 registros/hora bastam para ≤15 pessoas reconectando.
const g = globalThis as unknown as { freioRegistroMcp?: Limitador };
export const freioRegistroMcp = (g.freioRegistroMcp ??= new Limitador({ maxFalhas: 20, janelaMs: 60 * 60 * 1000 }));
