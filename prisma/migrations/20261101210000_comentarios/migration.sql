-- GAB-91: comentários na proposta (trecho ou gerais, respostas, resolver). Só aditiva: tabela nova.

-- CreateTable
CREATE TABLE "proposta_comentario" (
    "id" TEXT NOT NULL,
    "proposta_id" TEXT NOT NULL,
    "pai_id" TEXT,
    "autor_id" TEXT NOT NULL,
    "texto" TEXT NOT NULL,
    "trecho" TEXT,
    "trecho_antes" TEXT,
    "trecho_depois" TEXT,
    "via_mcp" BOOLEAN NOT NULL DEFAULT false,
    "resolvido_em" TIMESTAMP(3),
    "resolvido_por_id" TEXT,
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizado_em" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "proposta_comentario_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "proposta_comentario_proposta_id_criado_em_idx" ON "proposta_comentario"("proposta_id", "criado_em");

-- CreateIndex
CREATE INDEX "proposta_comentario_pai_id_idx" ON "proposta_comentario"("pai_id");

-- CreateIndex
CREATE INDEX "proposta_comentario_autor_id_idx" ON "proposta_comentario"("autor_id");

-- AddForeignKey
ALTER TABLE "proposta_comentario" ADD CONSTRAINT "proposta_comentario_proposta_id_fkey" FOREIGN KEY ("proposta_id") REFERENCES "proposta"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "proposta_comentario" ADD CONSTRAINT "proposta_comentario_pai_id_fkey" FOREIGN KEY ("pai_id") REFERENCES "proposta_comentario"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "proposta_comentario" ADD CONSTRAINT "proposta_comentario_autor_id_fkey" FOREIGN KEY ("autor_id") REFERENCES "usuario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "proposta_comentario" ADD CONSTRAINT "proposta_comentario_resolvido_por_id_fkey" FOREIGN KEY ("resolvido_por_id") REFERENCES "usuario"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- Limites (os mesmos de src/lib/propostas/comentarios.ts e ancora.ts): defesa no banco.
ALTER TABLE "proposta_comentario" ADD CONSTRAINT "proposta_comentario_texto_tamanho" CHECK (char_length("texto") BETWEEN 1 AND 2000);
ALTER TABLE "proposta_comentario" ADD CONSTRAINT "proposta_comentario_trecho_tamanho" CHECK ("trecho" IS NULL OR char_length("trecho") BETWEEN 1 AND 500);
ALTER TABLE "proposta_comentario" ADD CONSTRAINT "proposta_comentario_contexto_tamanho" CHECK (char_length(coalesce("trecho_antes", '')) <= 40 AND char_length(coalesce("trecho_depois", '')) <= 40);
-- Âncora e resolução só na raiz; resposta aponta para a raiz.
ALTER TABLE "proposta_comentario" ADD CONSTRAINT "proposta_comentario_resposta_sem_ancora" CHECK ("pai_id" IS NULL OR ("trecho" IS NULL AND "resolvido_em" IS NULL));
