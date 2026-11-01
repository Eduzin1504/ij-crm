-- GAB-84: anexos do Projeto (spec fase 2 §4.7). Só ADITIVA: enum novo, valor novo
-- em "TipoTimeline" e tabela nova. A versão anterior do app ignora tudo isso.
-- Os bytes dos arquivos ficam no volume ANEXOS_DIR (docs/runbook.md, "Anexos").

-- CreateEnum
CREATE TYPE "TipoAnexo" AS ENUM ('PDF', 'DOCX', 'MARKDOWN', 'TEXTO', 'PNG', 'JPEG', 'WEBP');

-- AlterEnum
ALTER TYPE "TipoTimeline" ADD VALUE 'ANEXO';

-- CreateTable
CREATE TABLE "anexo" (
    "id" TEXT NOT NULL,
    "oportunidade_id" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "tipo" "TipoAnexo" NOT NULL,
    "mime" TEXT NOT NULL,
    "tamanho" INTEGER NOT NULL,
    "sha256" TEXT NOT NULL,
    "texto" TEXT,
    "sem_texto" BOOLEAN NOT NULL,
    "autor_id" TEXT NOT NULL,
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletado_em" TIMESTAMP(3),
    "deletado_por_id" TEXT,

    CONSTRAINT "anexo_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "anexo_oportunidade_id_criado_em_idx" ON "anexo"("oportunidade_id", "criado_em");

-- CreateIndex
CREATE INDEX "anexo_deletado_em_idx" ON "anexo"("deletado_em");

-- AddForeignKey
ALTER TABLE "anexo" ADD CONSTRAINT "anexo_oportunidade_id_fkey" FOREIGN KEY ("oportunidade_id") REFERENCES "oportunidade"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "anexo" ADD CONSTRAINT "anexo_autor_id_fkey" FOREIGN KEY ("autor_id") REFERENCES "usuario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "anexo" ADD CONSTRAINT "anexo_deletado_por_id_fkey" FOREIGN KEY ("deletado_por_id") REFERENCES "usuario"("id") ON DELETE SET NULL ON UPDATE CASCADE;

