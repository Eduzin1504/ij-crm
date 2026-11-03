import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Area, Papel } from "@prisma/client";
import { dbTeste, limparBanco } from "@/test/db";
import { comViaMcp } from "@/lib/canal";
import { invalidarCachePipelines } from "@/lib/fases/cache";
import { COMENTARIO_MAX, comentar, listarComentarios, reabrirComentario, resolverComentario, responderComentario, versaoDosComentarios } from "./comentarios";
import { criarProposta, passarCaneta, salvarRascunho, salvarVersao } from "./propostas";

const db = dbTeste();

async function semear() {
  const vendas = await db.pipeline.create({
    data: { chave: "vendas", nome: "Vendas", ordem: 0, fases: { create: [{ chave: "proposta", nome: "Proposta", ordem: 0, marco: "PROPOSTA" }] } },
    include: { fases: true },
  });
  const pessoa = (nome: string, papel: Papel, area: Area | null = null) => db.usuario.create({ data: { nome, email: `${nome.toLowerCase()}@ij.test`, papel, area } });
  const ana = await pessoa("Ana", "VENDEDOR", "VENDAS");
  const bia = await pessoa("Bia", "VENDEDOR", "VENDAS");
  const paula = await pessoa("Paula", "PROJETOS", "PROJETOS");
  const vera = await pessoa("Vera", "VISUALIZADOR");
  const projeto = await db.projeto.create({
    data: { pipelineId: vendas.id, faseId: vendas.fases[0].id, titulo: "Site da Padaria", responsavelId: ana.id, criadoVia: "UI" },
  });
  const r = await criarProposta(projeto.id, ana);
  if (!r.ok) throw new Error("seed proposta");
  const s = await salvarRascunho(projeto.id, { revisao: r.revisao, conteudo: { markdown: "## Escopo\n\nSite com loja e blog.\n\n## Prazo\n\n30 dias." } }, ana);
  if (!s.ok) throw new Error("seed rascunho");
  return { ana, bia, paula, vera, projeto, revisao: s.revisao };
}

const avisos = () => db.aviso.findMany({ orderBy: { criadoEm: "asc" } });

beforeEach(async () => {
  await limparBanco(["aviso", "proposta_comentario", "proposta_caneta", "proposta_versao", "proposta", "transicao_fase", "timeline", "oportunidade", "fase", "pipeline", "sessao", "usuario"]);
  invalidarCachePipelines();
});
afterEach(() => vi.restoreAllMocks());

