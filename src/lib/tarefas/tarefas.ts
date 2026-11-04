/**
 * Kanban interno do projeto (tarefas do time de projetos). Spec:
 * docs/superpowers/specs/2026-11-04-kanban-interno-projeto-spec.md.
 *
 * Regras que não podem furar:
 * - Toda operação passa por `podeVerTarefas` (ponto único em `auth/areas.ts`).
 * - Só card no quadro de Projetos (`pipeline.chave === "projetos"`); fora dele, a
 *   tarefa continua no banco e volta a aparecer quando o card retorna.
 * - A tarefa precisa ser do projeto informado (nada de id de outro projeto).
 * - **Nunca grava na `Timeline` do card** (a Timeline é visível para Vendas).
 * - `numero` (#12) por projeto, gerado sob lock da linha do projeto, nunca
 *   reaproveitado: o máximo conta tarefas soft-deletadas.
 * - Aviso no sino para quem recebe a tarefa, depois do commit; nunca para quem
 *   atribui a si mesmo.
 */
import type { StatusTarefa } from "@prisma/client";
import { podeVerTarefas, type PessoaComLado } from "@/lib/auth/areas";
import { emitirAvisos } from "@/lib/avisos/avisos";
import { diaDoPrazo, instanteDoPrazo } from "@/lib/calendario/semana";
import { db } from "@/lib/db";

export type Ator = PessoaComLado & { id: string; nome: string };

export type ErroTarefa = "SEM_PERMISSAO" | "PROJETO_NAO_ENCONTRADO" | "TAREFA_NAO_ENCONTRADA" | "RESPONSAVEL_INVALIDO" | "DADOS_INVALIDOS";

export const MENSAGEM_ERRO_TAREFA: Record<ErroTarefa, string> = {
  SEM_PERMISSAO: "Só o time de projetos mexe nas tarefas.",
  PROJETO_NAO_ENCONTRADO: "Projeto não encontrado no quadro de Projetos.",
  TAREFA_NAO_ENCONTRADA: "Tarefa não encontrada neste projeto.",
  RESPONSAVEL_INVALIDO: "Essa pessoa não pode receber tarefas deste projeto.",
  DADOS_INVALIDOS: "Dados inválidos.",
};

export type Resultado<T> = ({ ok: true } & T) | { ok: false; erro: ErroTarefa };

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

const PIPELINE_PROJETOS = "projetos";

class ErroDeRegra extends Error {
  constructor(readonly erro: ErroTarefa) {
    super(erro);
  }
}

/** Card vivo e no quadro de Projetos; senão null (a rota responde 404). */
export async function projetoComTarefas(projetoId: string): Promise<ProjetoTarefas | null> {
  const p = await db.projeto.findFirst({ where: { id: projetoId, deletadoEm: null }, select: { id: true, titulo: true, pipeline: { select: { chave: true } } } });
  if (!p || p.pipeline.chave !== PIPELINE_PROJETOS) return null;
  return { id: p.id, titulo: p.titulo, pipelineChave: p.pipeline.chave };
}

type Tx = Parameters<Parameters<typeof db.$transaction>[0]>[0];

/** Trava a linha do projeto (numeração e posição são por projeto) e reconfere o quadro sob o lock. */
async function travarProjeto(tx: Tx, projetoId: string): Promise<ProjetoTarefas> {
  await tx.$queryRaw`SELECT id FROM oportunidade WHERE id = ${projetoId} FOR UPDATE`;
  const p = await tx.projeto.findFirst({ where: { id: projetoId, deletadoEm: null }, select: { id: true, titulo: true, pipeline: { select: { chave: true } } } });
  if (!p || p.pipeline.chave !== PIPELINE_PROJETOS) throw new ErroDeRegra("PROJETO_NAO_ENCONTRADO");
  return { id: p.id, titulo: p.titulo, pipelineChave: p.pipeline.chave };
}

