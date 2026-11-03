/**
 * Comentários na proposta (GAB-91, spec fase 2 §4.6). A tela (server actions
 * + polling em /api/projetos/[id]/comentarios) e o conector MCP chamam ESTAS
 * funções — nenhuma regra mora fora.
 *
 * - Qualquer usuário ATIVO comenta, responde, resolve e reabre, em qualquer
 *   etapa e sem a caneta. Comentar não edita o texto (a caneta segue valendo
 *   para editar). [escolha do agente] VISUALIZADOR também comenta: a spec diz
 *   "qualquer usuário logado comenta" (§4.6) e a transparência é o objetivo
 *   (§4.12); comentário não muda o Projeto nem a proposta.
 * - Comentário geral ou preso a um trecho (âncora = trecho citado + contexto,
 *   `./ancora.ts`). Da tela vem a âncora pronta (o editor pode ter texto ainda
 *   não gravado pelo autosave); do MCP vem só o trecho, que o servidor acha no
 *   rascunho atual (não achou → TRECHO_NAO_ENCONTRADO).
 * - Respostas: um nível; responder a uma resposta entra na mesma thread.
 * - Resolver/reabrir: estado na raiz + evento na Timeline do Projeto (o
 *   histórico, marcado "via MCP" pelo `db` quando for o caso).
 * - Preso à PROPOSTA, não à versão: sobrevive a versões novas. Trecho que sumiu
 *   do rascunho = `trechoAlterado` (o comentário continua visível).
 * - Aviso só no app (COMENTARIO) para o dono da caneta, depois do commit, pela
 *   camada `emitirAvisos`; quem comentou nunca avisa a si mesmo.
 */
import { emViaMcp } from "@/lib/canal";
import { emitirAvisos } from "@/lib/avisos/avisos";
import { db } from "@/lib/db";
import { CONTEXTO_ANCORA, criarAncora, localizarAncora, textoPlano, TRECHO_MAX, type Ancora } from "./ancora";
import { COMENTARIO_MAX } from "./comentarios-limites";
import { markdownParaDocumento } from "./markdown";

export { COMENTARIO_MAX };

export type ErroComentario =
  | "PROJETO_NAO_ENCONTRADO"
  | "PROPOSTA_NAO_ENCONTRADA"
  | "COMENTARIO_NAO_ENCONTRADO"
  | "SEM_PERMISSAO"
  | "TEXTO_VAZIO"
  | "TEXTO_LONGO"
  | "TRECHO_INVALIDO"
  | "TRECHO_NAO_ENCONTRADO"
  | "JA_RESOLVIDO"
  | "NAO_RESOLVIDO";

export const MENSAGEM_ERRO_COMENTARIO: Record<ErroComentario, string> = {
  PROJETO_NAO_ENCONTRADO: "Projeto não encontrado (ou está na lixeira).",
  PROPOSTA_NAO_ENCONTRADA: "Este projeto ainda não tem proposta.",
  COMENTARIO_NAO_ENCONTRADO: "Comentário não encontrado.",
  SEM_PERMISSAO: "Só usuários ativos comentam.",
  TEXTO_VAZIO: "Escreva o comentário.",
  TEXTO_LONGO: `Comentário longo demais (máximo ${COMENTARIO_MAX} caracteres).`,
  TRECHO_INVALIDO: `Trecho inválido: selecione de 1 a ${TRECHO_MAX} caracteres do texto.`,
  TRECHO_NAO_ENCONTRADO: "Esse trecho não está no texto atual da proposta. Cite o texto exato como aparece (sem a marcação Markdown).",
  JA_RESOLVIDO: "Este comentário já está resolvido.",
  NAO_RESOLVIDO: "Este comentário não está resolvido.",
};

type Falha = { ok: false; erro: ErroComentario };
type Ator = { id: string };

export type ComentarioLido = { id: string; autor: { id: string; nome: string }; texto: string; criadoEm: Date; viaMcp: boolean };
export type Thread = ComentarioLido & {
  /** null = comentário geral. */
  ancora: Ancora | null;
  /** O trecho não está mais no rascunho atual (editado/apagado). */
  trechoAlterado: boolean;
  resolvido: { por: string | null; em: Date } | null;
  respostas: ComentarioLido[];
};

/** Texto puro: apara e tira NUL (o Postgres recusa); o React escapa o resto na tela. */
function limparTexto(t: string): { ok: true; texto: string } | Falha {
  const texto = t.replace(/\u0000/g, "").trim();
  if (!texto) return { ok: false, erro: "TEXTO_VAZIO" };
  if (texto.length > COMENTARIO_MAX) return { ok: false, erro: "TEXTO_LONGO" };
  return { ok: true, texto };
}