describe("comentar (§4.6): qualquer usuário ativo, sem a caneta", () => {
  it("comentário geral e preso a um trecho (âncora vinda da tela); a caneta não é exigida", async () => {
    const { projeto, paula, vera } = await semear();
    const g = await comentar(projeto.id, { texto: "  Faltou o cronograma.  " }, paula);
    expect(g).toMatchObject({ ok: true });
    const t = await comentar(projeto.id, { texto: "Loja é escopo grande", trecho: { trecho: "com loja", antes: "Site ", depois: " e blog." } }, vera);
    expect(t).toMatchObject({ ok: true });

    const l = (await listarComentarios(projeto.id))!;
    expect(l.threads.map((c) => [c.autor.nome, c.texto, c.ancora?.trecho ?? null, c.trechoAlterado])).toEqual([
      ["Paula", "Faltou o cronograma.", null, false],
      ["Vera", "Loja é escopo grande", "com loja", false],
    ]);
    expect(l.threads[1].ancora).toEqual({ trecho: "com loja", antes: "Site ", depois: " e blog." });
  });

  it("trecho como texto (MCP): o servidor acha no rascunho e guarda o contexto; não achou → erro", async () => {
    const { projeto, paula } = await semear();
    const r = await comentar(projeto.id, { texto: "30 é pouco", trecho: "30 dias" }, paula);
    expect(r).toMatchObject({ ok: true });
    const c = await db.propostaComentario.findFirstOrThrow();
    expect(c).toMatchObject({ trecho: "30 dias", trechoAntes: "Escopo\nSite com loja e blog.\nPrazo\n", trechoDepois: "." });
    expect(await comentar(projeto.id, { texto: "x", trecho: "60 dias" }, paula)).toEqual({ ok: false, erro: "TRECHO_NAO_ENCONTRADO" });
  });

  it("limites: vazio, longo, trecho longo; texto puro guardado como veio (sem HTML interpretado)", async () => {
    const { projeto, paula } = await semear();
    expect(await comentar(projeto.id, { texto: "   " }, paula)).toEqual({ ok: false, erro: "TEXTO_VAZIO" });
    expect(await comentar(projeto.id, { texto: "x".repeat(COMENTARIO_MAX + 1) }, paula)).toEqual({ ok: false, erro: "TEXTO_LONGO" });
    expect(await comentar(projeto.id, { texto: "x", trecho: { trecho: "y".repeat(501), antes: "", depois: "" } }, paula)).toEqual({ ok: false, erro: "TRECHO_INVALIDO" });
    expect(await comentar(projeto.id, { texto: "<b>oi</b>\u0000" }, paula)).toMatchObject({ ok: true });
    expect((await db.propostaComentario.findFirstOrThrow()).texto).toBe("<b>oi</b>");
  });

  it("só usuários ativos; projeto na lixeira ou sem proposta → recusa", async () => {
    const { projeto, paula, ana } = await semear();
    await db.usuario.update({ where: { id: paula.id }, data: { ativo: false } });
    expect(await comentar(projeto.id, { texto: "oi" }, paula)).toEqual({ ok: false, erro: "SEM_PERMISSAO" });
    const outro = await db.projeto.create({ data: { pipelineId: projeto.pipelineId, faseId: projeto.faseId, titulo: "Sem proposta", responsavelId: ana.id, criadoVia: "UI" } });
    expect(await comentar(outro.id, { texto: "oi" }, ana)).toEqual({ ok: false, erro: "PROPOSTA_NAO_ENCONTRADA" });
    await db.projeto.update({ where: { id: projeto.id }, data: { deletadoEm: new Date() } });
    expect(await comentar(projeto.id, { texto: "oi" }, ana)).toEqual({ ok: false, erro: "PROJETO_NAO_ENCONTRADO" });
    expect(await listarComentarios(projeto.id)).toBeNull();
  });

  it("via MCP fica marcado", async () => {
    const { projeto, paula } = await semear();
    await comViaMcp(() => comentar(projeto.id, { texto: "pelo Claude" }, paula));
    expect((await listarComentarios(projeto.id))!.threads[0].viaMcp).toBe(true);
  });
});

describe("aviso só no app para o dono da caneta (camada emitirAvisos)", () => {
  it("comentário e resposta de outra pessoa avisam o dono da caneta (COMENTARIO, sem WhatsApp)", async () => {
    const { projeto, paula, ana } = await semear();
    const r = await comentar(projeto.id, { texto: "oi" }, paula);
    if (!r.ok) throw new Error();
    const [a] = await avisos();
    expect(a).toMatchObject({ usuarioId: ana.id, tipo: "COMENTARIO", projetoId: projeto.id, whatsapp: null });
    expect(a.titulo).toContain("Paula");
    expect(a.titulo).toContain("Site da Padaria");
    await responderComentario(r.comentario.id, "e mais", paula);
    expect(await avisos()).toHaveLength(2);
  });

  it("o autor nunca avisa a si mesmo (dono da caneta comentando)", async () => {
    const { projeto, ana } = await semear();
    await comentar(projeto.id, { texto: "nota minha" }, ana);
    expect(await avisos()).toHaveLength(0);
  });

  it("caneta mudou de mão: avisa o dono atual", async () => {
    const { projeto, ana, bia, paula } = await semear();
    const p = await passarCaneta(projeto.id, bia.id, ana);
    if (!p.ok) throw new Error(JSON.stringify(p));
    await db.aviso.deleteMany();
    await comentar(projeto.id, { texto: "oi" }, paula);
    expect((await avisos()).map((a) => a.usuarioId)).toEqual([bia.id]);
  });
});

