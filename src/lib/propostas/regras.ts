/**
 * Regras puras da proposta (GAB-86): quem cria, rótulos de status e textos
 * de erro (os mesmos na tela e no MCP). Roda no cliente e no servidor.
 * Quem EDITA e a máquina de estados do pingue-pongue: `./caneta.ts` (GAB-87).
 */
import type { StatusProposta } from "@prisma/client";
import { ladoDe, type PessoaComLado } from "@/lib/auth/areas";
import { podeEscrever, temPapelMinimo } from "@/lib/auth/papeis";
import { MOTIVO_INVIAVEL_MAX } from "./caneta";

export const ROTULO_STATUS_PROPOSTA: Record<StatusProposta, string> = {
  RASCUNHO: "Rascunho",
  EM_ANALISE: "Em análise",
  EM_AJUSTE: "Em ajuste",
  PRONTA_PARA_ENVIO: "Pronta para envio",
  ENVIADA: "Enviada",
  ACEITA: "Aceita",
  RECUSADA: "Recusada",
  REVISAO_PEDIDA: "Revisão pedida",
  INVIAVEL: "Inviável",
};

export const STATUS_PROPOSTA: readonly StatusProposta[] = Object.keys(ROTULO_STATUS_PROPOSTA) as StatusProposta[];

export const NOTA_VERSAO_MAX = 500;

/**
 * Quem CRIA a proposta: quem escreve no CRM e é de VENDAS e responsável pelo
 * Projeto; gestão (gestor/admin) também. Depois de criada, quem edita é o dono
 * da caneta (`podeEditarProposta` em ./caneta.ts) — gestão não age na caneta.
 */
export function podeCriarProposta(pessoa: PessoaComLado & { id: string }, projeto: { responsavelId: string }): boolean {
  if (!podeEscrever(pessoa.papel)) return false;
  if (temPapelMinimo(pessoa.papel, "GESTOR")) return true;
  return ladoDe(pessoa) === "VENDAS" && projeto.responsavelId === pessoa.id;
}

export type ErroProposta =
  | "PROJETO_NAO_ENCONTRADO"
  | "PROPOSTA_NAO_ENCONTRADA"
  | "PROPOSTA_JA_EXISTE"
  | "SEM_PERMISSAO"
  | "CONTEUDO_INVALIDO"
  | "CONTEUDO_LONGO"
  | "NOTA_LONGA"
  | "SEM_MUDANCAS"
  | "VERSAO_NAO_ENCONTRADA"
  // GAB-87: caneta e pingue-pongue
  | "SEM_CANETA"
  | "PROPOSTA_PRONTA"
  | "PROPOSTA_ENCERRADA"
  | "DESTINO_MESMO_LADO"
  | "DESTINO_OUTRO_LADO"
  | "CONCORDAR_SEM_VERSAO"
  | "CONCORDAR_PROPRIA_VERSAO"
  | "CONCORDAR_RASCUNHO_ALTERADO"
  | "DEVOLVER_SEM_MUDANCAS"
  | "SO_GP_PEGA"
  | "JA_COM_A_CANETA"
  | "REABRIR_SO_PRONTA"
  | "INVIAVEL_SEM_PERMISSAO"
  | "MOTIVO_INVIAVEL_OBRIGATORIO"
  | "MOTIVO_INVIAVEL_LONGO"
  | "PROJETO_FORA_DE_VENDAS"
  | "PROJETO_ENCERRADO"
  | "FASE_PERDIDO_INDISPONIVEL";

export const MENSAGEM_ERRO_PROPOSTA: Record<ErroProposta, string> = {
  PROJETO_NAO_ENCONTRADO: "Projeto não encontrado (pode ter sido excluído). Recarregue a página.",
  PROPOSTA_NAO_ENCONTRADA: "Este projeto ainda não tem proposta.",
  PROPOSTA_JA_EXISTE: "Este projeto já tem uma proposta (é uma por projeto).",
  SEM_PERMISSAO: "Só quem é de vendas e responsável pelo projeto (ou a gestão) cria a proposta. Você pode ler.",
  CONTEUDO_INVALIDO: "Conteúdo inválido: use só a formatação do editor (títulos, negrito, itálico, listas e linha).",
  CONTEUDO_LONGO: "A proposta passou do tamanho máximo (100 mil caracteres).",
  NOTA_LONGA: `A nota da versão pode ter até ${NOTA_VERSAO_MAX} caracteres.`,
  SEM_MUDANCAS: "Nada mudou desde a última versão: não há o que salvar.",
  VERSAO_NAO_ENCONTRADA: "Versão não encontrada.",
  SEM_CANETA: "Você não está com a caneta: só quem está com ela edita, passa, devolve ou concorda. Você pode ler (e comentar).",
  PROPOSTA_PRONTA: "A proposta está pronta para envio: para mudar algo, reabra para ajuste antes.",
  PROPOSTA_ENCERRADA: "A proposta já saiu do pingue-pongue (enviada, respondida ou inviável): não dá mais para editar nem mexer na caneta.",
  DESTINO_MESMO_LADO: "Passar a caneta é para outra pessoa do MESMO lado, ativa e que pode editar. Para mandar ao outro lado, use Devolver.",
  DESTINO_OUTRO_LADO: "Devolver é para alguém do OUTRO lado (vendas ↔ projetos), ativo e que pode editar.",
  CONCORDAR_SEM_VERSAO: "Ainda não há versão do outro lado para concordar.",
  CONCORDAR_PROPRIA_VERSAO: "Só dá para concordar com uma versão que veio do outro lado. A última versão é do seu lado: devolva para o outro lado avaliar.",
  CONCORDAR_RASCUNHO_ALTERADO: "O rascunho mudou depois da versão recebida, e concordar é aceitar sem editar. Devolva (salva uma versão com as mudanças) ou desfaça-as.",
  DEVOLVER_SEM_MUDANCAS: "Nada mudou desde a versão que veio do outro lado: para aceitá-la como está, use Concordar.",
  SO_GP_PEGA: "Só o GP do lado que está com a caneta pode pegá-la. Peça a quem está com ela para passar.",
  JA_COM_A_CANETA: "Você já está com a caneta.",
  REABRIR_SO_PRONTA: "Só dá para reabrir uma proposta pronta para envio.",
  INVIAVEL_SEM_PERMISSAO: "Só o GP de projetos ou quem está com a caneta do lado de projetos marca a proposta como inviável.",
  MOTIVO_INVIAVEL_OBRIGATORIO: "Diga o motivo de a proposta ser inviável.",
  MOTIVO_INVIAVEL_LONGO: `O motivo pode ter até ${MOTIVO_INVIAVEL_MAX} caracteres.`,
  PROJETO_FORA_DE_VENDAS: "O projeto não está no quadro de Vendas: a proposta não pode mais ser marcada como inviável por aqui.",
  PROJETO_ENCERRADO: "O projeto já está em ganho ou perdido: reabra o card antes de marcar a proposta como inviável.",
  FASE_PERDIDO_INDISPONIVEL: "A fase Perdido do quadro de Vendas não está disponível (arquivada?). Fale com a gestão.",
};

/** Texto do conflito de edição concorrente (tela e MCP). */
export function mensagemConflito(c: { revisao: number; por: string | null; viaMcp: boolean }): string {
  const quem = c.por ? ` por ${c.por}${c.viaMcp ? " (via MCP)" : ""}` : "";
  return `A proposta foi alterada em outro lugar${quem} (agora na revisão ${c.revisao}). Nada foi sobrescrito: recarregue a versão atual e reaplique a sua mudança.`;
}