async function autorAtivo(id: string) {
  const u = await db.usuario.findUnique({ where: { id }, select: { id: true, nome: true, ativo: true } });
  return u?.ativo ? u : null;
}

/** Proposta de Projeto vivo (fora da lixeira), com o que o aviso precisa. */
async function propostaViva(projetoId: string): Promise<{ id: string; projetoId: string; titulo: string; canetaComId: string | null; conteudoMd: string } | Falha> {
  const projeto = await db.projeto.findFirst({
    where: { id: projetoId, deletadoEm: null },
    select: { titulo: true, proposta: { select: { id: true, canetaComId: true, conteudoMd: true } } },
  });
  if (!projeto) return { ok: false, erro: "PROJETO_NAO_ENCONTRADO" };
  if (!projeto.proposta) return { ok: false, erro: "PROPOSTA_NAO_ENCONTRADA" };
  return { ...projeto.proposta, projetoId, titulo: projeto.titulo };
}

const ehFalha = (x: object): x is Falha => (x as { ok?: unknown }).ok === false;

/** Raiz da thread do comentário (o próprio, se raiz), com a proposta viva. */
async function raizDe(comentarioId: string) {
  const c = await db.propostaComentario.findUnique({
    where: { id: comentarioId },
    select: { id: true, paiId: true, proposta: { select: { projetoId: true } } },
  });
  if (!c) return { ok: false, erro: "COMENTARIO_NAO_ENCONTRADO" } as Falha;
  const p = await propostaViva(c.proposta.projetoId);
  if (ehFalha(p)) return p;
  return { raizId: c.paiId ?? c.id, proposta: p };
}

function ancoraDaTela(a: Ancora): Ancora | null {
  if (typeof a?.trecho !== "string" || typeof a.antes !== "string" || typeof a.depois !== "string") return null;
  const trecho = a.trecho.replace(/\u0000/g, "");
  if (!trecho.trim() || trecho.length > TRECHO_MAX) return null;
  const limpo = (s: string) => s.replace(/\u0000/g, "");
  return { trecho, antes: limpo(a.antes).slice(-CONTEXTO_ANCORA), depois: limpo(a.depois).slice(0, CONTEXTO_ANCORA) };
}

/** Avisa (só no app) o dono da caneta. Depois do commit; nunca lança (`emitirAvisos`). */
async function avisarDono(p: { projetoId: string; titulo: string; canetaComId: string | null }, autor: { id: string; nome: string }, resposta: boolean) {
  if (!p.canetaComId || p.canetaComId === autor.id) return;
  const titulo = resposta ? `${autor.nome} respondeu a um comentário na proposta de "${p.titulo}"` : `${autor.nome} comentou na proposta de "${p.titulo}"`;
  await emitirAvisos([{ usuarioId: p.canetaComId, tipo: "COMENTARIO", titulo, projetoId: p.projetoId }]);
}

/**
 * Comentário novo (raiz). `trecho`: âncora pronta (tela) ou o texto citado
 * (MCP: o servidor acha no rascunho atual, primeira ocorrência).
 */
export async function comentar(projetoId: string, e: { texto: string; trecho?: Ancora | string | null }, ator: Ator): Promise<{ ok: true; comentario: { id: string } } | Falha> {
  const t = limparTexto(e.texto);
  if (!t.ok) return t;
  const autor = await autorAtivo(ator.id);
  if (!autor) return { ok: false, erro: "SEM_PERMISSAO" };
  const p = await propostaViva(projetoId);
  if (ehFalha(p)) return p;

  let ancora: Ancora | null = null;
  if (typeof e.trecho === "string") {
    const citado = e.trecho.replace(/\u0000/g, "").trim();
    if (!citado || citado.length > TRECHO_MAX) return { ok: false, erro: "TRECHO_INVALIDO" };
    const plano = textoPlano(markdownParaDocumento(p.conteudoMd)).texto;
    const i = plano.indexOf(citado);
    if (i === -1) return { ok: false, erro: "TRECHO_NAO_ENCONTRADO" };
    ancora = criarAncora(plano, i, i + citado.length);
  } else if (e.trecho) {
    ancora = ancoraDaTela(e.trecho);
    if (!ancora) return { ok: false, erro: "TRECHO_INVALIDO" };
  }

  const c = await db.propostaComentario.create({
    data: { propostaId: p.id, autorId: autor.id, texto: t.texto, trecho: ancora?.trecho ?? null, trechoAntes: ancora?.antes ?? null, trechoDepois: ancora?.depois ?? null, viaMcp: emViaMcp() },
    select: { id: true },
  });
  await avisarDono(p, autor, false);
  return { ok: true, comentario: c };
}

