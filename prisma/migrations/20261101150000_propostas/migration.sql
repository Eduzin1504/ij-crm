-- GAB-86: Proposta (uma por Projeto), versões imutáveis e parte estruturada.
-- Só aditiva: enum novo, valor novo em TipoTimeline, duas tabelas e um trigger.

-- CreateEnum
CREATE TYPE "StatusProposta" AS ENUM ('RASCUNHO', 'EM_ANALISE', 'EM_AJUSTE', 'PRONTA_PARA_ENVIO', 'ENVIADA', 'ACEITA', 'RECUSADA', 'REVISAO_PEDIDA');

-- AlterEnum
ALTER TYPE "TipoTimeline" ADD VALUE 'PROPOSTA';

-- CreateTable
CREATE TABLE "proposta" (
    "id" TEXT NOT NULL,
    "oportunidade_id" TEXT NOT NULL,
    "status" "StatusProposta" NOT NULL DEFAULT 'RASCUNHO',
    "conteudo_md" TEXT NOT NULL DEFAULT '',
    "estruturado" JSONB NOT NULL DEFAULT '{}',
    "valor" DECIMAL(14,2),
    "revisao" INTEGER NOT NULL DEFAULT 0,
    "rascunho_por_id" TEXT,
    "rascunho_em" TIMESTAMP(3),
    "rascunho_via_mcp" BOOLEAN NOT NULL DEFAULT false,
    "caneta_com_id" TEXT,
    "caneta_lado" "Area",
    "criado_por_id" TEXT NOT NULL,
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizado_em" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "proposta_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "proposta_versao" (
    "id" TEXT NOT NULL,
    "proposta_id" TEXT NOT NULL,
    "numero" INTEGER NOT NULL,
    "conteudo_md" TEXT NOT NULL,
    "estruturado" JSONB NOT NULL,
    "nota" TEXT,
    "autor_id" TEXT NOT NULL,
    "autor_lado" "Area",
    "via_mcp" BOOLEAN NOT NULL DEFAULT false,
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "proposta_versao_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "proposta_oportunidade_id_key" ON "proposta"("oportunidade_id");

-- CreateIndex
CREATE INDEX "proposta_status_idx" ON "proposta"("status");

-- CreateIndex
CREATE INDEX "proposta_caneta_com_id_idx" ON "proposta"("caneta_com_id");

-- CreateIndex
CREATE INDEX "proposta_versao_autor_id_idx" ON "proposta_versao"("autor_id");

-- CreateIndex
CREATE UNIQUE INDEX "proposta_versao_proposta_id_numero_key" ON "proposta_versao"("proposta_id", "numero");

-- AddForeignKey
ALTER TABLE "proposta" ADD CONSTRAINT "proposta_oportunidade_id_fkey" FOREIGN KEY ("oportunidade_id") REFERENCES "oportunidade"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "proposta" ADD CONSTRAINT "proposta_criado_por_id_fkey" FOREIGN KEY ("criado_por_id") REFERENCES "usuario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "proposta" ADD CONSTRAINT "proposta_rascunho_por_id_fkey" FOREIGN KEY ("rascunho_por_id") REFERENCES "usuario"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "proposta" ADD CONSTRAINT "proposta_caneta_com_id_fkey" FOREIGN KEY ("caneta_com_id") REFERENCES "usuario"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "proposta_versao" ADD CONSTRAINT "proposta_versao_proposta_id_fkey" FOREIGN KEY ("proposta_id") REFERENCES "proposta"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "proposta_versao" ADD CONSTRAINT "proposta_versao_autor_id_fkey" FOREIGN KEY ("autor_id") REFERENCES "usuario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Versão é IMUTÁVEL (spec §4.5): o banco recusa UPDATE em proposta_versao,
-- venha de onde vier (app, script, SQL manual). DELETE segue possível só pela
-- cascata da deleção definitiva do Projeto (admin, como a Timeline).
CREATE FUNCTION proposta_versao_imutavel() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'proposta_versao é imutável (versão %, proposta %)', OLD.numero, OLD.proposta_id
    USING ERRCODE = 'check_violation';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER proposta_versao_sem_update
  BEFORE UPDATE ON "proposta_versao"
  FOR EACH ROW EXECUTE FUNCTION proposta_versao_imutavel();
