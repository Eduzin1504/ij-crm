/**
 * Quem vê qual proposta (GAB-98, spec áreas §4.5 e §4.7). A regra é a pura de
 * `auth/visibilidade`; aqui mora o que precisa do banco: saber se a pessoa está
 * ESCALADA. Escalado = responsável do card, dono atual ou ex-dono da caneta
 * (`PropostaCaneta`) ou quem criou a proposta (os avisos do sino vão para quem
 * criou, e o link do aviso precisa abrir). Passar a caneta grava o período, então
 * quem recebe passa a ter acesso na mesma transação.
 *
 * Sem import de `./propostas`: o serviço usa este módulo para listar.
 */
import type { Prisma } from "@prisma/client";
import { podeVerProposta, veTodasAsPropostas, type PessoaComId } from "@/lib/auth/visibilidade";
import { podeEscrever } from "@/lib/auth/papeis";
import { db } from "@/lib/db";

export const MENSAGEM_SEM_ACESSO_PROPOSTA = "Você não tem acesso a esta proposta: ela é visível a quem está escalado (responsável do card ou quem teve a caneta), ao GP e à gestão.";

/** Filtro das propostas em que a pessoa está escalada. */
function ondeEscalado(usuarioId: string): Prisma.PropostaWhereInput {
  return { OR: [{ projeto: { responsavelId: usuarioId } }, { canetaComId: usuarioId }, { criadoPorId: usuarioId }, { periodosCaneta: { some: { usuarioId } } }] };
}

/** `where` de `proposta` para uma lista: quem vê todas não filtra; VISUALIZADOR não acha nenhuma. */
export function filtroPropostasVisiveis(p: PessoaComId): Prisma.PropostaWhereInput {
  if (veTodasAsPropostas(p)) return {};
  return podeEscrever(p.papel) ? ondeEscalado(p.id) : { id: { in: [] } };
}

/**
 * A pessoa abre a proposta deste projeto? Sem proposta ainda, vale o responsável:
 * é quem a cria. Quem vê todas passa sem consulta (projeto inexistente é o 404 de quem chamou).
 */
export async function podeVerPropostaDoProjeto(p: PessoaComId, projetoId: string): Promise<boolean> {
  if (veTodasAsPropostas(p)) return true;
  if (!podeEscrever(p.papel)) return false;
  const achado = await db.projeto.findFirst({
    where: { id: projetoId, deletadoEm: null, OR: [{ responsavelId: p.id }, { proposta: { is: ondeEscalado(p.id) } }] },
    select: { id: true },
  });
  return podeVerProposta(p, achado !== null);
}

/** Projetos com proposta que a pessoa vê, entre os dados: para o badge do Kanban (uma consulta só). */
async function projetosComPropostaVisivel(p: PessoaComId, projetoIds: string[]): Promise<Set<string>> {
  if (projetoIds.length === 0) return new Set();
  const linhas = await db.proposta.findMany({ where: { projetoId: { in: projetoIds }, ...filtroPropostasVisiveis(p) }, select: { projetoId: true } });
  return new Set(linhas.map((l) => l.projetoId));
}

/** Tira do quadro o status das propostas que a pessoa não vê: o card fica como se não tivesse. */
export async function ocultarPropostasDoQuadro<C extends { id: string; proposta: unknown }, Q extends { cards: C[] }>(quadro: Q, p: PessoaComId): Promise<Q> {
  if (veTodasAsPropostas(p)) return quadro;
  const comProposta = quadro.cards.filter((c) => c.proposta !== null).map((c) => c.id);
  const visiveis = await projetosComPropostaVisivel(p, comProposta);
  return { ...quadro, cards: quadro.cards.map((c) => (c.proposta === null || visiveis.has(c.id) ? c : { ...c, proposta: null })) };
}

type EntradaDaTimeline = { tipo: string; payload: unknown };

/** Entrada da Timeline do card que conta da proposta: eventos dela e o campo "Proposta (link)". */
export function entradaDaProposta(t: EntradaDaTimeline): boolean {
  if (t.tipo === "PROPOSTA") return true;
  if (t.tipo !== "CAMPO_ALTERADO" || !t.payload || typeof t.payload !== "object") return false;
  return (t.payload as { campo?: unknown }).campo === "propostaUrl";
}
