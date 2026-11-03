// @vitest-environment node
import { readFileSync } from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { dbTeste, limparBanco } from "@/test/db";
import { invalidarCachePipelines } from "@/lib/fases/cache";
import { criarCard, moverCard } from "./projetos";

const db = dbTeste();

/** Os comandos da migration 20261101200000 que marcam os cards existentes no deploy. */
const SQL_ISENCAO = readFileSync(path.join(process.cwd(), "prisma/migrations/20261101200000_envio_proposta/migration.sql"), "utf8")
  .replace(/--.*$/gm, "")
  .split(";")
  .map((c) => c.trim())
  .filter((c) => c.includes("isento_trava_contrato"));

async function semear() {
  const vendas = await db.pipeline.create({
    data: {
      chave: "vendas",
      nome: "Vendas",
      ordem: 0,
      fases: {
        create: [
          { chave: "negociacao", nome: "Negociação", ordem: 0 },
          { chave: "proposta", nome: "Proposta", ordem: 1, marco: "PROPOSTA" },
          { chave: "montando_contrato", nome: "Montando contrato", ordem: 2, marco: "MONTANDO_CONTRATO" },
          { chave: "contrato_assinado", nome: "Contrato assinado", ordem: 3, isTerminal: true, tipoTerminal: "GANHO", marco: "GANHO" },
          { chave: "perdido", nome: "Perdido", ordem: 4, isTerminal: true, tipoTerminal: "PERDIDO", marco: "PERDIDO" },
        ],
      },
    },
    include: { fases: { orderBy: { ordem: "asc" } } },
  });
  await db.pipeline.create({ data: { chave: "projetos", nome: "Projetos", ordem: 1, fases: { create: [{ chave: "handoff", nome: "Handoff", ordem: 0, marco: "HANDOFF" }] } } });
  const ana = await db.usuario.create({ data: { nome: "Ana", email: "ana@ij.test", papel: "VENDEDOR" } });
  const f = (chave: string) => vendas.fases.find((x) => x.chave === chave)!.id;
  return { vendas, ana, f };
}

beforeEach(async () => {
  await limparBanco(["proposta", "transicao_fase", "timeline", "oportunidade", "fase", "pipeline", "sessao", "usuario"]);
  invalidarCachePipelines();
});

describe("isenção da trava para os cards do deploy (GAB-89)", () => {
  it("a migration marca como isento todo card que já existe; card criado depois nasce travado", async () => {
    expect(SQL_ISENCAO).toHaveLength(2); // ADD COLUMN … DEFAULT false + UPDATE … = true
    const { vendas, ana, f } = await semear();
    const antigo = await criarCard({ pipelineId: vendas.id, faseId: f("negociacao"), titulo: "Antigo" }, ana);
    if (!antigo.ok) throw new Error("seed");
    // Simula o deploy: a coluna ainda não existia; a migration cria e marca.
    await db.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(`ALTER TABLE "oportunidade" DROP COLUMN "isento_trava_contrato"`);
      for (const c of SQL_ISENCAO) await tx.$executeRawUnsafe(c);
    });
    expect((await db.projeto.findUniqueOrThrow({ where: { id: antigo.id } })).isentoTravaContrato).toBe(true);
    const novo = await criarCard({ pipelineId: vendas.id, faseId: f("negociacao"), titulo: "Novo" }, ana);
    if (!novo.ok) throw new Error("seed");
    expect((await db.projeto.findUniqueOrThrow({ where: { id: novo.id } })).isentoTravaContrato).toBe(false);

    // isento vai a Montando contrato e a Ganho sem proposta; o novo continua travado
    expect(await moverCard(antigo.id, f("montando_contrato"), ana)).toMatchObject({ ok: true });
    expect(await moverCard(antigo.id, f("contrato_assinado"), ana, { dadosTerminal: {} })).toMatchObject({ ok: true, terminal: "GANHO" });
    expect(await moverCard(novo.id, f("montando_contrato"), ana)).toEqual({ ok: false, erro: "PROPOSTA_NAO_ACEITA" });
    expect(await moverCard(novo.id, f("contrato_assinado"), ana, { dadosTerminal: {} })).toEqual({ ok: false, erro: "PROPOSTA_NAO_ACEITA" });
  });

  it("isento direto de Negociação para Ganho (pula o marco) também passa", async () => {
    const { vendas, ana, f } = await semear();
    const c = await db.projeto.create({ data: { pipelineId: vendas.id, faseId: f("negociacao"), titulo: "Legado", responsavelId: ana.id, criadoVia: "UI", isentoTravaContrato: true } });
    expect(await moverCard(c.id, f("contrato_assinado"), ana, { dadosTerminal: {} })).toMatchObject({ ok: true });
  });
});