describe("threads, resolver e reabrir", () => {
  it("resposta entra na thread da raiz (resposta de resposta também); sem âncora própria", async () => {
    const { projeto, paula, ana } = await semear();
    const r = await comentar(projeto.id, { texto: "raiz", trecho: "30 dias" }, paula);
    if (!r.ok) throw new Error();
    const r1 = await responderComentario(r.comentario.id, "resposta 1", ana);
    if (!r1.ok) throw new Error();
    expect(await responderComentario(r1.comentario.id, "resposta 2", paula)).toMatchObject({ ok: true });
    const l = (await listarComentarios(projeto.id))!;
    expect(l.threads).toHaveLength(1);
    expect(l.threads[0].respostas.map((x) => x.texto)).toEqual(["resposta 1", "resposta 2"]);
    expect(await responderComentario("nao-existe", "x", ana)).toEqual({ ok: false, erro: "COMENTARIO_NAO_ENCONTRADO" });
  });

  it("resolver e reabrir: estado na raiz e histórico na Timeline (com via MCP)", async () => {
    const { projeto, paula, ana, vera } = await semear();
    const r = await comentar(projeto.id, { texto: "raiz" }, paula);
    if (!r.ok) throw new Error();
    expect(await resolverComentario(r.comentario.id, ana)).toEqual({ ok: true });
    expect(await resolverComentario(r.comentario.id, ana)).toEqual({ ok: false, erro: "JA_RESOLVIDO" });
    let t = (await listarComentarios(projeto.id))!.threads[0];
    expect(t.resolvido).toMatchObject({ por: "Ana" });
    expect(await comViaMcp(() => reabrirComentario(r.comentario.id, vera))).toEqual({ ok: true });
    expect(await reabrirComentario(r.comentario.id, vera)).toEqual({ ok: false, erro: "NAO_RESOLVIDO" });
    t = (await listarComentarios(projeto.id))!.threads[0];
    expect(t.resolvido).toBeNull();
    const tl = await db.timeline.findMany({ where: { projetoId: projeto.id, tipo: "PROPOSTA" }, orderBy: { em: "asc" } });
    const eventos = tl.filter((x) => String((x.payload as { evento: string }).evento).startsWith("comentario_"));
    expect(eventos.map((x) => [(x.payload as { evento: string }).evento, x.usuarioId, x.viaMcp])).toEqual([
      ["comentario_resolvido", ana.id, false],
      ["comentario_reaberto", vera.id, true],
    ]);
  });

  it("resolver uma resposta resolve a thread dela", async () => {
    const { projeto, paula, ana } = await semear();
    const r = await comentar(projeto.id, { texto: "raiz" }, paula);
    if (!r.ok) throw new Error();
    const r1 = await responderComentario(r.comentario.id, "resp", ana);
    if (!r1.ok) throw new Error();
    expect(await resolverComentario(r1.comentario.id, ana)).toEqual({ ok: true });
    expect((await db.propostaComentario.findUniqueOrThrow({ where: { id: r.comentario.id } })).resolvidoEm).not.toBeNull();
  });
});

describe("trecho alterado e versões", () => {
  it("trecho editado/apagado: o comentário continua, marcado como trecho alterado; sobrevive a versões", async () => {
    const { projeto, paula, ana, revisao } = await semear();
    await comentar(projeto.id, { texto: "sobre o prazo", trecho: "30 dias" }, paula);
    const v = await salvarVersao(projeto.id, { revisao }, ana);
    if (!v.ok) throw new Error();
    const s = await salvarRascunho(projeto.id, { revisao: v.revisao, conteudo: { markdown: "## Escopo\n\nSite com loja e blog.\n\n## Prazo\n\n45 dias." } }, ana);
    if (!s.ok) throw new Error();
    const v2 = await salvarVersao(projeto.id, { revisao: s.revisao }, ana);
    expect(v2.ok).toBe(true);
    const [t] = (await listarComentarios(projeto.id))!.threads;
    expect(t).toMatchObject({ texto: "sobre o prazo", trechoAlterado: true, ancora: { trecho: "30 dias" } });
  });
});

describe("versão para o polling", () => {
  it("muda quando há comentário, resposta, resolver ou reabrir; igual quando nada muda", async () => {
    const { projeto, paula } = await semear();
    const v0 = await versaoDosComentarios(projeto.id);
    expect(await versaoDosComentarios(projeto.id)).toBe(v0);
    const r = await comentar(projeto.id, { texto: "oi" }, paula);
    if (!r.ok) throw new Error();
    const v1 = await versaoDosComentarios(projeto.id);
    expect(v1).not.toBe(v0);
    await new Promise((ok) => setTimeout(ok, 5));
    await resolverComentario(r.comentario.id, paula);
    const v2 = await versaoDosComentarios(projeto.id);
    expect(v2).not.toBe(v1);
    expect((await listarComentarios(projeto.id))!.versao).toBe(v2);
  });
});
