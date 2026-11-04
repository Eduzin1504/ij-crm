/**
 * O que os blocos móveis "Cronograma" e "Investimento" mostram (GAB-100, spec
 * proposta-folha §5). Um cálculo só para a folha e para o PDF: a folha não pode
 * prometer o que o PDF não entrega. Puro: roda no cliente, sem `marked`.
 *
 * O escopo resumido não aparece aqui de propósito: é dado do sistema, e o escopo do
 * cliente é o texto da proposta.
 */
import type { TipoBlocoDados } from "./documento";
import { duracaoEmDias, somaDasParcelas, type Entrega, type Estruturado } from "./estruturado";

export const TITULO_BLOCO_DADOS: Record<TipoBlocoDados, string> = { cronograma: "Cronograma", investimento: "Investimento" };

/** Marcador do Markdown → como o diff mostra. */
export const MARCADORES_BLOCO: Record<string, string> = {
  "<!-- bloco:cronograma -->": "[Bloco Cronograma]",
  "<!-- bloco:investimento -->": "[Bloco Investimento]",
  "<!-- bloco:nenhum -->": "[Blocos Cronograma e Investimento fora da folha]",
};

const BRL = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });

/** "12500.00" → "R$ 12.500,00" (espaço comum: a fonte não precisa do NBSP). */
export function formatarReais(v: string): string {
  return BRL.format(Number(v)).replace(/\s/g, " ");
}

/** "2026-12-01" → "01/12/2026" (dia de calendário, sem fuso). */
export function formatarDia(dia: string): string {
  const [a, m, d] = dia.split("-");
  return `${d}/${m}/${a}`;
}

/** O que a entrega tem: "2 semanas" ou "01/12/2026". */
export function rotuloDaEntrega(e: Pick<Entrega, "dia" | "duracao">): string {
  return e.duracao ?? (e.dia ? formatarDia(e.dia) : "—");
}

const diasCorridos = (n: number) => `${n} ${n === 1 ? "dia corrido" : "dias corridos"}`;

/** Soma das durações, se TODAS as entregas tiverem duração. Só semanas somam em semanas, como no modelo. */
function somaDuracoes(entregas: readonly Entrega[]): string | null {
  if (entregas.length === 0 || entregas.some((e) => e.duracao === null)) return null;
  const dias = entregas.reduce((s, e) => s + (duracaoEmDias(e.duracao!) ?? 0), 0);
  if (dias === 0) return null;
  if (entregas.every((e) => /semana/.test(e.duracao!))) return `${dias / 7} ${dias === 7 ? "semana" : "semanas"}`;
  return `${dias} ${dias === 1 ? "dia" : "dias"}`;
}

export type ColunaBloco = { titulo: string; largura: number; alinhar: "esquerda" | "centro" | "direita" };
export type TabelaCronograma = { colunas: ColunaBloco[]; linhas: string[][]; total: string[] | null };

/** Tabela do Cronograma; null = sem entregas (o bloco fica de fora do PDF). */
export function tabelaCronograma(e: Estruturado): TabelaCronograma | null {
  if (e.entregas.length === 0) return null;
  const comValor = e.entregas.some((x) => x.valor !== null);
  const todasDuracao = e.entregas.every((x) => x.duracao !== null);
  const nenhumaDuracao = e.entregas.every((x) => x.duracao === null);
  const tituloPrazo = todasDuracao ? "Duração" : nenhumaDuracao ? "Data" : "Prazo";
  const colunas: ColunaBloco[] = comValor
    ? [
        { titulo: "Etapas Principais", largura: 0.56, alinhar: "esquerda" },
        { titulo: tituloPrazo, largura: 0.2, alinhar: "centro" },
        { titulo: "Valor", largura: 0.24, alinhar: "direita" },
      ]
    : [
        { titulo: "Etapas Principais", largura: 0.76, alinhar: "esquerda" },
        { titulo: tituloPrazo, largura: 0.24, alinhar: "centro" },
      ];
  const linhas = e.entregas.map((x) => (comValor ? [x.titulo, rotuloDaEntrega(x), x.valor !== null ? formatarReais(x.valor) : "—"] : [x.titulo, rotuloDaEntrega(x)]));
  const totalPrazo = somaDuracoes(e.entregas) ?? (e.prazoDias !== null ? diasCorridos(e.prazoDias) : "");
  const soma = comValor ? somaDasParcelas(e.entregas) : null;
  const total = totalPrazo || soma ? ["Total", totalPrazo, ...(comValor ? [soma ? formatarReais(soma) : ""] : [])] : null;
  return { colunas, linhas, total };
}

/** Linhas do Investimento; vazio = sem valor nem prazo (o bloco fica de fora do PDF). */
export function linhasInvestimento(e: Estruturado): { rotulo: string; valor: string; forte: boolean }[] {
  return [
    ...(e.valor !== null ? [{ rotulo: "Total em valores", valor: formatarReais(e.valor), forte: true }] : []),
    ...(e.prazoDias !== null ? [{ rotulo: "Prazo", valor: diasCorridos(e.prazoDias), forte: false }] : []),
  ];
}
