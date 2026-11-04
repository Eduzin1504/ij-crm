import type { NextConfig } from "next";
import { REDIRECTS_ROTAS_ANTIGAS } from "./src/lib/rotas/antigas";
import { HEADERS_APP } from "./src/lib/rotas/seguranca";

const nextConfig: NextConfig = {
  // Não gerar AGENTS.md automático no dev (o contexto do projeto vive no design doc / README).
  agentRules: false,
  // Imagem de produção (Dockerfile, estágio `runtime`) roda só o server.js
  // rastreado + node_modules mínimo, sem pnpm nem devDependencies (GAB-30).
  output: "standalone",
  // Sem otimizador (/_next/image): a imagem de produção poda o sharp. Os
  // assets da marca já saem pré-dimensionados em WebP (public/images/marca).
  images: { unoptimized: true },
  // GAB-84: a extração de texto de PDF roda num processo filho
  // (src/lib/anexos/pdf-filho.mjs, via `node`), que nenhum import do servidor
  // alcança: o tracing do standalone precisa copiar o script e o `unpdf` que ele
  // importa. O CI (build.yml) roda o filho de dentro do standalone para conferir.
  // GAB-89/GAB-100: o PDF da proposta (/api/projetos/[id]/proposta/pdf) lê as fontes
  // Arimo e Poppins e as imagens do modelo do disco (src/lib/pdf/fontes.ts), fora do
  // grafo de imports.
  outputFileTracingIncludes: {
    "/api/projetos/**": ["./src/lib/anexos/pdf-filho.mjs", "./node_modules/unpdf/**/*", "./src/lib/pdf/fontes/*", "./src/lib/pdf/imagens/*"],
  },
  // Detalhe do card mudou para /projetos/[id] (GAB-80); links antigos redirecionam.
  async redirects() {
    return REDIRECTS_ROTAS_ANTIGAS;
  },
  // Anti-clickjacking no app todo (GAB-83): no Coolify não há Caddy para pôr estes headers.
  async headers() {
    return HEADERS_APP;
  },
  // App inteiro é autenticado (cookie lido no layout) → tudo é dinâmico por
  // natureza; cacheComponents/PPR não trazem ganho aqui e exigem Suspense em
  // cada rota. Reavaliar se surgir página pública pesada.
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
