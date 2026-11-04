/**
 * Fórmula de cada indicador do painel (GAB-94), em texto: a tela mostra como
 * nota de rodapé e o MCP devolve junto dos números. Detalhes em `calculo.ts`.
 */
import type { Indicador } from "./servico";

/** Regra de visibilidade (tela e MCP). */
export const VISIBILIDADE_PAINEL =
  "Segue a configuração \"Mostrar ranking aos vendedores\" (Gestão → Ranking): com o ranking oculto, quem não é gestor/admin (nem visualizador) vê os totais do time e só as próprias linhas, e não pode filtrar por outra pessoa.";

/** Quem vê o quê no painel de projetos (`/painel/projetos`), na tela e no MCP. */
export const VISIBILIDADE_PAINEL_PROJETOS =
  "A execução é aberta a todos, como o cronograma de cada projeto, e não usa valor nem versão da proposta. O tempo com a caneta vem das propostas: GP, gestão e admin veem todas; os demais, só as propostas em que estão escalados e, com o ranking oculto, só as próprias linhas; o visualizador não vê.";

export type IndicadorProjetos = "execucao" | "atrasados" | "alertas" | "caneta";

export const DEFINICOES_PROJETOS: Record<IndicadorProjetos, string[]> = {
  execucao: [
    "Em execução = card aberto no quadro Projetos, de Execução em diante. Handoff ainda não começou. Finalizado e Perdido são registro: aparecem só em \"Encerrados no período\", pela entrada na fase, e não entram em nenhuma conta.",
    "Previstas no período = entregas ativas com o previsto ORIGINAL (o combinado na proposta) no período. Feitas no período = entregas ativas com a data real no período: uma entrega atrasada de outro período conta nas feitas do período em que saiu.",
    "Atrasadas = pendentes com o previsto atual antes de hoje (a mesma conta do cronograma).",
    "Atraso acumulado = soma dos dias além do previsto ORIGINAL em cada entrega ativa. Feita: até a data real. Pendente: até hoje ou até a nova data prevista, o que vier depois, porque ajustar a data não apaga o atraso. Entrega adiantada não compensa outra.",
    "Ajustes = mudanças de data das entregas ativas. Entrega cancelada não entra em nenhuma conta, nem os ajustes dela.",
    "Sem previsto = nenhuma entrega ativa (projeto migrado sem cronograma ou com tudo cancelado): não conta como atrasado.",
    "Só previstas e feitas dependem do período; o resto é a situação de agora. Dias de São Paulo. O filtro por GP usa quem responde pela execução: o GP designado que ainda vale, senão o responsável do card.",
  ],
  atrasados: [
    "Atrasado = projeto em execução com ao menos uma entrega pendente com o previsto atual antes de hoje. Do mais atrasado para o menos, pelo atraso acumulado frente ao previsto original.",
    "Projeto sem previsto não tem como atrasar: vem contado à parte.",
  ],
  alertas: [
    "Vermelho e amarelo = cor do último check-in de cada projeto em execução, mesmo de semanas anteriores.",
    "Sem check-in na semana = sem check-in na semana corrente (segunda a domingo de São Paulo). Como no lembrete, a semana em que o projeto entrou em Execução não é cobrada, e projeto já em Execução no deploy, sem entrega nem check-in, também não.",
    "Semanas cobradas = semanas em que o lembrete já avisou o GP da falta de check-in.",
  ],
  caneta: [
    "Parada agora = propostas com a caneta com a pessoa, em curso ou prontas para envio, com o card aberto em Vendas. Conta desde que a caneta chegou até ela, mesmo que ela tenha editado o rascunho. Enviada é a vez do cliente e não conta; em Projetos a proposta já congelou.",
    "No período = tempo com a caneta dentro do período, em todos os períodos que a pessoa teve, sem a espera pela resposta do último envio ao cliente. Em proposta reenviada, a espera dos envios anteriores não é conhecida e conta.",
    "Sem ninguém = propostas em curso sem ninguém com a caneta: o GP do lado pega. No filtro, a tela e a ferramenta mostram só as linhas da pessoa.",
  ],
};

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
