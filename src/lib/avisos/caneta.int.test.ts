import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Area, Cargo, Papel } from "@prisma/client";
import { dbTeste, limparBanco } from "@/test/db";
import { invalidarCachePipelines } from "@/lib/fases/cache";

const evolution = vi.hoisted(() => ({ enviar: vi.fn() }));
vi.mock("@/lib/whatsapp/enviar", async (original) => ({
  ...(await original<typeof import("@/lib/whatsapp/enviar")>()),
  enviarWhatsApp: evolution.enviar,
}));

import { concordarProposta, criarProposta, devolverProposta, marcarInviavel, passarCaneta, pegarCaneta, reabrirProposta } from "@/lib/propostas/propostas";
import { aguardarWhatsappPendente } from "./avisos";

const db = dbTeste();

async function semear() {
  const vendas = await db.pipeline.create({
    data: {
      chave: "vendas",
      nome: "Vendas",
      ordem: 0,
      fases: {
        create: [
          { chave: "proposta", nome: "Proposta", ordem: 0, marco: "PROPOSTA" },
          { chave: "perdido", nome: "Perdido", ordem: 1, isTerminal: true, tipoTerminal: "PERDIDO", marco: "PERDIDO" },
        ],
      },
    },
    include: { fases: { orderBy: { ordem: "asc" } } },
  });
  const pessoa = (nome: string, papel: Papel, area: Area | null = null, cargos: Cargo[] = [], telefoneWhatsapp: string | null = null) =>
    db.usuario.create({ data: { nome, email: `${nome.toLowerCase()}@ij.test`, papel, area, cargos, telefoneWhatsapp } });
  const ana = await pessoa("Ana", "VENDEDOR", "VENDAS", [], "+5511999990001");
  const paula = await pessoa("Paula", "PROJETOS", "PROJETOS", [], "+5511999990002");
  const pedro = await pessoa("Pedro", "PROJETOS", "PROJETOS"); // sem telefone
  const gp = await pessoa("Guto", "PROJETOS", "PROJETOS", ["GP"]);
  const projeto = await db.projeto.create({
    data: { pipelineId: vendas.id, faseId: vendas.fases[0].id, titulo: "Site da Padaria", responsavelId: ana.id, criadoVia: "UI" },
  });
  return { ana, paula, pedro, gp, projeto };
}

const revisaoAtual = async (projetoId: string) => (await db.proposta.findUniqueOrThrow({ where: { projetoId } })).revisao;

const avisos = async () =>
  (await db.aviso.findMany({ orderBy: [{ criadoEm: "asc" }, { id: "asc" }], include: { usuario: { select: { nome: true } } } })).map((a) => ({
    para: a.usuario.nome,
    tipo: a.tipo,
    titulo: a.titulo,
    whatsapp: a.whatsapp,
  }));

beforeEach(async () => {
  await limparBanco(["aviso", "proposta_caneta", "proposta_versao", "proposta", "transicao_fase", "timeline", "oportunidade", "fase", "pipeline", "sessao", "usuario"]);
  invalidarCachePipelines();
  evolution.enviar.mockReset();
  evolution.enviar.mockResolvedValue({ eventoId: "EV", enviada: true });
  process.env.NOTIFICATIONS_ENABLED = "true";
});
afterEach(() => {
  vi.restoreAllMocks();
  delete process.env.NOTIFICATIONS_ENABLED;
});

