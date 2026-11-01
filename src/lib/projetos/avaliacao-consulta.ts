/**
 * Agregado "os leads gostaram do contato?" por vendedor e período (GAB-85),
 * pronto para o painel (GAB-94). SQL simples sobre colunas da Timeline:
 *
 *   vendedor = quem MANDOU a mensagem #crm (`mensagem_bruta.remetente_usuario_id`;
 *              cobre a "Resolver manualmente", cujo autor na Timeline é quem
 *              resolveu) ou, sem mensagem, o autor da entrada (NOTA da tela/MCP);
 *   período  = `timeline.em` em [de, ate), comparado em UTC explícito (`utc`), sem
 *              depender da TimeZone da sessão;
 *   cards na lixeira (`deletado_em`) ficam de fora.
 *
 * Não depende do JSON da LLM: continua certo depois da purga de 90 dias.
 */
import type { PrismaClient } from "@prisma/client";
import { db } from "@/lib/db";
import { utc } from "@/lib/sql-utc";

export type AvaliacaoVendedor = {
  vendedorId: string;
  /** Interações com nota 1–5. */
  notas: number;
  notaMedia: number | null;
  positivos: number;
  neutros: number;
  negativos: number;
};

/** `cliente`: o `db` ou uma transação (testes fixam o fuso da sessão nela). */
export async function avaliacoesPorVendedor(periodo: { de: Date; ate: Date }, cliente: Pick<PrismaClient, "$queryRaw"> = db): Promise<AvaliacaoVendedor[]> {
  return cliente.$queryRaw<AvaliacaoVendedor[]>`
    SELECT COALESCE(mb.remetente_usuario_id, t.usuario_id)         AS "vendedorId",
           COUNT(t.nota)::int                                      AS "notas",
           AVG(t.nota)::float8                                     AS "notaMedia",
           COUNT(*) FILTER (WHERE t.sentimento = 'POSITIVO')::int  AS "positivos",
           COUNT(*) FILTER (WHERE t.sentimento = 'NEUTRO')::int    AS "neutros",
           COUNT(*) FILTER (WHERE t.sentimento = 'NEGATIVO')::int  AS "negativos"
      FROM timeline t
      JOIN oportunidade o ON o.id = t.oportunidade_id AND o.deletado_em IS NULL
      LEFT JOIN mensagem_bruta mb ON mb.id = t.mensagem_bruta_id
     WHERE t.em >= ${utc(periodo.de)} AND t.em < ${utc(periodo.ate)}
       AND (t.nota IS NOT NULL OR t.sentimento IS NOT NULL)
       AND COALESCE(mb.remetente_usuario_id, t.usuario_id) IS NOT NULL
     GROUP BY 1
     ORDER BY 1`;
}
