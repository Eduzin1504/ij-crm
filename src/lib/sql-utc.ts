import { Prisma } from "@prisma/client";

/**
 * Instante JS → `timestamp` (sem fuso) em UTC, como o Prisma grava as colunas
 * `timestamp(3)`. O Prisma manda `Date` como `timestamptz`; comparado direto com
 * `timestamp`, o Postgres converteria pela TimeZone da SESSÃO. Aqui a conversão
 * é explícita e não depende dela. Usado em SQL cru (ranking, avaliação do contato).
 */
export const utc = (d: Date) => Prisma.sql`(${d.toISOString()}::timestamptz AT TIME ZONE 'UTC')`;