describe("caneta → avisos (o serviço da proposta não muda: ouvinte de propostas/avisos.ts)", () => {
  it("devolver e passar avisam quem recebe, no app e no WhatsApp privado", async () => {
    const { ana, paula, pedro, projeto } = await semear();
    vi.spyOn(console, "info").mockImplementation(() => undefined);
    await criarProposta(projeto.id, ana);
    expect(await avisos()).toEqual([]); // criar não é "sua vez" de ninguém além de quem já está nela

    expect((await devolverProposta(projeto.id, { revisao: 0, conteudo: { markdown: "v1" }, paraId: paula.id }, ana)).ok).toBe(true);
    expect((await passarCaneta(projeto.id, pedro.id, paula)).ok).toBe(true);
    await aguardarWhatsappPendente();
    expect(await avisos()).toEqual([
      { para: "Paula", tipo: "SUA_VEZ", titulo: 'Ana devolveu para você a proposta de "Site da Padaria" (v1)', whatsapp: "ENVIADO" },
      // Pedro não tem telefone: só no app, sem erro.
      { para: "Pedro", tipo: "SUA_VEZ", titulo: 'Paula passou para você a caneta da proposta de "Site da Padaria"', whatsapp: "SEM_TELEFONE" },
    ]);
    expect(evolution.enviar).toHaveBeenCalledTimes(1);
    expect(evolution.enviar.mock.calls[0][0]).toMatchObject({ para: "5511999990002@s.whatsapp.net", projetoId: projeto.id });
  });

  it("GP pega a caneta: avisa só no app quem estava com ela", async () => {
    const { ana, paula, gp, projeto } = await semear();
    await criarProposta(projeto.id, ana);
    await devolverProposta(projeto.id, { revisao: 0, conteudo: { markdown: "v1" }, paraId: paula.id }, ana);
    await db.aviso.deleteMany();
    expect((await pegarCaneta(projeto.id, gp)).ok).toBe(true);
    expect(await avisos()).toEqual([
      { para: "Paula", tipo: "CANETA_PEGA", titulo: 'Guto (GP) pegou a caneta da proposta de "Site da Padaria", que estava com você', whatsapp: null },
    ]);
  });

  it("concordar: vez de vendas (WhatsApp) e mudança de status no app para quem já atuou nela", async () => {
    const { ana, paula, pedro, gp, projeto } = await semear();
    await criarProposta(projeto.id, ana);
    const d = await devolverProposta(projeto.id, { revisao: 0, conteudo: { markdown: "v1" }, paraId: paula.id }, ana);
    await passarCaneta(projeto.id, pedro.id, paula);
    await db.aviso.deleteMany();
    if (!d.ok) throw new Error("seed");
    expect((await concordarProposta(projeto.id, await revisaoAtual(projeto.id), pedro)).ok).toBe(true);
    await aguardarWhatsappPendente();
    const todos = await avisos();
    expect(todos).toContainEqual({ para: "Ana", tipo: "SUA_VEZ", titulo: 'Pedro concordou com a proposta de "Site da Padaria": pronta para envio, com você', whatsapp: "ENVIADO" });
    expect(todos).toContainEqual({ para: "Paula", tipo: "STATUS_PROPOSTA", titulo: 'Proposta de "Site da Padaria" agora está Pronta para envio (Pedro)', whatsapp: null });
    // Quem agiu não se avisa; quem nunca atuou (Guto) também não.
    expect(todos.map((a) => a.para).sort()).toEqual(["Ana", "Paula"]);
    expect(gp).toBeTruthy();
  });

  it("reabrir e inviável: status no app para quem atuou (menos quem agiu)", async () => {
    const { ana, paula, gp, projeto } = await semear();
    await criarProposta(projeto.id, ana);
    const d = await devolverProposta(projeto.id, { revisao: 0, conteudo: { markdown: "v1" }, paraId: paula.id }, ana);
    if (!d.ok) throw new Error("seed");
    expect((await concordarProposta(projeto.id, await revisaoAtual(projeto.id), paula)).ok).toBe(true);
    await db.aviso.deleteMany();
    expect((await reabrirProposta(projeto.id, ana)).ok).toBe(true);
    expect(await avisos()).toEqual([{ para: "Paula", tipo: "STATUS_PROPOSTA", titulo: 'Proposta de "Site da Padaria" agora está Em ajuste (Ana)', whatsapp: null }]);

    await db.aviso.deleteMany();
    expect((await devolverProposta(projeto.id, { revisao: await revisaoAtual(projeto.id), conteudo: { markdown: "v2" }, paraId: paula.id }, ana)).ok).toBe(true);
    await db.aviso.deleteMany();
    expect((await marcarInviavel(projeto.id, "fora do escopo", gp)).ok).toBe(true);
    expect((await avisos()).sort((a, b) => a.para.localeCompare(b.para))).toEqual([
      { para: "Ana", tipo: "STATUS_PROPOSTA", titulo: 'Proposta de "Site da Padaria" agora está Inviável (Guto)', whatsapp: null },
      { para: "Paula", tipo: "STATUS_PROPOSTA", titulo: 'Proposta de "Site da Padaria" agora está Inviável (Guto)', whatsapp: null },
    ]);
  });

  it("WhatsApp fora: a passagem vale do mesmo jeito; falha fica registrada com ref", async () => {
    const { ana, paula, projeto } = await semear();
    const erro = vi.spyOn(console, "error").mockImplementation(() => undefined);
    evolution.enviar.mockRejectedValue(new Error("rede"));
    await criarProposta(projeto.id, ana);
    expect(await devolverProposta(projeto.id, { revisao: 0, conteudo: { markdown: "v1" }, paraId: paula.id }, ana)).toMatchObject({ ok: true, canetaComId: paula.id });
    await aguardarWhatsappPendente();
    const a = await db.aviso.findFirstOrThrow({ where: { usuarioId: paula.id } });
    expect(a).toMatchObject({ tipo: "SUA_VEZ", whatsapp: "FALHOU" });
    expect(erro.mock.calls.some((c) => String(c[0]).startsWith(`[avisos.whatsapp] ref=${a.whatsappRef} `))).toBe(true);
    expect((await db.proposta.findUniqueOrThrow({ where: { projetoId: projeto.id } })).canetaComId).toBe(paula.id);
  });
});
