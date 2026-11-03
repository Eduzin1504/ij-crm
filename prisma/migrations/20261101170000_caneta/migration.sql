-- GAB-87: caneta e pingue-pongue da proposta. Só aditiva: valor novo no enum,
-- coluna nula, tabela nova e um backfill que só preenche o que estava vazio.

-- AlterEnum
ALTER TYPE "StatusProposta" ADD VALUE 'INVIAVEL';

-- AlterTable
ALTER TABLE "proposta" ADD COLUMN     "motivo_inviavel" TEXT;

-- CreateTable
CREATE TABLE "proposta_caneta" (
    "id" TEXT NOT NULL,
    "proposta_id" TEXT NOT NULL,
    "usuario_id" TEXT NOT NULL,
    "lado" "Area" NOT NULL,
    "inicio" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "fim" TIMESTAMP(3),

    CONSTRAINT "proposta_caneta_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "proposta_caneta_proposta_id_fim_idx" ON "proposta_caneta"("proposta_id", "fim");

-- CreateIndex
CREATE INDEX "proposta_caneta_usuario_id_idx" ON "proposta_caneta"("usuario_id");

-- AddForeignKey
ALTER TABLE "proposta_caneta" ADD CONSTRAINT "proposta_caneta_proposta_id_fkey" FOREIGN KEY ("proposta_id") REFERENCES "proposta"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "proposta_caneta" ADD CONSTRAINT "proposta_caneta_usuario_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "usuario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Backfill: propostas criadas antes da caneta (GAB-86) começam com vendas
-- (spec §4.3), com o responsável pelo Projeto se ele é de vendas e está ativo
-- (mesma regra de `ladoDe` em src/lib/auth/areas.ts); senão ninguém está com
-- a caneta e o GP de vendas a pega.
UPDATE "proposta" SET "caneta_lado" = 'VENDAS' WHERE "caneta_lado" IS NULL;

UPDATE "proposta" p
   SET "caneta_com_id" = o."responsavel_id"
  FROM "oportunidade" o
  JOIN "usuario" u ON u."id" = o."responsavel_id"
 WHERE p."oportunidade_id" = o."id"
   AND p."caneta_com_id" IS NULL
   AND p."caneta_lado" = 'VENDAS'
   AND u."ativo"
   AND (u."papel" = 'VENDEDOR' OR (u."papel" IN ('GESTOR', 'ADMIN') AND u."area" = 'VENDAS'));

INSERT INTO "proposta_caneta" ("id", "proposta_id", "usuario_id", "lado", "inicio")
SELECT 'bf' || md5(p."id"), p."id", p."caneta_com_id", p."caneta_lado", CURRENT_TIMESTAMP
  FROM "proposta" p
 WHERE p."caneta_com_id" IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM "proposta_caneta" c WHERE c."proposta_id" = p."id" AND c."fim" IS NULL);