/** Responsável válido: pessoa ativa que passa em `podeVerTarefas`. */
async function conferirResponsavel(tx: Tx, usuarioId: string): Promise<void> {
  const u = await tx.usuario.findFirst({ where: { id: usuarioId, ativo: true }, select: { papel: true, area: true, cargos: true } });
  if (!u || !podeVerTarefas(u)) throw new ErroDeRegra("RESPONSAVEL_INVALIDO");
}

const DIA = /^\d{4}-\d{2}-\d{2}$/;

/** `YYYY-MM-DD` válido → instante da coluna DATE; null limpa. Inválido → DADOS_INVALIDOS. */
function interpretarPrazo(prazo: string | null | undefined): Date | null | undefined {
  if (prazo === undefined) return undefined;
  if (prazo === null || prazo === "") return null;
  if (!DIA.test(prazo)) throw new ErroDeRegra("DADOS_INVALIDOS");
  const d = instanteDoPrazo(prazo);
  if (Number.isNaN(d.getTime()) || diaDoPrazo(d) !== prazo) throw new ErroDeRegra("DADOS_INVALIDOS");
  return d;
}

function interpretarTitulo(titulo: string): string {
  const t = titulo.trim();
  if (t.length === 0 || t.length > TITULO_MAX) throw new ErroDeRegra("DADOS_INVALIDOS");
  return t;
}

function traduzir(e: unknown): { ok: false; erro: ErroTarefa } {
  if (e instanceof ErroDeRegra) return { ok: false, erro: e.erro };
  throw e;
}

/** Aviso no sino para quem passou a ser responsável (nunca para quem atribuiu a si mesmo). Depois do commit; nunca lança. */
async function avisarAtribuicao(
  ator: Ator,
  projeto: ProjetoTarefas,
  tarefa: { numero: number; titulo: string },
  antes: string | null,
  depois: string | null,
): Promise<void> {
  if (!depois || depois === antes || depois === ator.id) return;
  const titulo = tarefa.titulo.length > 80 ? `${tarefa.titulo.slice(0, 79)}…` : tarefa.titulo;
  await emitirAvisos([{ usuarioId: depois, tipo: "TAREFA_ATRIBUIDA", titulo: `${ator.nome} te atribuiu #${tarefa.numero} ${titulo} em ${projeto.titulo}`, projetoId: projeto.id }]);
}

export async function listarQuadro(projetoId: string, ator: PessoaComLado): Promise<Resultado<{ projeto: ProjetoTarefas; tarefas: TarefaLista[]; pessoas: PessoaTarefa[] }>> {
  if (!podeVerTarefas(ator)) return { ok: false, erro: "SEM_PERMISSAO" };
  const projeto = await projetoComTarefas(projetoId);
  if (!projeto) return { ok: false, erro: "PROJETO_NAO_ENCONTRADO" };
  const linhas = await db.tarefa.findMany({ where: { projetoId, deletadoEm: null }, orderBy: [{ posicao: "asc" }, { numero: "asc" }] });
  const tarefas: TarefaLista[] = linhas.map((t) => ({
    id: t.id,
    numero: t.numero,
    titulo: t.titulo,
    descricao: t.descricao,
    status: t.status,
    prioridade: t.prioridade,
    posicao: t.posicao,
    responsavelId: t.responsavelId,
    prazo: t.prazo ? diaDoPrazo(t.prazo) : null,
    etiquetas: t.etiquetas,
    paiId: t.paiId,
    concluidaEmMs: t.concluidaEm?.getTime() ?? null,
    criadoEmMs: t.criadoEm.getTime(),
  }));
  const pessoas = await listarPessoas(tarefas.map((t) => t.responsavelId).filter((id): id is string => id !== null));
  return { ok: true, projeto, tarefas, pessoas };
}

