-- GAB-83: conector MCP (OAuth 2.1 + PKCE). Só aditiva e idempotente: coluna
-- nova com default na Timeline e três tabelas novas. A versão anterior do app
-- ignora tudo isso.

ALTER TABLE "timeline" ADD COLUMN IF NOT EXISTS "via_mcp" BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS "oauth_cliente" (
    "id" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "redirect_uris" TEXT[],
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "oauth_cliente_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "oauth_codigo" (
    "id" TEXT NOT NULL,
    "cliente_id" TEXT NOT NULL,
    "usuario_id" TEXT NOT NULL,
    "redirect_uri" TEXT NOT NULL,
    "code_challenge" TEXT NOT NULL,
    "escopo" TEXT NOT NULL,
    "expira_em" TIMESTAMP(3) NOT NULL,
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "oauth_codigo_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "mcp_conexao" (
    "id" TEXT NOT NULL,
    "usuario_id" TEXT NOT NULL,
    "cliente_id" TEXT NOT NULL,
    "escopo" TEXT NOT NULL,
    "acesso_hash" TEXT NOT NULL,
    "acesso_expira_em" TIMESTAMP(3) NOT NULL,
    "refresh_hash" TEXT NOT NULL,
    "refresh_expira_em" TIMESTAMP(3) NOT NULL,
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ultimo_uso_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "mcp_conexao_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "oauth_cliente_criado_em_idx" ON "oauth_cliente"("criado_em");
CREATE INDEX IF NOT EXISTS "oauth_codigo_expira_em_idx" ON "oauth_codigo"("expira_em");
CREATE UNIQUE INDEX IF NOT EXISTS "mcp_conexao_acesso_hash_key" ON "mcp_conexao"("acesso_hash");
CREATE UNIQUE INDEX IF NOT EXISTS "mcp_conexao_refresh_hash_key" ON "mcp_conexao"("refresh_hash");
CREATE INDEX IF NOT EXISTS "mcp_conexao_usuario_id_idx" ON "mcp_conexao"("usuario_id");
CREATE INDEX IF NOT EXISTS "mcp_conexao_refresh_expira_em_idx" ON "mcp_conexao"("refresh_expira_em");

-- FKs: ADD CONSTRAINT não tem IF NOT EXISTS; o bloco confere antes (reaplicar não quebra).
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'oauth_codigo_cliente_id_fkey') THEN
    ALTER TABLE "oauth_codigo" ADD CONSTRAINT "oauth_codigo_cliente_id_fkey" FOREIGN KEY ("cliente_id") REFERENCES "oauth_cliente"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'oauth_codigo_usuario_id_fkey') THEN
    ALTER TABLE "oauth_codigo" ADD CONSTRAINT "oauth_codigo_usuario_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "usuario"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'mcp_conexao_usuario_id_fkey') THEN
    ALTER TABLE "mcp_conexao" ADD CONSTRAINT "mcp_conexao_usuario_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "usuario"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'mcp_conexao_cliente_id_fkey') THEN
    ALTER TABLE "mcp_conexao" ADD CONSTRAINT "mcp_conexao_cliente_id_fkey" FOREIGN KEY ("cliente_id") REFERENCES "oauth_cliente"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
