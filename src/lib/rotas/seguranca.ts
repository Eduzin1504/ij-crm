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

export const HEADERS_APP = [{ source: "/:path*", headers: CABECALHOS_SEGURANCA }];
