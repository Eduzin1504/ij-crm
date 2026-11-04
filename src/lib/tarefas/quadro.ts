/**
 * Regras puras do quadro de tarefas (rodam no cliente e no servidor): colunas
 * por status, linhas por responsável e a posição ao soltar um card.
 */
import type { StatusTarefa } from "@prisma/client";
import type { PessoaTarefa } from "./modelo";

export type Coluna = { status: StatusTarefa; nome: string; /** Backlog e Cancelada começam recolhidas (spec §3). */ recolhida: boolean };

export const COLUNAS: readonly Coluna[] = [
  { status: "BACKLOG", nome: "Backlog", recolhida: true },
  { status: "A_FAZER", nome: "A fazer", recolhida: false },
  { status: "EM_ANDAMENTO", nome: "Em andamento", recolhida: false },
  { status: "EM_REVISAO", nome: "Em revisão", recolhida: false },
  { status: "FEITA", nome: "Feita", recolhida: false },
  { status: "CANCELADA", nome: "Cancelada", recolhida: true },
];

export const ROTULO_STATUS: Record<StatusTarefa, string> = Object.fromEntries(COLUNAS.map((c) => [c.status, c.nome])) as Record<StatusTarefa, string>;

/** Chave da linha "Sem responsável" (sempre a última). */
export const SEM_RESPONSAVEL = "none";

export type Linha<T> = { chave: string; nome: string; pessoa: PessoaTarefa | null; tarefas: T[] };

/**
 * Uma linha por pessoa que tem tarefa (ordem por nome), e "Sem responsável" no
 * fim quando há tarefa sem dono. Pessoa sem tarefa não ganha linha: o quadro
 * fica do tamanho do trabalho que existe.
 */
export function agruparPorResponsavel<T extends { responsavelId: string | null }>(tarefas: readonly T[], pessoas: readonly PessoaTarefa[]): Linha<T>[] {
  const porPessoa = new Map<string, T[]>();
  const semDono: T[] = [];
  for (const t of tarefas) {
    if (t.responsavelId === null) semDono.push(t);
    else porPessoa.set(t.responsavelId, [...(porPessoa.get(t.responsavelId) ?? []), t]);
  }
  const linhas: Linha<T>[] = [...pessoas]
    .filter((p) => porPessoa.has(p.id))
    .sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"))
    .map((p) => ({ chave: p.id, nome: p.ativo ? p.nome : `${p.nome} (inativo)`, pessoa: p, tarefas: porPessoa.get(p.id)! }));
  // Responsável que nem está na lista de pessoas (não deveria acontecer): ainda aparece, sem sumir tarefa.
  for (const [id, ts] of porPessoa) if (!pessoas.some((p) => p.id === id)) linhas.push({ chave: id, nome: "Pessoa removida", pessoa: null, tarefas: ts });
  if (semDono.length) linhas.push({ chave: SEM_RESPONSAVEL, nome: "Sem responsável", pessoa: null, tarefas: semDono });
  return linhas;
}

/** Posição ao soltar entre dois vizinhos (float, sem renormalizar: 15 pessoas, poucas centenas de movimentos). */
export function posicaoEntre(antes: number | null, depois: number | null): number {
  if (antes !== null && depois !== null) return (antes + depois) / 2;
  if (antes !== null) return antes + 1;
  if (depois !== null) return depois - 1;
  return 1;
}
