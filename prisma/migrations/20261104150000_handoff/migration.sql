-- GAB-93: handoff do Projeto (spec fase 2 §4.8). Aditiva: só tabela, colunas e valor de enum novos.
ALTER TYPE "TipoTimeline" ADD VALUE 'HANDOFF';

-- O PDF é o contrato assinado? Marca explícita, sem backfill: nome de arquivo não prova nada.
ALTER TABLE "anexo" ADD COLUMN "contrato_assinado" BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE "projeto_handoff" (
    "oportunidade_id" TEXT NOT NULL,
    "gp_projeto_id" TEXT,
    "contatos_em" TIMESTAMP(3),
    "kickoff_em" TIMESTAMP(3),
    "acessos_em" TIMESTAMP(3),
    "resumo_contexto" TEXT NOT NULL DEFAULT '',
    "resumo_combinados" TEXT NOT NULL DEFAULT '',
    "resumo_riscos" TEXT NOT NULL DEFAULT '',
    "resumo_valoriza" TEXT NOT NULL DEFAULT '',
    "resumo_por_id" TEXT,
    "resumo_em" TIMESTAMP(3),
    "atualizado_em" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "projeto_handoff_pkey" PRIMARY KEY ("oportunidade_id")
);
CREATE INDEX "projeto_handoff_gp_projeto_id_idx" ON "projeto_handoff"("gp_projeto_id");
CREATE INDEX "projeto_handoff_resumo_por_id_idx" ON "projeto_handoff"("resumo_por_id");
ALTER TABLE "projeto_handoff" ADD CONSTRAINT "projeto_handoff_oportunidade_id_fkey" FOREIGN KEY ("oportunidade_id") REFERENCES "oportunidade"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "projeto_handoff" ADD CONSTRAINT "projeto_handoff_gp_projeto_id_fkey" FOREIGN KEY ("gp_projeto_id") REFERENCES "usuario"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "projeto_handoff" ADD CONSTRAINT "projeto_handoff_resumo_por_id_fkey" FOREIGN KEY ("resumo_por_id") REFERENCES "usuario"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Decisão do produto (mesma linha do GAB-89): quem JÁ ESTÁ no quadro Projetos quando esta migration
-- roda (Handoff, Execução ou depois, inclusive na lixeira) fica isento da trava de Execução. Cards que
-- ainda estão em Vendas não: passam pelo handoff quando ganharem. A marca depende da hora em que a
-- migration roda, não de data no código. DEFAULT false: cards novos nascem travados.
ALTER TABLE "oportunidade" ADD COLUMN "isento_trava_handoff" BOOLEAN NOT NULL DEFAULT false;
UPDATE "oportunidade" o SET "isento_trava_handoff" = true
  FROM "pipeline" p WHERE o."pipeline_id" = p."id" AND p."chave" = 'projetos';
