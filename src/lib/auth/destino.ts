/**
 * Para onde ir depois do login (`?voltar=`), ex.: a tela de autorização do
 * conector MCP (GAB-83). Só caminho INTERNO: começa com uma barra e só uma
 * (`//host` e `/\host` o navegador trata como outro site → open redirect).
 */
const MAX = 4000;

export function destinoSeguro(v: unknown): string | null {
  if (typeof v !== "string" || v.length > MAX) return null;
  if (!v.startsWith("/") || v.startsWith("//") || v.startsWith("/\\")) return null;
  return v;
}
