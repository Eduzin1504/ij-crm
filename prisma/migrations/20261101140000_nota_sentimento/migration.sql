-- GAB-85 (spec fase 2 §4.14, Q23 "os leads gostaram do contato?"). Só ADITIVA:
-- colunas anuláveis e um enum novo; a versão anterior do app segue funcionando
-- (não lê nem grava as colunas).
--
-- timeline.nota: nota de 1 a 5 do vendedor numa interação (NOTA da tela/MCP).
-- timeline.sentimento / mensagem_bruta.sentimento: como o lead reagiu, lido pela
-- LLM junto da extração (extracao.v3). Colunas próprias, FORA do JSON: a purga de
-- 90 dias (resultado_llm e payload.saida) não apaga o que o painel (GAB-94) agrega.
CREATE TYPE "Sentimento" AS ENUM ('POSITIVO', 'NEUTRO', 'NEGATIVO');

ALTER TABLE "timeline" ADD COLUMN "nota" SMALLINT;
ALTER TABLE "timeline" ADD COLUMN "sentimento" "Sentimento";
ALTER TABLE "timeline" ADD CONSTRAINT "timeline_nota_check" CHECK ("nota" BETWEEN 1 AND 5);

ALTER TABLE "mensagem_bruta" ADD COLUMN "sentimento" "Sentimento";
