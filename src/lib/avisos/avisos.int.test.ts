import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { dbTeste, limparBanco } from "@/test/db";

// O envio real nunca roda em teste: a Evolution é substituída aqui.
const evolution = vi.hoisted(() => ({ enviar: vi.fn() }));
vi.mock("@/lib/whatsapp/enviar", async (original) => ({
  ...(await original<typeof import("@/lib/whatsapp/enviar")>()),
  enviarWhatsApp: evolution.enviar,
}));

import { ErroEnvioWhatsApp, ErroPosEnvio } from "@/lib/whatsapp/enviar";
import { aguardarWhatsappPendente, contarNaoLidos, emitirAvisos, listarAvisos, marcarLidos } from "./avisos";

const db = dbTeste();

async function semear() {
  const pipeline = await db.pipeline.create({ data: { chave: "vendas", nome: "Vendas", ordem: 0, fases: { create: [{ chave: "p", nome: "Proposta", ordem: 0 }] } }, include: { fases: true } });
  const ana = await db.usuario.create({ data: { nome: "Ana", email: "ana@ij.test", telefoneWhatsapp: "+5511999998888" } });
  const bia = await db.usuario.create({ data: { nome: "Bia", email: "bia@ij.test" } });
  const ex = await db.usuario.create({ data: { nome: "Ex", email: "ex@ij.test", ativo: false, telefoneWhatsapp: "+5511988887777" } });
  const projeto = await db.projeto.create({ data: { pipelineId: pipeline.id, faseId: pipeline.fases[0].id, titulo: "Site", responsavelId: ana.id, criadoVia: "UI" } });
  return { ana, bia, ex, projeto };
}

beforeEach(async () => {
  await limparBanco(["aviso", "timeline", "oportunidade", "fase", "pipeline", "usuario"]);
  evolution.enviar.mockReset();
  delete process.env.NOTIFICATIONS_ENABLED;
  process.env.APP_URL = "https://crm.ij.test";
});
afterEach(() => {
  vi.restoreAllMocks();
  delete process.env.NOTIFICATIONS_ENABLED;
  delete process.env.APP_URL;
});

const avisoDe = (usuarioId: string) => db.aviso.findFirstOrThrow({ where: { usuarioId } });

