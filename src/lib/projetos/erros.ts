/** Erros de regra do serviço de projetos (viram texto em português na action). */
import { DETALHE_PERDA_MAX, type ErroDadosTerminal } from "./terminal-regras";

export type ErroProjeto =
  | "CARD_NAO_ENCONTRADO"
  | "PIPELINE_NAO_ENCONTRADO"
  | "FASE_NAO_ENCONTRADA"
  | "FASE_ARQUIVADA"
  | "FASE_DE_OUTRO_PIPELINE"
  | "FASE_TERMINAL"
  | "CONFLITO_CONCORRENTE"
  | "TITULO_INVALIDO"
  | "RESPONSAVEL_INVALIDO"
  | "NOTA_INVALIDA"
  /** GAB-85: nota do contato fora de 1..5. */
  | "NOTA_CONTATO_INVALIDA"
  | "FASE_HANDOFF_INDISPONIVEL"
  /** GAB-89: Montando contrato (ou além) só com a proposta aceita (`trava-contrato.ts`). */
  | "PROPOSTA_NAO_ACEITA"
  /** GAB-99: Ganho só a partir de Montando contrato (`trava-contrato.ts`). */
  | "GANHO_SO_DE_MONTANDO_CONTRATO"
  /** Ator VISUALIZADOR (somente leitura). */
  | "SEM_PERMISSAO"
  /** GAB-98: card de outra área; quem é de fora comenta, cria prazo e anexa (`acesso-card.ts`). */
  | "FORA_DA_AREA"
  | ErroDadosTerminal;

/** Lançado dentro da transação: aborta (rollback) e vira `{ ok: false, erro }`. */
export class ErroDeRegra extends Error {
  constructor(readonly erro: ErroProjeto) {
    super(erro);
  }
}

/** Texto em português de cada erro de regra: o mesmo na tela (actions do Kanban) e no conector MCP. */
export const MENSAGEM_ERRO_PROJETO: Record<ErroProjeto, string> = {
  CARD_NAO_ENCONTRADO: "Card não encontrado (pode ter sido excluído). Recarregue a página.",
  PIPELINE_NAO_ENCONTRADO: "Quadro não encontrado.",
  FASE_NAO_ENCONTRADA: "Fase não encontrada. Recarregue a página.",
  FASE_ARQUIVADA: "Essa fase foi arquivada. Recarregue a página.",
  FASE_DE_OUTRO_PIPELINE: "Essa fase é de outro quadro.",
  FASE_TERMINAL: "Não dá para criar card direto numa fase de ganho/perdido. Crie numa fase aberta e mova.",
  CONFLITO_CONCORRENTE: "O card ou a fase mudou enquanto você movia. Recarregue e tente de novo.",
  TITULO_INVALIDO: "Informe um título (até 200 caracteres).",
  RESPONSAVEL_INVALIDO: "Responsável inválido ou inativo.",
  NOTA_INVALIDA: "A nota precisa ter entre 1 e 5000 caracteres.",
  NOTA_CONTATO_INVALIDA: "A avaliação do contato vai de 1 a 5.",
  FASE_HANDOFF_INDISPONIVEL: "O quadro Projetos está sem o marco Handoff ativo, para onde vai o card ganho. Peça à gestão/admin para conferir as fases.",
  DADOS_TERMINAL_OBRIGATORIOS: "Faltam os dados do fechamento (valor ou motivo). Mova o card de novo para abrir o diálogo.",
  VALOR_FECHADO_INVALIDO: "Valor fechado inválido. Ex.: 12.500,00",
  MOTIVO_PERDA_OBRIGATORIO: "Escolha o motivo da perda.",
  MOTIVO_PERDA_INVALIDO: "Motivo da perda inválido.",
  MOTIVO_PERDA_DETALHE_OBRIGATORIO: "Em “Outro”, descreva o motivo da perda.",
  SEM_PERMISSAO: "Seu acesso é só de visualização.",
  FORA_DA_AREA: "Este card é de outra área: mover de fase e editar os dados ficam com a área dona e o responsável. Você pode comentar, criar prazo e anexar.",
  PROPOSTA_NAO_ACEITA:
    "Montando contrato (e o que vem depois dele) só com a proposta aceita pelo cliente — nem a gestão força. Registre o aceite na proposta do projeto: ele já leva o card para Montando contrato.",
  GANHO_SO_DE_MONTANDO_CONTRATO: "Ganho (contrato assinado) só a partir de Montando contrato — nem a gestão força. Leve o card para Montando contrato e marque “Contrato assinado” de lá.",
  MOTIVO_PERDA_DETALHE_LONGO: `O detalhe do motivo pode ter até ${DETALHE_PERDA_MAX} caracteres.`,
};