/** Ativos que passam na regra + responsáveis inativos de tarefas vivas (continuam visíveis e reatribuíveis). */
async function listarPessoas(responsaveis: string[]): Promise<PessoaTarefa[]> {
  const us = await db.usuario.findMany({
    where: { OR: [{ ativo: true }, { id: { in: responsaveis } }] },
    orderBy: { nome: "asc" },
    select: { id: true, nome: true, papel: true, area: true, cargos: true, ativo: true, foto: { select: { atualizadoEm: true } } },
  });
  return us
    .filter((u) => (u.ativo ? podeVerTarefas(u) : true))
    .map((u) => ({ id: u.id, nome: u.nome, fotoEm: u.foto?.atualizadoEm.getTime() ?? null, ativo: u.ativo }));
}

export type NovaTarefa = { titulo: string; status?: StatusTarefa; responsavelId?: string | null; prazo?: string | null; paiId?: string | null };

export async function criarTarefa(projetoId: string, dados: NovaTarefa, ator: Ator): Promise<Resultado<{ id: string; numero: number }>> {
  if (!podeVerTarefas(ator)) return { ok: false, erro: "SEM_PERMISSAO" };
  try {
    const titulo = interpretarTitulo(dados.titulo);
    const prazo = interpretarPrazo(dados.prazo) ?? null;
    const status = dados.status ?? "A_FAZER";
    if (!STATUS_TAREFA.includes(status)) throw new ErroDeRegra("DADOS_INVALIDOS");
    const criada = await db.$transaction(async (tx) => {
      const projeto = await travarProjeto(tx, projetoId);
      if (dados.responsavelId) await conferirResponsavel(tx, dados.responsavelId);
      if (dados.paiId) {
        // Subtarefa de um nível só: o pai é do mesmo projeto, vivo e não é subtarefa.
        const pai = await tx.tarefa.findFirst({ where: { id: dados.paiId, projetoId, deletadoEm: null }, select: { paiId: true } });
        if (!pai || pai.paiId) throw new ErroDeRegra("DADOS_INVALIDOS");
      }
      // Máximo inclui soft-deletadas: número excluído não volta.
      const [maxNumero, maxPosicao] = await Promise.all([
        tx.tarefa.aggregate({ where: { projetoId }, _max: { numero: true } }),
        tx.tarefa.aggregate({ where: { projetoId, status, deletadoEm: null }, _max: { posicao: true } }),
      ]);
      const t = await tx.tarefa.create({
        data: {
          projetoId,
          numero: (maxNumero._max.numero ?? 0) + 1,
          titulo,
          status,
          posicao: (maxPosicao._max.posicao ?? 0) + 1,
          responsavelId: dados.responsavelId ?? null,
          prazo,
          paiId: dados.paiId ?? null,
          concluidaEm: fechada(status) ? new Date() : null,
          criadoPorId: ator.id,
        },
        select: { id: true, numero: true, titulo: true, responsavelId: true },
      });
      return { projeto, t };
    });
    await avisarAtribuicao(ator, criada.projeto, criada.t, null, criada.t.responsavelId);
    return { ok: true, id: criada.t.id, numero: criada.t.numero };
  } catch (e) {
    return traduzir(e);
  }
}

export type PatchTarefa = Partial<{ titulo: string; descricao: string | null; status: StatusTarefa; responsavelId: string | null; prazo: string | null }>;

