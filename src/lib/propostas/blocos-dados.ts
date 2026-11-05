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

/** Dias somados, se TODAS as entregas tiverem duração que se entenda. */
function diasDasDuracoes(entregas: readonly Entrega[]): number | null {
  if (entregas.length === 0) return null;
  let soma = 0;
  for (const e of entregas) {
    const d = e.duracao === null ? null : duracaoEmDias(e.duracao);
    if (d === null) return null;
    soma += d;
  }
  return soma;
}

/** Só semanas somam em semanas, como no modelo. */
function textoDaSoma(entregas: readonly Entrega[], dias: number): string {
  if (entregas.every((e) => /semana/.test(e.duracao!))) return `${dias / 7} ${dias === 7 ? "semana" : "semanas"}`;
  return `${dias} ${dias === 1 ? "dia" : "dias"}`;
}

/**
 * Total de prazo da tabela: só com duração em todas as entregas, para não contradizer as linhas, e
 * sem contradizer o prazo do bloco Investimento. Em cronograma com datas, fica em branco.
 */
function totalDePrazo(e: Estruturado): string {
  const dias = diasDasDuracoes(e.entregas);
  if (dias === null) return "";
  return e.prazoDias === null || e.prazoDias === dias ? textoDaSoma(e.entregas, dias) : "";
}

/** Total de valor da tabela: só com parcela em todas as entregas e soma igual ao valor do bloco Investimento. */
function totalDeValor(e: Estruturado): string {
  if (e.valor === null || e.entregas.some((x) => x.valor === null)) return "";
  const soma = somaDasParcelas(e.entregas);
  return soma !== null && Number(soma) === Number(e.valor) ? formatarReais(soma) : "";
}

/**
 * O que não fecha entre o cronograma e o valor ou o prazo. Avisa no cartão e não trava: é
 * a proposta que decide, e a folha e o PDF deixam o total em branco em vez de contradizer.
 */
export function avisosDosDados(e: Estruturado): string[] {
  const avisos: string[] = [];
  const soma = somaDasParcelas(e.entregas);
  if (soma !== null && e.valor !== null && Number(soma) !== Number(e.valor)) avisos.push(`As parcelas somam ${formatarReais(soma)}, e o valor total é ${formatarReais(e.valor)}. A tabela fica sem total de valor.`);
  const dias = diasDasDuracoes(e.entregas);
  if (dias !== null && e.prazoDias !== null && dias !== e.prazoDias) avisos.push(`As durações somam ${dias} ${dias === 1 ? "dia" : "dias"}, e o prazo é de ${e.prazoDias}. A tabela fica sem total de duração.`);
  if (dias === null && e.prazoDias !== null) {
    const conhecidos = e.entregas.reduce((soma, x) => soma + (x.duracao === null ? 0 : (duracaoEmDias(x.duracao) ?? 0)), 0);
    if (conhecidos > e.prazoDias) avisos.push(`As durações informadas já somam ${conhecidos} dias, mais que o prazo de ${e.prazoDias}.`);
  }
  return avisos;
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
  const totalPrazo = totalDePrazo(e);
  const totalValor = comValor ? totalDeValor(e) : "";
  const total = totalPrazo || totalValor ? ["Total", totalPrazo, ...(comValor ? [totalValor] : [])] : null;
  return { colunas, linhas, total };
}

/** Linhas do Investimento; vazio = sem valor nem prazo (o bloco fica de fora do PDF). */
export function linhasInvestimento(e: Estruturado): { rotulo: string; valor: string; forte: boolean }[] {
  return [
    ...(e.valor !== null ? [{ rotulo: "Total em valores", valor: formatarReais(e.valor), forte: true }] : []),
    ...(e.prazoDias !== null ? [{ rotulo: "Prazo", valor: diasCorridos(e.prazoDias), forte: false }] : []),
  ];
}
