-- GAB-95: entrega cancelada com motivo, sem apagar a linha. Só aditiva. Painel e contas filtram `cancelada_em IS NULL`.
ALTER TABLE "projeto_entrega" ADD COLUMN "cancelada_em" TIMESTAMP(3);
ALTER TABLE "projeto_entrega" ADD COLUMN "motivo_cancelamento" TEXT;
