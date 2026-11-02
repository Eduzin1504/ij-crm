/**
 * Fórmula de cada indicador do painel (GAB-94), em texto: a tela mostra como
 * nota de rodapé e o MCP devolve junto dos números. Detalhes em `calculo.ts`.
 */
import type { Indicador } from "./servico";

/** Regra de visibilidade (tela e MCP). */
export const VISIBILIDADE_PAINEL =
  "Segue a configuração \"Mostrar ranking aos vendedores\" (Gestão → Ranking): com o ranking oculto, quem não é gestor/admin (nem visualizador) vê os totais do time e só as próprias linhas, e não pode filtrar por outra pessoa.";

export const DEFINICOES_PAINEL: Record<Indicador, string[]> = {
  conversao: [
    "Ganhos, perdidos e R$ fechado no período seguem as regras do ranking: ganho pela data do ganho, perda pela entrada no Perdido; só movimentos feitos por gente (tela, WhatsApp ou MCP), não importação do Pipefy nem migração do sistema.",
    "Conversão = ganhos ÷ (ganhos + perdidos).",
    "Por fase aberta de Vendas: entradas = cards que entraram na fase no período; saídas = avanço (fase seguinte, Ganho ou Projetos), perda (Perdido) ou recuo (fase anterior). Conversão da fase = avanços ÷ (avanços + perdas). No filtro por vendedor, cada card conta para o responsável ATUAL dele (o vendedor que vendeu, se já foi para Projetos), não para quem era o responsável na época do movimento.",
    "Tempo médio na fase = média da duração das estadias que terminaram (saíram da fase) no período.",
    "Valor em proposta e versões até fechar: sem dados até a Proposta existir no CRM (GAB-86).",
  ],
  engajamento: [
    "Interações = registros na Timeline no período enquanto o card estava em Vendas: mensagens #crm do WhatsApp (contam para quem mandou), notas pela tela e notas pelo MCP.",
    "Próximas ações feitas = \"Marcar feita\" no período. No prazo = feita até o dia marcado para ela (dia de São Paulo). Taxa = no prazo ÷ feitas que tinham data.",
  ],
  acompanhamento: [
    "Situação de agora (não depende do período): cards abertos no quadro Vendas, por responsável.",
    "Sem próxima ação = card sem data de próxima ação. Vencida = data de próxima ação anterior a hoje.",
    "Dias sem contato = dias desde a última nota ou mensagem #crm com autor do card (sem nenhuma, desde a criação do card).",
  ],
  satisfacao: [
    "Nota média = média das notas de 1 a 5 dadas pelo vendedor às interações do período, só enquanto o card estava em Vendas.",
    "Sentimento = classificação do lead feita pela IA nas mensagens #crm do período (positivo, neutro, negativo), só enquanto o card estava em Vendas.",
  ],
};