/** Resposta na thread de `comentarioId` (resposta a resposta vai para a mesma raiz). */
export async function responderComentario(comentarioId: string, texto: string, ator: Ator): Promise<{ ok: true; comentario: { id: string } } | Falha> {
  const t = limparTexto(texto);
  if (!t.ok) return t;
  const autor = await autorAtivo(ator.id);
  if (!autor) return { ok: false, erro: "SEM_PERMISSAO" };
  const r = await raizDe(comentarioId);
  if (ehFalha(r)) return r;
  const c = await db.propostaComentario.create({
    data: { propostaId: r.proposta.id, paiId: r.raizId, autorId: autor.id, texto: t.texto, viaMcp: emViaMcp() },
    select: { id: true },
  });
  await avisarDono(r.proposta, autor, true);
  return { ok: true, comentario: c };
}

async function mudarResolucao(comentarioId: string, ator: Ator, resolver: boolean): Promise<{ ok: true } | Falha> {
  const autor = await autorAtivo(ator.id);
  if (!autor) return { ok: false, erro: "SEM_PERMISSAO" };
  const r = await raizDe(comentarioId);
  if (ehFalha(r)) return r;
  const agora = new Date();
  return db.$transaction(async (tx) => {
    // Condicional no próprio UPDATE: duas pessoas resolvendo juntas → uma só registra.
    const n = await tx.propostaComentario.updateMany({
      where: { id: r.raizId, resolvidoEm: resolver ? null : { not: null } },
      data: resolver ? { resolvidoEm: agora, resolvidoPorId: autor.id } : { resolvidoEm: null, resolvidoPorId: null },
    });
    if (n.count === 0) return { ok: false as const, erro: resolver ? ("JA_RESOLVIDO" as const) : ("NAO_RESOLVIDO" as const) };
    await tx.timeline.create({
      data: { projetoId: r.proposta.projetoId, tipo: "PROPOSTA", usuarioId: autor.id, em: agora, payload: { evento: resolver ? "comentario_resolvido" : "comentario_reaberto", comentarioId: r.raizId } },
    });
    return { ok: true as const };
  });
}

export function resolverComentario(comentarioId: string, ator: Ator) {
  return mudarResolucao(comentarioId, ator, true);
}

export function reabrirComentario(comentarioId: string, ator: Ator) {
  return mudarResolucao(comentarioId, ator, false);
}

// ---------------------------------------------------------------- leitura

/**
 * Carimbo barato para o polling: quantos comentários + o último `atualizado_em`
 * (um aggregate no índice da proposta). Muda a cada comentário, resposta,
 * resolver ou reabrir.
 */
export async function versaoDosComentarios(projetoId: string): Promise<string> {
  const a = await db.propostaComentario.aggregate({ where: { proposta: { projetoId } }, _count: { _all: true }, _max: { atualizadoEm: true } });
  return `${a._count._all}.${a._max.atualizadoEm?.getTime() ?? 0}`;
}

/** Threads da proposta (mais antigas primeiro), com "trecho alterado" contra o rascunho atual. null = sem projeto vivo/proposta. */
export async function listarComentarios(projetoId: string): Promise<{ versao: string; threads: Thread[] } | null> {
  const p = await propostaViva(projetoId);
  if (ehFalha(p)) return null;
  const [versao, linhas] = await Promise.all([
    versaoDosComentarios(projetoId),
    db.propostaComentario.findMany({
      where: { propostaId: p.id },
      orderBy: [{ criadoEm: "asc" }, { id: "asc" }],
      select: {
        id: true,
        paiId: true,
        texto: true,
        trecho: true,
        trechoAntes: true,
        trechoDepois: true,
        viaMcp: true,
        criadoEm: true,
        resolvidoEm: true,
        autor: { select: { id: true, nome: true } },
        resolvidoPor: { select: { nome: true } },
      },
    }),
  ]);
  const plano = linhas.some((l) => l.trecho) ? textoPlano(markdownParaDocumento(p.conteudoMd)).texto : "";
  const threads: Thread[] = [];
  const porId = new Map<string, Thread>();
  const base = (l: (typeof linhas)[number]): ComentarioLido => ({ id: l.id, autor: l.autor, texto: l.texto, criadoEm: l.criadoEm, viaMcp: l.viaMcp });
  for (const l of linhas) {
    if (l.paiId) continue;
    const ancora = l.trecho ? { trecho: l.trecho, antes: l.trechoAntes ?? "", depois: l.trechoDepois ?? "" } : null;
    const t: Thread = {
      ...base(l),
      ancora,
      trechoAlterado: ancora ? localizarAncora(plano, ancora) === null : false,
      resolvido: l.resolvidoEm ? { por: l.resolvidoPor?.nome ?? null, em: l.resolvidoEm } : null,
      respostas: [],
    };
    threads.push(t);
    porId.set(l.id, t);
  }
  for (const l of linhas) if (l.paiId) porId.get(l.paiId)?.respostas.push(base(l));
  return { versao, threads };
}
