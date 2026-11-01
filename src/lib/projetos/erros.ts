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
  /** Ator VISUALIZADOR (somente leitura). */
  | "SEM_PERMISSAO"
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
  MOTIVO_PERDA_DETALHE_LONGO: `O detalhe do motivo pode ter até ${DETALHE_PERDA_MAX} caracteres.`,
};
