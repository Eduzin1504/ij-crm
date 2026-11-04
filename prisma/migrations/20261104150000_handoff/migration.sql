-- GAB-93: handoff do Projeto (spec fase 2 §4.8). Tabela, colunas, valor de enum, índice único parcial do contrato e fase Perdido no quadro Projetos; nenhum dado existente é apagado.
ALTER TYPE "TipoTimeline" ADD VALUE 'HANDOFF';

-- O PDF é o contrato assinado? Marca explícita, sem backfill: nome de arquivo não prova nada.
ALTER TABLE "anexo" ADD COLUMN "contrato_assinado" BOOLEAN NOT NULL DEFAULT false;
-- Um contrato vivo por Projeto. O serviço troca sob o lock da linha do card; o índice é a garantia.
CREATE UNIQUE INDEX "anexo_contrato_assinado_vivo_key" ON "anexo"("oportunidade_id") WHERE "contrato_assinado" AND "deletado_em" IS NULL;

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

-- Isenção da trava de Execução: só quem JÁ ESTÁ no quadro Projetos quando esta migration roda (Handoff,
-- Execução ou depois, inclusive na lixeira). É um recorte menor que o do GAB-89, que isentou todos os
-- cards existentes: lá a exigência era retroativa (proposta aceita em card já adiantado); aqui, um card
-- ainda em Vendas não perdeu nada, porque o handoff dele só começa no ganho, e ele consegue cumprir tudo.
-- Por isso cards em Vendas não ficam isentos. A marca depende da hora em que a migration roda, não de
-- data no código. DEFAULT false: cards novos nascem travados.
ALTER TABLE "oportunidade" ADD COLUMN "isento_trava_handoff" BOOLEAN NOT NULL DEFAULT false;
UPDATE "oportunidade" o SET "isento_trava_handoff" = true
  FROM "pipeline" p WHERE o."pipeline_id" = p."id" AND p."chave" = 'projetos';

-- Fase Perdido no quadro Projetos: cliente que desiste depois de assinar precisa ter para onde ir. Não é
-- marco (`fase.marco` é único e o Perdido de Vendas já o usa); `validarTerminais` garante que o quadro
-- mantenha uma. Se a Gestão já criou uma fase ativa de perdido, fica a dela. Fase arquivada ou outra fase
-- com a chave `perdido` não bloqueiam: a nova usa a próxima chave livre. Instalação nova: quem cria é o seed.
-- GAB-93-PERDIDO-INICIO
DO $$
DECLARE
  v_proj TEXT;
  chave_nova TEXT := 'perdido';
  n INT := 1;
BEGIN
  SELECT id INTO v_proj FROM pipeline WHERE chave = 'projetos';
  IF v_proj IS NULL THEN RETURN; END IF;
  IF EXISTS (SELECT 1 FROM fase WHERE pipeline_id = v_proj AND tipo_terminal = 'PERDIDO' AND arquivada_em IS NULL) THEN RETURN; END IF;
  WHILE EXISTS (SELECT 1 FROM fase WHERE pipeline_id = v_proj AND chave = chave_nova) LOOP
    n := n + 1;
    chave_nova := 'perdido_' || n;
  END LOOP;
  INSERT INTO fase (id, pipeline_id, chave, nome, ordem, is_terminal, tipo_terminal, cor, criado_em, atualizado_em)
  SELECT 'gab93' || replace(gen_random_uuid()::text, '-', ''), v_proj, chave_nova, 'Perdido', COALESCE(MAX(ordem), -1) + 1, true, 'PERDIDO', '#6b7280', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
    FROM fase WHERE pipeline_id = v_proj;
END $$;
-- GAB-93-PERDIDO-FIM
