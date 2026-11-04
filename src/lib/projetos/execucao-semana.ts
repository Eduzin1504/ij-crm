/**
 * Semana do check-in (GAB-95): segunda a domingo, dias civis de São Paulo, seja
 * qual for o fuso do servidor. A coluna DATE volta do Prisma como meia-noite UTC.
 */
import { diaDoPrazo, instanteDoPrazo, segundaDe } from "@/lib/calendario/semana";
import { diaEmFuso } from "./aging";
import { somarDias } from "./proxima-acao";

export const diaParaColuna = instanteDoPrazo;
export const colunaParaDia = diaDoPrazo;

/** Segunda-feira da semana em que `agora` cai. */
export function semanaDe(agora: Date): string {
  return segundaDe(diaEmFuso(agora));
}

/** A semana que acabou de passar: é ela que o lembrete cobra. */
export function semanaCobrada(agora: Date): string {
  return somarDias(semanaDe(agora), -7);
}

/**
 * Desde quando há acompanhamento para cobrar: a entrada em Execução; em card sem ela (já em Execução no
 * deploy), a primeira entrega ativa ou o primeiro check-in. null = nada a cobrar. Lembrete e painel usam a mesma regra.
 */
export function inicioDoAcompanhamento(execucaoDesde: Date | null, datas: readonly (Date | null | undefined)[]): Date | null {
  if (execucaoDesde) return execucaoDesde;
  const validas = datas.filter((d): d is Date => !!d);
  return validas.length ? new Date(Math.min(...validas.map((d) => d.getTime()))) : null;
}

/**
 * O acompanhamento começou antes da semana cobrada? A semana em que o card entrou
 * em Execução não é cobrada: a primeira cobrança é da primeira semana inteira.
 * `inicio` null = nada a cobrar (card já em Execução no deploy e sem entrega nem check-in).
 */
export function semanaCobravel(inicio: Date | null, semana: string): boolean {
  return inicio !== null && semanaDe(inicio) < semana;
}
