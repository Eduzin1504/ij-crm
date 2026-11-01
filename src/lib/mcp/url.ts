/**
 * Endereços públicos do conector MCP (GAB-83). Tudo deriva de `APP_URL` (o
 * mesmo dos links de convite): o issuer do OAuth, o recurso protegido e os
 * metadados precisam bater exatamente com a URL que a pessoa cola no Claude.
 */
export function urlBase(): string {
  const base = process.env.APP_URL?.replace(/\/+$/, "");
  if (base) return base;
  // Fail-closed em produção: issuer errado = nenhum cliente conecta, em silêncio.
  if (process.env.NODE_ENV === "production") throw new Error("APP_URL não configurada");
  return "http://localhost:3000";
}

/** Recurso protegido (RFC 8707/9728): a URL do servidor MCP. */
export function recursoMcp(): string {
  return `${urlBase()}/api/mcp`;
}

/** Metadados do recurso protegido no caminho do endpoint (RFC 9728 §3.1, inserção de caminho). */
export function urlMetadadosRecurso(): string {
  return `${urlBase()}/.well-known/oauth-protected-resource/api/mcp`;
}
