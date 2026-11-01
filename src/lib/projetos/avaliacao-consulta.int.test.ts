import { beforeEach, describe, expect, it } from "vitest";
import { dbTeste, limparBanco } from "@/test/db";
import { avaliacoesPorVendedor } from "./avaliacao-consulta";

const db = dbTeste();

beforeEach(async () => {
  await limparBanco(["timeline", "mensagem_bruta", "oportunidade", "fase", "pipeline", "usuario"]);
});

async function semear() {
  const vendas = await db.pipeline.create({
    data: { chave: "vendas", nome: "Vendas", ordem: 0, fases: { create: [{ chave: "primeiro_contato", nome: "Primeiro Contato", ordem: 0 }] } },
    include: { fases: true },
  });
  const ana = await db.usuario.create({ data: { nome: "Ana", email: "ana@ij.test" } });
  const bruno = await db.usuario.create({ data: { nome: "Bruno", email: "bruno@ij.test" } });
  const gestora = await db.usuario.create({ data: { nome: "Gê", email: "ge@ij.test", papel: "GESTOR" } });
  const card = await db.projeto.create({ data: { titulo: "Acme", pipelineId: vendas.id, faseId: vendas.fases[0].id, responsavelId: ana.id, criadoVia: "UI" } });
  return { ana, bruno, gestora, card };
}

const em = (iso: string) => new Date(iso);

describe("avaliacoesPorVendedor (GAB-85, base do painel GAB-94)", () => {
  it("agrega nota média e sentimentos por vendedor no período [de, ate)", async () => {
    const { ana, bruno, gestora, card } = await semear();
    const msg = (autor: string, id: string) =>
      db.mensagemBruta.create({ data: { id, eventoId: `ev-${id}`, grupoJid: "g@g.us", texto: "#crm x", recebidaEm: em("2026-10-10T12:00:00Z"), remetenteUsuarioId: autor, status: "PROCESSADA" } });
    await msg(ana.id, "m1");
    await msg(bruno.id, "m2");
    await msg(bruno.id, "m3");
    await db.timeline.createMany({
      data: [
        { projetoId: card.id, tipo: "NOTA", usuarioId: ana.id, nota: 5, em: em("2026-10-10T12:00:00Z") },
        { projetoId: card.id, tipo: "NOTA", usuarioId: ana.id, nota: 4, em: em("2026-10-11T12:00:00Z") },
        { projetoId: card.id, tipo: "NOTA", usuarioId: ana.id, nota: null, em: em("2026-10-11T13:00:00Z") },
        { projetoId: card.id, tipo: "MENSAGEM_WHATSAPP", usuarioId: ana.id, mensagemBrutaId: "m1", sentimento: "POSITIVO", em: em("2026-10-12T12:00:00Z") },
        { projetoId: card.id, tipo: "MENSAGEM_WHATSAPP", usuarioId: bruno.id, mensagemBrutaId: "m2", sentimento: "NEGATIVO", em: em("2026-10-12T12:00:00Z") },
        // Resolvida manualmente pela gestora: conta para quem MANDOU a mensagem (Bruno).
        { projetoId: card.id, tipo: "MENSAGEM_WHATSAPP", usuarioId: gestora.id, mensagemBrutaId: "m3", sentimento: "NEUTRO", em: em("2026-10-13T12:00:00Z") },
        // Fora do período.
        { projetoId: card.id, tipo: "NOTA", usuarioId: bruno.id, nota: 1, em: em("2026-11-01T00:00:00Z") },
      ],
    });

    const r = await avaliacoesPorVendedor({ de: em("2026-10-01T00:00:00Z"), ate: em("2026-11-01T00:00:00Z") });
    expect(r).toHaveLength(2);
    expect(r).toEqual(
      expect.arrayContaining([
        { vendedorId: ana.id, notas: 2, notaMedia: 4.5, positivos: 1, neutros: 0, negativos: 0 },
        { vendedorId: bruno.id, notas: 0, notaMedia: null, positivos: 0, neutros: 1, negativos: 1 },
      ]),
    );
  });

  it("sobrevive à purga de 90 dias: sem payload.saida nem resultado_llm, o sentimento continua contando", async () => {
    const { ana, card } = await semear();
    await db.mensagemBruta.create({
      data: { id: "m1", eventoId: "ev-m1", grupoJid: "g@g.us", texto: "#crm x", recebidaEm: em("2026-01-10T12:00:00Z"), remetenteUsuarioId: ana.id, status: "PROCESSADA", sentimento: "POSITIVO" },
    });
    await db.timeline.create({
      data: { projetoId: card.id, tipo: "MENSAGEM_WHATSAPP", usuarioId: ana.id, mensagemBrutaId: "m1", sentimento: "POSITIVO", payload: { texto: "#crm x" }, em: em("2026-01-10T12:00:00Z") },
    });
    const r = await avaliacoesPorVendedor({ de: em("2026-01-01T00:00:00Z"), ate: em("2026-02-01T00:00:00Z") });
    expect(r).toEqual([{ vendedorId: ana.id, notas: 0, notaMedia: null, positivos: 1, neutros: 0, negativos: 0 }]);
  });
});

describe("avaliacoesPorVendedor: lixeira e fuso (review do PR #52)", () => {
  it("card na lixeira fica de fora", async () => {
    const { ana, card } = await semear();
    await db.timeline.create({ data: { projetoId: card.id, tipo: "NOTA", usuarioId: ana.id, nota: 2, em: em("2026-10-10T12:00:00Z") } });
    const periodo = { de: em("2026-10-01T00:00:00Z"), ate: em("2026-11-01T00:00:00Z") };
    expect(await avaliacoesPorVendedor(periodo)).toHaveLength(1);
    await db.projeto.update({ where: { id: card.id }, data: { deletadoEm: new Date() } });
    expect(await avaliacoesPorVendedor(periodo)).toEqual([]);
  });

  it("com a sessão em America/Sao_Paulo (SET LOCAL TIME ZONE) os limites continuam em UTC", async () => {
    const { ana, card } = await semear();
    // 23:30 de 31/10 em SP = 02:30Z de 01/11: fora de [01/10Z, 01/11Z).
    await db.timeline.createMany({
      data: [
        { projetoId: card.id, tipo: "NOTA", usuarioId: ana.id, nota: 5, em: em("2026-10-31T23:30:00Z") },
        { projetoId: card.id, tipo: "NOTA", usuarioId: ana.id, nota: 1, em: em("2026-11-01T02:30:00Z") },
      ],
    });
    const periodo = { de: em("2026-10-01T00:00:00Z"), ate: em("2026-11-01T00:00:00Z") };
    const r = await db.$transaction(async (tx) => {
      await tx.$executeRawUnsafe("SET LOCAL TIME ZONE 'America/Sao_Paulo'");
      return avaliacoesPorVendedor(periodo, tx);
    });
    expect(r).toEqual([{ vendedorId: ana.id, notas: 1, notaMedia: 5, positivos: 0, neutros: 0, negativos: 0 }]);
  });
});
