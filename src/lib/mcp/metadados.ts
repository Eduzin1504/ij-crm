/**
 * Documentos de descoberta do OAuth do conector MCP (GAB-83):
 * - recurso protegido (RFC 9728): diz ao Claude qual servidor de autorização usar;
 * - servidor de autorização (RFC 8414): endpoints e capacidades.
 * O issuer é a raiz do app (sem caminho), então o Claude acha os metadados em
 * `/.well-known/oauth-authorization-server`.
 */
import { ESCOPO } from "./oauth";
import { recursoMcp, urlBase } from "./url";

export function metadadosRecurso() {
  return {
    resource: recursoMcp(),
    authorization_servers: [urlBase()],
    scopes_supported: [ESCOPO],
    bearer_methods_supported: ["header"],
    resource_name: "ij-crm",
  };
}

export function metadadosServidorAutorizacao() {
  const base = urlBase();
  return {
    issuer: base,
    authorization_endpoint: `${base}/oauth/autorizar`,
    token_endpoint: `${base}/api/oauth/token`,
    registration_endpoint: `${base}/api/oauth/register`,
    revocation_endpoint: `${base}/api/oauth/revoke`,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: ["none"],
    revocation_endpoint_auth_methods_supported: ["none"],
    scopes_supported: [ESCOPO],
    authorization_response_iss_parameter_supported: true,
  };
}

/** JSON público e cacheável por pouco tempo (muda só se APP_URL mudar). */
export function respostaMetadados(corpo: object): Response {
  return Response.json(corpo, { headers: { "Cache-Control": "public, max-age=300", "Access-Control-Allow-Origin": "*" } });
}
