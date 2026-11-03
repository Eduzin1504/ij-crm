-- GAB-88: avisos (sino no app + WhatsApp privado). Só aditiva: enums e tabela novos.

-- CreateEnum
CREATE TYPE "TipoAviso" AS ENUM ('SUA_VEZ', 'CANETA_PEGA', 'STATUS_PROPOSTA', 'COMENTARIO', 'PROPOSTA_ACEITA', 'HANDOFF');

-- CreateEnum
CREATE TYPE "EnvioAviso" AS ENUM ('PENDENTE', 'ENVIADO', 'SAFE_MODE', 'SEM_TELEFONE', 'DESLIGADO', 'FALHOU');

-- CreateTable
CREATE TABLE "aviso" (
    "id" TEXT NOT NULL,
    "usuario_id" TEXT NOT NULL,
    "tipo" "TipoAviso" NOT NULL,
    "titulo" TEXT NOT NULL,
    "oportunidade_id" TEXT,
    "whatsapp" "EnvioAviso",
    "whatsapp_ref" TEXT,
    "lido_em" TIMESTAMP(3),
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "aviso_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "aviso_usuario_id_lido_em_idx" ON "aviso"("usuario_id", "lido_em");

-- CreateIndex
CREATE INDEX "aviso_usuario_id_criado_em_idx" ON "aviso"("usuario_id", "criado_em");

-- CreateIndex
CREATE INDEX "aviso_oportunidade_id_idx" ON "aviso"("oportunidade_id");

-- AddForeignKey
ALTER TABLE "aviso" ADD CONSTRAINT "aviso_usuario_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "usuario"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "aviso" ADD CONSTRAINT "aviso_oportunidade_id_fkey" FOREIGN KEY ("oportunidade_id") REFERENCES "oportunidade"("id") ON DELETE CASCADE ON UPDATE CASCADE;