describe("emitir aviso: sino sempre, WhatsApp só para os tipos certos", () => {
  it("cria no app para cada pessoa; inativo e inexistente ficam de fora; repetido vira um", async () => {
    const { ana, bia, ex, projeto } = await semear();
    vi.spyOn(console, "info").mockImplementation(() => undefined);
    const r = await emitirAvisos([
      { usuarioId: ana.id, tipo: "STATUS_PROPOSTA", titulo: "Mudou", projetoId: projeto.id },
      { usuarioId: ana.id, tipo: "STATUS_PROPOSTA", titulo: "Mudou", projetoId: projeto.id },
      { usuarioId: bia.id, tipo: "STATUS_PROPOSTA", titulo: "Mudou", projetoId: projeto.id },
      { usuarioId: ex.id, tipo: "SUA_VEZ", titulo: "Sua vez", projetoId: projeto.id },
      { usuarioId: "nao-existe", tipo: "SUA_VEZ", titulo: "Sua vez", projetoId: projeto.id },
    ]);
    expect(r).toMatchObject({ ok: true });
    const todos = await db.aviso.findMany({ orderBy: { usuarioId: "asc" } });
    expect(todos.map((a) => a.usuarioId).sort()).toEqual([ana.id, bia.id].sort());
    // Tipo só do app: nem tenta WhatsApp.
    expect(todos.every((a) => a.whatsapp === null && a.lidoEm === null)).toBe(true);
    expect(evolution.enviar).not.toHaveBeenCalled();
  });

  it("safe mode: não envia, registra o que seria enviado (com ref) e o aviso fica no app", async () => {
    const { ana, projeto } = await semear();
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
    await emitirAvisos([{ usuarioId: ana.id, tipo: "SUA_VEZ", titulo: "É sua vez na proposta de Site", projetoId: projeto.id }]);
    await aguardarWhatsappPendente();
    const a = await avisoDe(ana.id);
    expect(a).toMatchObject({ whatsapp: "SAFE_MODE", whatsappRef: expect.stringMatching(/^[0-9a-f]{8}$/) });
    expect(evolution.enviar).not.toHaveBeenCalled();
    const linha = info.mock.calls.map((c) => String(c[0])).find((l) => l.includes(`ref=${a.whatsappRef}`));
    expect(linha).toContain("SAFE MODE");
    expect(linha).toContain("É sua vez na proposta de Site");
    expect(linha).toContain(`https://crm.ij.test/projetos/${projeto.id}/proposta`);
    expect(linha).not.toContain("5511999998888"); // telefone mascarado
  });

  it("sem telefone: só no app, sem erro", async () => {
    const { bia, projeto } = await semear();
    process.env.NOTIFICATIONS_ENABLED = "true";
    const erro = vi.spyOn(console, "error").mockImplementation(() => undefined);
    expect(await emitirAvisos([{ usuarioId: bia.id, tipo: "SUA_VEZ", titulo: "Sua vez", projetoId: projeto.id }])).toMatchObject({ ok: true });
    await aguardarWhatsappPendente();
    expect(await avisoDe(bia.id)).toMatchObject({ whatsapp: "SEM_TELEFONE", whatsappRef: null });
    expect(evolution.enviar).not.toHaveBeenCalled();
    expect(erro).not.toHaveBeenCalled();
  });

  it("preferência desligada: só no app", async () => {
    const { ana, projeto } = await semear();
    process.env.NOTIFICATIONS_ENABLED = "true";
    await db.usuario.update({ where: { id: ana.id }, data: { preferencias: { v: 1, kanban: {}, avisos: { whatsapp: false } } } });
    await emitirAvisos([{ usuarioId: ana.id, tipo: "SUA_VEZ", titulo: "Sua vez", projetoId: projeto.id }]);
    await aguardarWhatsappPendente();
    expect(await avisoDe(ana.id)).toMatchObject({ whatsapp: "DESLIGADO" });
    expect(evolution.enviar).not.toHaveBeenCalled();
  });

  it("ligado: manda no privado da pessoa em segundo plano (quem agiu não espera a Evolution)", async () => {
    const { ana, projeto } = await semear();
    process.env.NOTIFICATIONS_ENABLED = "true";
    vi.spyOn(console, "info").mockImplementation(() => undefined);
    let soltar!: () => void;
    evolution.enviar.mockImplementation(() => new Promise((ok) => (soltar = () => ok({ eventoId: "EV1", enviada: true }))));
    expect(await emitirAvisos([{ usuarioId: ana.id, tipo: "SUA_VEZ", titulo: "Sua vez", projetoId: projeto.id }])).toMatchObject({ ok: true });
    expect(await avisoDe(ana.id)).toMatchObject({ whatsapp: "PENDENTE" });
    expect(evolution.enviar).toHaveBeenCalledWith({ para: "5511999998888@s.whatsapp.net", texto: `🖊️ CRM IJ: Sua vez\nhttps://crm.ij.test/projetos/${projeto.id}/proposta`, projetoId: projeto.id });
    soltar();
    await aguardarWhatsappPendente();
    expect(await avisoDe(ana.id)).toMatchObject({ whatsapp: "ENVIADO", whatsappRef: null });
  });

  it("falha na Evolution: não lança, fica FALHOU com a ref que está no log", async () => {
    const { ana, projeto } = await semear();
    process.env.NOTIFICATIONS_ENABLED = "true";
    const erro = vi.spyOn(console, "error").mockImplementation(() => undefined);
    evolution.enviar.mockRejectedValue(new ErroEnvioWhatsApp("Evolution sendText respondeu HTTP 500", 500));
    expect(await emitirAvisos([{ usuarioId: ana.id, tipo: "SUA_VEZ", titulo: "Sua vez", projetoId: projeto.id }])).toMatchObject({ ok: true });
    await aguardarWhatsappPendente();
    const a = await avisoDe(ana.id);
    expect(a).toMatchObject({ whatsapp: "FALHOU", whatsappRef: expect.stringMatching(/^[0-9a-f]{8}$/) });
    expect(erro.mock.calls.some((c) => String(c[0]).startsWith(`[avisos.whatsapp] ref=${a.whatsappRef} ErroEnvioWhatsApp: Evolution sendText respondeu HTTP 500`))).toBe(true);
  });

  it("entregue mas não registrado (ErroPosEnvio) conta como enviado", async () => {
    const { ana, projeto } = await semear();
    process.env.NOTIFICATIONS_ENABLED = "true";
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    evolution.enviar.mockRejectedValue(new ErroPosEnvio("EV9", new Error("db fora")));
    await emitirAvisos([{ usuarioId: ana.id, tipo: "SUA_VEZ", titulo: "Sua vez", projetoId: projeto.id }]);
    await aguardarWhatsappPendente();
    expect(await avisoDe(ana.id)).toMatchObject({ whatsapp: "ENVIADO" });
  });

  it("erro inesperado ao gravar: devolve a ref (que está no log) e não lança", async () => {
    const { ana } = await semear();
    const erro = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const r = await emitirAvisos([{ usuarioId: ana.id, tipo: "STATUS_PROPOSTA", titulo: "x", projetoId: "projeto-que-nao-existe" }]);
    expect(r).toEqual({ ok: false, ref: expect.stringMatching(/^[0-9a-f]{8}$/) });
    if (r.ok) throw new Error("inalcançável");
    expect(erro.mock.calls.some((c) => String(c[0]).startsWith(`[avisos.emitir] ref=${r.ref}`))).toBe(true);
  });
});

