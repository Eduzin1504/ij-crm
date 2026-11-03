-- GAB-89: envio da proposta ao cliente e resposta (spec fase 2 §4.3/§4.4).
-- Aditiva: só colunas novas, todas opcionais. Os status (ENVIADA, ACEITA,
-- RECUSADA, REVISAO_PEDIDA) já existem no enum desde a 20261101150000.
ALTER TABLE "proposta"
  ADD COLUMN "versao_enviada" INTEGER,
  ADD COLUMN "enviada_em" TIMESTAMP(3),
  ADD COLUMN "respondida_em" TIMESTAMP(3),
  ADD COLUMN "motivo_recusa" TEXT;
