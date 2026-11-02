/**
 * Indicadores do painel que dependem da Proposta (GAB-86): valor em proposta e
 * versões até fechar. A Proposta ainda não existe em main, então o painel (tela
 * e MCP) mostra "sem dados".
 *
 * PONTO DE ENCAIXE (quando a GAB-86 entrar): trocar `SEM_DADOS_PROPOSTA` em
 * `montarConversao` (`calculo.ts`) por `{ disponivel: true, valor }` vindo de
 * uma consulta agregada no `servico.ts` (`carregarConversao`), por exemplo:
 * - valor em proposta = soma do valor da parte estruturada da proposta dos
 *   cards abertos de Vendas com proposta ainda não aceita/recusada;
 * - versões até fechar = média do nº de versões das propostas dos ganhos do
 *   período.
 * O tipo e a renderização (tela e MCP) já tratam os dois casos.
 */
export type IndicadorProposta = { disponivel: false; motivo: string } | { disponivel: true; valor: number };

export const SEM_DADOS_PROPOSTA: IndicadorProposta = {
  disponivel: false,
  motivo: "Sem dados: depende da Proposta no CRM (GAB-86), ainda não disponível.",
};
