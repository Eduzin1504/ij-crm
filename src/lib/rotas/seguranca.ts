/**
 * Cabeçalhos de segurança do app inteiro, pelo Next (`next.config.ts`): em
 * produção no Coolify não há Caddy na frente para pô-los (o Caddyfile só vale
 * no compose da AWS). Anti-clickjacking: nenhuma página do CRM pode ser
 * embutida em iframe — importa sobretudo para a tela de autorização do
 * conector MCP (GAB-83), onde um clique concede acesso à conta.
 * O app não se embute em lugar nenhum (nenhum iframe próprio).
 *
 * Sem alias `@/`: o next.config importa daqui.
 */
export const CABECALHOS_SEGURANCA = [
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
];

/**
 * Arquivos de anexo (GAB-84) são conteúdo do usuário: além do anti-clickjacking,
 * nada roda (`default-src 'none'; sandbox`). O header do next.config SOBRESCREVE
 * o que a rota põe na resposta (conferido no `next dev`), então a CSP completa
 * precisa vir daqui; a regra mais específica vem depois e vence a geral.
 */
export const CSP_ANEXO = "default-src 'none'; sandbox; frame-ancestors 'none'";

export const HEADERS_APP = [
  { source: "/:path*", headers: CABECALHOS_SEGURANCA },
  { source: "/api/anexos/:path*", headers: [{ key: "Content-Security-Policy", value: CSP_ANEXO }] },
];
