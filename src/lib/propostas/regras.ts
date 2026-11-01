/**
 * Regras puras da proposta (GAB-86): quem edita, rótulos de status e textos
 * de erro (os mesmos na tela e no MCP). Roda no cliente e no servidor.
 *
 * Status (spec §4.3): o enum já tem o ciclo inteiro do pingue-pongue para o
 * próximo ticket (caneta, GAB-87) só passar a usá-los; nesta fatia toda
 * proposta fica em RASCUNHO.
 */
import type { StatusProposta } from "@prisma/client";
import { ladoDe, type PessoaComLado } from "@/lib/auth/areas";
import { podeEscrever, temPapelMinimo } from "@/lib/auth/papeis";

export const ROTULO_STATUS_PROPOSTA: Record<StatusProposta, string> = {
  RASCUNHO: "Rascunho",
  EM_ANALISE: "Em análise",
  EM_AJUSTE: "Em ajuste",
  PRONTA_PARA_ENVIO: "Pronta para envio",
  ENVIADA: "Enviada",
  ACEITA: "Aceita",
  RECUSADA: "Recusada",
  REVISAO_PEDIDA: "Revisão pedida",
};

export const STATUS_PROPOSTA: readonly StatusProposta[] = Object.keys(ROTULO_STATUS_PROPOSTA) as StatusProposta[];

export const NOTA_VERSAO_MAX = 500;

/**
 * Quem cria e edita a proposta NESTA fatia (antes da caneta): quem escreve no
 * CRM e é de VENDAS e responsável pelo Projeto; gestão (gestor/admin) também.
 * Projetos e o resto leem (transparência, §4.12). A caneta (GAB-87) troca
 * esta regra por "dono da caneta" — este é o ÚNICO ponto a mudar.
 */
export function podeEditarProposta(pessoa: PessoaComLado & { id: string }, projeto: { responsavelId: string }): boolean {
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
  | "VERSAO_NAO_ENCONTRADA";

export const MENSAGEM_ERRO_PROPOSTA: Record<ErroProposta, string> = {
  PROJETO_NAO_ENCONTRADO: "Projeto não encontrado (pode ter sido excluído). Recarregue a página.",
  PROPOSTA_NAO_ENCONTRADA: "Este projeto ainda não tem proposta.",
  PROPOSTA_JA_EXISTE: "Este projeto já tem uma proposta (é uma por projeto).",
  SEM_PERMISSAO: "Só quem é de vendas e responsável pelo projeto (ou a gestão) edita a proposta. Você pode ler.",
  CONTEUDO_INVALIDO: "Conteúdo inválido: use só a formatação do editor (títulos, negrito, itálico, listas e linha).",
  CONTEUDO_LONGO: "A proposta passou do tamanho máximo (100 mil caracteres).",
  NOTA_LONGA: `A nota da versão pode ter até ${NOTA_VERSAO_MAX} caracteres.`,
  SEM_MUDANCAS: "Nada mudou desde a última versão: não há o que salvar.",
  VERSAO_NAO_ENCONTRADA: "Versão não encontrada.",
};

/** Texto do conflito de edição concorrente (tela e MCP). */
export function mensagemConflito(c: { revisao: number; por: string | null; viaMcp: boolean }): string {
  const quem = c.por ? ` por ${c.por}${c.viaMcp ? " (via MCP)" : ""}` : "";
  return `A proposta foi alterada em outro lugar${quem} (agora na revisão ${c.revisao}). Nada foi sobrescrito: recarregue a versão atual e reaplique a sua mudança.`;
}
