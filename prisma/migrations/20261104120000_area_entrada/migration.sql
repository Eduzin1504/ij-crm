-- GAB-97: área de entrada no CRM, escolhida na Gestão de usuários. Usada por ADMIN,
-- GESTOR sem área e VISUALIZADOR (ver src/lib/auth/areas.ts). Nula = Geral (Painel).
-- Não reaproveita `usuario.area`, que dá lado na caneta.
CREATE TYPE "AreaEntrada" AS ENUM ('VENDAS', 'PROJETOS', 'GERAL');
ALTER TABLE "usuario" ADD COLUMN "area_entrada" "AreaEntrada";
