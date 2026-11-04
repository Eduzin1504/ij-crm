/** Tipos e constantes puras do kanban interno: sem banco, importáveis pelo cliente. */
import type { StatusTarefa } from "@prisma/client";

export const STATUS_TAREFA: readonly StatusTarefa[] = ["BACKLOG", "A_FAZER", "EM_ANDAMENTO", "EM_REVISAO", "FEITA", "CANCELADA"];
export const TITULO_MAX = 500;
export const DESCRICAO_MAX = 10_000;

/** FEITA e CANCELADA: tarefa fechada (preenche `concluidaEm`). */
export function fechada(status: StatusTarefa): boolean {
  return status === "FEITA" || status === "CANCELADA";
}

export type TarefaLista = {
  id: string;
  numero: number;
  titulo: string;
  descricao: string | null;
  status: StatusTarefa;
  prioridade: string;
  posicao: number;
  responsavelId: string | null;
  /** `YYYY-MM-DD` ou null (coluna DATE). */
  prazo: string | null;
  etiquetas: string[];
  paiId: string | null;
  concluidaEmMs: number | null;
  criadoEmMs: number;
};

export type PessoaTarefa = { id: string; nome: string; fotoEm: number | null; ativo: boolean };

export type ProjetoTarefas = { id: string; titulo: string; pipelineChave: string };
