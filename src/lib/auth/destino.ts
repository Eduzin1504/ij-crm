/**
 * Para onde ir depois do login (`?voltar=`), ex.: a tela de autorização do
 * conector MCP (GAB-83). Só caminho INTERNO.
 *
 * Duas barreiras contra open redirect:
 * - recusa caracteres de controle e `\`: o navegador APAGA TAB/CR/LF de URLs e
 *   trata `\` como `/`, então `/\t/evil.com` e `/\evil.com` viram `//evil.com`;
 * - resolve contra uma origem fixa e exige que continue nela, devolvendo só
 *   caminho + query normalizados (o que sair daqui é o que o navegador vê).
 */
const MAX = 4000;
const ORIGEM = "http://ij-crm.interno";

export function destinoSeguro(v: unknown): string | null {
  if (typeof v !== "string" || v.length > MAX) return null;
  // eslint-disable-next-line no-control-regex
  if (!v.startsWith("/") || /[\x00-\x1F\x7F\\]/.test(v)) return null;
  let u: URL;
  try {
    u = new URL(v, ORIGEM);
  } catch {
    return null;
  }
  if (u.origin !== ORIGEM) return null;
  const destino = `${u.pathname}${u.search}`;
  return destino.startsWith("//") ? null : destino;
}
