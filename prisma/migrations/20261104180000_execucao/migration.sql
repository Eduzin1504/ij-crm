-- GAB-95: execução do Projeto (spec fase 2 §4.10): cronograma, ajustes, check-in e lembrete. Só aditiva: nenhum dado existente é apagado.
ALTER TYPE "TipoTimeline" ADD VALUE 'EXECUCAO';
ALTER TYPE "TipoAviso" ADD VALUE 'CHECKIN_ATRASADO';

CREATE TYPE "OrigemEntrega" AS ENUM ('PROPOSTA', 'MANUAL');
CREATE TYPE "StatusCheckin" AS ENUM ('VERDE', 'AMARELO', 'VERMELHO');

ALTER TABLE "oportunidade" ADD COLUMN "execucao_desde" TIMESTAMP(3);

-- Quem já passou pela trava do handoff e está em Execução ou depois (entrou depois do deploy do GAB-93) conta a partir
-- de quando chegou à fase. Isentos ficam sem data: não têm previsto e só são cobrados depois de terem entrega ou check-in.
-- Mesma conta de posição de `alemDoContrato` (trava-contrato.ts).
UPDATE "oportunidade" o SET "execucao_desde" = o."fase_desde"
  FROM "fase" f, "fase" ex
  WHERE o."fase_id" = f."id" AND ex."marco" = 'EXECUCAO' AND f."pipeline_id" = ex."pipeline_id"
    AND NOT o."isento_trava_handoff"
    AND f."tipo_terminal" IS DISTINCT FROM 'PERDIDO'
    AND (f."ordem" > ex."ordem" OR (f."ordem" = ex."ordem" AND f."criado_em" >= ex."criado_em"));

CREATE TABLE "projeto_entrega" (
    "id" TEXT NOT NULL,
    "oportunidade_id" TEXT NOT NULL,
    "ordem" INTEGER NOT NULL,
    "titulo" TEXT NOT NULL,
    "valor" DECIMAL(14,2),
    "previsto_original" DATE NOT NULL,
    "previsto_atual" DATE NOT NULL,
    "realizado_em" DATE,
    "origem" "OrigemEntrega" NOT NULL,
    "proposta_versao" INTEGER,
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizado_em" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "projeto_entrega_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "projeto_entrega_oportunidade_id_ordem_key" ON "projeto_entrega"("oportunidade_id", "ordem");
ALTER TABLE "projeto_entrega" ADD CONSTRAINT "projeto_entrega_oportunidade_id_fkey" FOREIGN KEY ("oportunidade_id") REFERENCES "oportunidade"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "entrega_ajuste" (
    "id" TEXT NOT NULL,
    "entrega_id" TEXT NOT NULL,
    "de" DATE NOT NULL,
    "para" DATE NOT NULL,
    "motivo" TEXT NOT NULL,
    "por_id" TEXT NOT NULL,
    "em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "entrega_ajuste_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "entrega_ajuste_entrega_id_em_idx" ON "entrega_ajuste"("entrega_id", "em");
CREATE INDEX "entrega_ajuste_por_id_idx" ON "entrega_ajuste"("por_id");
ALTER TABLE "entrega_ajuste" ADD CONSTRAINT "entrega_ajuste_entrega_id_fkey" FOREIGN KEY ("entrega_id") REFERENCES "projeto_entrega"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "entrega_ajuste" ADD CONSTRAINT "entrega_ajuste_por_id_fkey" FOREIGN KEY ("por_id") REFERENCES "usuario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "projeto_checkin" (
    "id" TEXT NOT NULL,
    "oportunidade_id" TEXT NOT NULL,
    "status" "StatusCheckin" NOT NULL,
    "motivo" TEXT NOT NULL,
    "semana" DATE NOT NULL,
    "por_id" TEXT NOT NULL,
    "em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "projeto_checkin_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "projeto_checkin_oportunidade_id_em_idx" ON "projeto_checkin"("oportunidade_id", "em");
CREATE INDEX "projeto_checkin_oportunidade_id_semana_idx" ON "projeto_checkin"("oportunidade_id", "semana");
CREATE INDEX "projeto_checkin_por_id_idx" ON "projeto_checkin"("por_id");
ALTER TABLE "projeto_checkin" ADD CONSTRAINT "projeto_checkin_oportunidade_id_fkey" FOREIGN KEY ("oportunidade_id") REFERENCES "oportunidade"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "projeto_checkin" ADD CONSTRAINT "projeto_checkin_por_id_fkey" FOREIGN KEY ("por_id") REFERENCES "usuario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "lembrete_checkin" (
    "oportunidade_id" TEXT NOT NULL,
    "semana" DATE NOT NULL,
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "lembrete_checkin_pkey" PRIMARY KEY ("oportunidade_id", "semana")
);
ALTER TABLE "lembrete_checkin" ADD CONSTRAINT "lembrete_checkin_oportunidade_id_fkey" FOREIGN KEY ("oportunidade_id") REFERENCES "oportunidade"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- O previsto original não muda: nem bug de serviço nem SQL solto.
CREATE FUNCTION projeto_entrega_previsto_imutavel() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'previsto_original é imutável (entrega %)', OLD.id
    USING ERRCODE = 'check_violation';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER projeto_entrega_previsto_sem_update
  BEFORE UPDATE ON "projeto_entrega"
  FOR EACH ROW WHEN (OLD."previsto_original" IS DISTINCT FROM NEW."previsto_original")
  EXECUTE FUNCTION projeto_entrega_previsto_imutavel();

-- Histórico: ajuste e check-in só acumulam.
CREATE FUNCTION execucao_historico_imutavel() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION '% é append-only (linha %)', TG_TABLE_NAME, OLD.id
    USING ERRCODE = 'check_violation';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER entrega_ajuste_sem_update BEFORE UPDATE ON "entrega_ajuste"
  FOR EACH ROW EXECUTE FUNCTION execucao_historico_imutavel();
CREATE TRIGGER projeto_checkin_sem_update BEFORE UPDATE ON "projeto_checkin"
  FOR EACH ROW EXECUTE FUNCTION execucao_historico_imutavel();
