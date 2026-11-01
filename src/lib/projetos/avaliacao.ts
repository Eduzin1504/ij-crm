/**
 * "Os leads gostaram do contato?" (GAB-85; spec fase 2 §4.14, Q23). Dois sinais,
 * ambos em colunas próprias da Timeline (fora do `payload`, que a purga de 90 dias
 * do JSON da LLM mexe):
 * - `timeline.nota`: nota de 1 a 5 que o vendedor dá ao registrar uma interação
 *   (NOTA na tela, "Marcar feita", MCP). Opcional.
 * - `timeline.sentimento`: como o lead reagiu, lido pela LLM nas mensagens `#crm`
 *   junto da extração (extracao.v3).
 *
 * Só funções puras aqui (a tela usa no cliente). A consulta agregada do painel
 * está em `avaliacao-consulta.ts`.
 */
import type { Sentimento } from "@prisma/client";

export const NOTA_CONTATO_MIN = 1;
export const NOTA_CONTATO_MAX = 5;

/** Inteiro de 1 a 5. `null`/ausente (sem nota) é tratado por quem chama. */
export function notaContatoValida(n: unknown): n is number {
  return typeof n === "number" && Number.isInteger(n) && n >= NOTA_CONTATO_MIN && n <= NOTA_CONTATO_MAX;
}

export const ROTULO_SENTIMENTO: Record<Sentimento, string> = { POSITIVO: "positivo", NEUTRO: "neutro", NEGATIVO: "negativo" };

export type ResumoAvaliacao = { notas: number; media: number | null; sentimentos: Record<Sentimento, number> };

/** Resumo do card (detalhe do Projeto): média das notas e contagem de sentimentos. Sem nenhum sinal → null. */
export function resumoAvaliacao(entradas: readonly { nota: number | null; sentimento: Sentimento | null }[]): ResumoAvaliacao | null {
  const sentimentos: Record<Sentimento, number> = { POSITIVO: 0, NEUTRO: 0, NEGATIVO: 0 };
  let soma = 0;
  let notas = 0;
  for (const e of entradas) {
    if (e.nota !== null) {
      soma += e.nota;
      notas++;
    }
    if (e.sentimento !== null) sentimentos[e.sentimento]++;
  }
  const comSentimento = sentimentos.POSITIVO + sentimentos.NEUTRO + sentimentos.NEGATIVO;
  if (notas === 0 && comSentimento === 0) return null;
  return { notas, media: notas === 0 ? null : soma / notas, sentimentos };
}