export async function editarTarefa(projetoId: string, tarefaId: string, patch: PatchTarefa, ator: Ator): Promise<Resultado<object>> {
  if (!podeVerTarefas(ator)) return { ok: false, erro: "SEM_PERMISSAO" };
  try {
    const dados: { titulo?: string; descricao?: string | null; status?: StatusTarefa; responsavelId?: string | null; prazo?: Date | null; concluidaEm?: Date | null } = {};
    if (patch.titulo !== undefined) dados.titulo = interpretarTitulo(patch.titulo);
    if (patch.descricao !== undefined) {
      const d = patch.descricao?.trim() ?? "";
      if (d.length > DESCRICAO_MAX) throw new ErroDeRegra("DADOS_INVALIDOS");
      dados.descricao = d || null;
    }
    if (patch.status !== undefined) {
      if (!STATUS_TAREFA.includes(patch.status)) throw new ErroDeRegra("DADOS_INVALIDOS");
      dados.status = patch.status;
    }
    if (patch.responsavelId !== undefined) dados.responsavelId = patch.responsavelId || null;
    const prazo = interpretarPrazo(patch.prazo);
    if (prazo !== undefined) dados.prazo = prazo;

    const r = await db.$transaction(async (tx) => {
      const projeto = await travarProjeto(tx, projetoId);
      const atual = await tx.tarefa.findFirst({ where: { id: tarefaId, projetoId, deletadoEm: null }, select: { numero: true, titulo: true, status: true, responsavelId: true } });
      if (!atual) throw new ErroDeRegra("TAREFA_NAO_ENCONTRADA");
      if (dados.responsavelId) await conferirResponsavel(tx, dados.responsavelId);
      if (dados.status !== undefined && fechada(dados.status) !== fechada(atual.status)) dados.concluidaEm = fechada(dados.status) ? new Date() : null;
      const t = await tx.tarefa.update({ where: { id: tarefaId }, data: dados, select: { numero: true, titulo: true, responsavelId: true } });
      return { projeto, antes: atual.responsavelId, t };
    });
    await avisarAtribuicao(ator, r.projeto, r.t, r.antes, r.t.responsavelId);
    return { ok: true };
  } catch (e) {
    return traduzir(e);
  }
}

export type Destino = { status: StatusTarefa; posicao: number; responsavelId?: string | null };

/** Arrastar no quadro: muda status, posição e (quando a linha é por responsável) o responsável. */
export async function moverTarefa(projetoId: string, tarefaId: string, para: Destino, ator: Ator): Promise<Resultado<object>> {
  if (!podeVerTarefas(ator)) return { ok: false, erro: "SEM_PERMISSAO" };
  try {
    if (!STATUS_TAREFA.includes(para.status) || !Number.isFinite(para.posicao)) throw new ErroDeRegra("DADOS_INVALIDOS");
    const r = await db.$transaction(async (tx) => {
      const projeto = await travarProjeto(tx, projetoId);
      const atual = await tx.tarefa.findFirst({ where: { id: tarefaId, projetoId, deletadoEm: null }, select: { numero: true, titulo: true, status: true, responsavelId: true } });
      if (!atual) throw new ErroDeRegra("TAREFA_NAO_ENCONTRADA");
      const responsavelId = para.responsavelId === undefined ? atual.responsavelId : para.responsavelId || null;
      if (responsavelId && responsavelId !== atual.responsavelId) await conferirResponsavel(tx, responsavelId);
      const t = await tx.tarefa.update({
        where: { id: tarefaId },
        data: {
          status: para.status,
          posicao: para.posicao,
          responsavelId,
          ...(fechada(para.status) !== fechada(atual.status) ? { concluidaEm: fechada(para.status) ? new Date() : null } : {}),
        },
        select: { numero: true, titulo: true, responsavelId: true },
      });
      return { projeto, antes: atual.responsavelId, t };
    });
    await avisarAtribuicao(ator, r.projeto, r.t, r.antes, r.t.responsavelId);
    return { ok: true };
  } catch (e) {
    return traduzir(e);
  }
}

/** Soft delete da tarefa e das subtarefas (mesmo instante). O número não volta. */
export async function excluirTarefa(projetoId: string, tarefaId: string, ator: Ator): Promise<Resultado<object>> {
  if (!podeVerTarefas(ator)) return { ok: false, erro: "SEM_PERMISSAO" };
  try {
    await db.$transaction(async (tx) => {
      await travarProjeto(tx, projetoId);
      const r = await tx.tarefa.updateMany({ where: { projetoId, deletadoEm: null, OR: [{ id: tarefaId }, { paiId: tarefaId }] }, data: { deletadoEm: new Date() } });
      if (r.count === 0) throw new ErroDeRegra("TAREFA_NAO_ENCONTRADA");
    });
    return { ok: true };
  } catch (e) {
    return traduzir(e);
  }
}