describe("sino: contar, listar e marcar como lido (sempre do próprio usuário)", () => {
  it("conta e lista só os da pessoa, mais recentes primeiro; marca um, depois todos", async () => {
    const { ana, bia, projeto } = await semear();
    await emitirAvisos([{ usuarioId: ana.id, tipo: "STATUS_PROPOSTA", titulo: "Primeiro", projetoId: projeto.id }]);
    await emitirAvisos([{ usuarioId: ana.id, tipo: "CANETA_PEGA", titulo: "Segundo", projetoId: projeto.id }]);
    await emitirAvisos([{ usuarioId: bia.id, tipo: "STATUS_PROPOSTA", titulo: "Da Bia", projetoId: projeto.id }]);
    expect(await contarNaoLidos(ana.id)).toBe(2);
    const lista = await listarAvisos(ana.id);
    expect(lista.map((a) => a.titulo)).toEqual(["Segundo", "Primeiro"]);
    expect(lista[0]).toMatchObject({ tipo: "CANETA_PEGA", href: `/projetos/${projeto.id}/proposta`, lido: false, whatsappFalhouRef: null });

    // Id de aviso de outra pessoa não tem efeito.
    const daBia = await avisoDe(bia.id);
    expect(await marcarLidos(ana.id, [daBia.id])).toBe(0);
    expect(await contarNaoLidos(bia.id)).toBe(1);

    expect(await marcarLidos(ana.id, [lista[0].id])).toBe(1);
    expect(await contarNaoLidos(ana.id)).toBe(1);
    expect(await listarAvisos(ana.id, { soNaoLidos: true })).toMatchObject([{ titulo: "Primeiro" }]);
    expect(await marcarLidos(ana.id)).toBe(1);
    expect(await contarNaoLidos(ana.id)).toBe(0);
    // Ler de novo não muda a data de leitura.
    const lidoEm = (await db.aviso.findFirstOrThrow({ where: { id: lista[0].id } })).lidoEm;
    await marcarLidos(ana.id);
    expect((await db.aviso.findFirstOrThrow({ where: { id: lista[0].id } })).lidoEm).toEqual(lidoEm);
    expect(await listarAvisos(ana.id)).toHaveLength(2);
  });

  it("limite da lista", async () => {
    const { ana, projeto } = await semear();
    for (let i = 0; i < 5; i++) await emitirAvisos([{ usuarioId: ana.id, tipo: "STATUS_PROPOSTA", titulo: `A${i}`, projetoId: projeto.id }]);
    expect(await listarAvisos(ana.id, { limite: 3 })).toHaveLength(3);
  });

  it("falha do WhatsApp aparece no item com a ref", async () => {
    const { ana, projeto } = await semear();
    process.env.NOTIFICATIONS_ENABLED = "true";
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    evolution.enviar.mockRejectedValue(new Error("rede"));
    await emitirAvisos([{ usuarioId: ana.id, tipo: "SUA_VEZ", titulo: "Sua vez", projetoId: projeto.id }]);
    await aguardarWhatsappPendente();
    const [a] = await listarAvisos(ana.id);
    expect(a.whatsappFalhouRef).toMatch(/^[0-9a-f]{8}$/);
  });
});
