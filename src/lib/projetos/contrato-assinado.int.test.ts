// @vitest-environment node
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Papel } from "@prisma/client";
import { invalidarCachePipelines } from "@/lib/fases/cache";
import { dbTeste, limparBanco } from "@/test/db";
import { PNG, pdfDeTexto } from "@/test/fixtures/anexos";
import { marcarContratoAssinado } from "./contrato-assinado";
import { criarCard, moverCard } from "./projetos";

const db = dbTeste();

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
          { chave: "juridico", nome: "Jurídico", ordem: 3 },
          { chave: "contrato_assinado", nome: "Contrato assinado", ordem: 4, isTerminal: true, tipoTerminal: "GANHO", marco: "GANHO" },
          { chave: "perdido", nome: "Perdido", ordem: 5, isTerminal: true, tipoTerminal: "PERDIDO", marco: "PERDIDO" },
        ],
      },
    },
    include: { fases: true },
  });
  await db.pipeline.create({ data: { chave: "projetos", nome: "Projetos", ordem: 1, fases: { create: [{ chave: "handoff", nome: "Handoff", ordem: 0, marco: "HANDOFF" }] } } });
  const pessoa = (nome: string, papel: Papel) => db.usuario.create({ data: { nome, email: `${nome.toLowerCase()}@ij.test`, papel } });
  const ana = await pessoa("Ana", "VENDEDOR");
  const gil = await pessoa("Gil", "GESTOR");
  const vera = await pessoa("Vera", "VISUALIZADOR");
  const f = (chave: string) => vendas.fases.find((x) => x.chave === chave)!.id;
  const r = await criarCard({ pipelineId: vendas.id, faseId: f("negociacao"), titulo: "Site" }, ana);
  if (!r.ok) throw new Error(r.erro);
  return { vendas, ana, gil, vera, f, id: r.id };
}
type S = Awaited<ReturnType<typeof semear>>;

const aceita = (s: S) => db.proposta.create({ data: { projetoId: s.id, status: "ACEITA", criadoPorId: s.ana.id } });
const emMontandoContrato = async (s: S) => {
  await aceita(s);
  expect(await moverCard(s.id, s.f("montando_contrato"), s.ana)).toMatchObject({ ok: true });
};
const lerCard = (id: string) => db.projeto.findUniqueOrThrow({ where: { id }, include: { fase: true } });
const PDF = () => ({ nome: "contrato.pdf", bytes: pdfDeTexto(["Contrato assinado pelas partes"]) });

let dir: string;
beforeEach(async () => {
  await limparBanco(["anexo", "proposta", "transicao_fase", "timeline", "oportunidade", "fase", "pipeline", "usuario"]);
  invalidarCachePipelines();
  dir = await mkdtemp(path.join(tmpdir(), "contrato-assinado-"));
  process.env.ANEXOS_DIR = dir;
});
afterEach(async () => {
  delete process.env.ANEXOS_DIR;
  await rm(dir, { recursive: true, force: true });
});

describe("marcarContratoAssinado", () => {
  it("sem anexo: vai a Ganho com data e valor e segue ao Handoff", async () => {
    const s = await semear();
    await emMontandoContrato(s);
    expect(await marcarContratoAssinado(s.id, { valorFechado: "12.500,00" }, s.ana)).toEqual({ ok: true, mudou: true, anexo: null });
    const c = await lerCard(s.id);
    expect(c.fase.marco).toBe("HANDOFF");
    expect(c.valorFechado?.toFixed(2)).toBe("12500.00");
    expect(c.dataGanho).not.toBeNull();
    expect(c.vendedorId).toBe(s.ana.id);
    expect(await db.anexo.count()).toBe(0);
    const passos = await db.transicaoFase.findMany({ where: { projetoId: s.id }, orderBy: [{ em: "asc" }, { id: "asc" }] });
    expect(passos.map((t) => t.paraFaseId)).toContain(s.f("contrato_assinado"));
  });

  it("com anexo: o PDF fica no Projeto (texto extraído, Timeline) e o card vai a Ganho", async () => {
    const s = await semear();
    await emMontandoContrato(s);
    const r = await marcarContratoAssinado(s.id, { valorFechado: "", arquivo: PDF() }, s.ana);
    expect(r).toMatchObject({ ok: true, mudou: true, anexo: { nome: "contrato.pdf", semTexto: false } });
    expect(await db.anexo.findFirstOrThrow({ where: { projetoId: s.id } })).toMatchObject({ tipo: "PDF", autorId: s.ana.id, texto: "Contrato assinado pelas partes" });
    expect(await db.timeline.count({ where: { projetoId: s.id, tipo: "ANEXO" } })).toBe(1);
    const c = await lerCard(s.id);
    expect(c.fase.marco).toBe("HANDOFF");
    expect(c.dataGanho).not.toBeNull();
    expect(c.valorFechado).toBeNull();
  });

  it("de uma subfase depois do marco também vale", async () => {
    const s = await semear();
    await emMontandoContrato(s);
    await moverCard(s.id, s.f("juridico"), s.ana);
    expect(await marcarContratoAssinado(s.id, {}, s.ana)).toMatchObject({ ok: true, mudou: true });
  });

  it("PDF já anexado antes não é erro: marca sem duplicar", async () => {
    const s = await semear();
    await emMontandoContrato(s);
    const { anexarArquivo } = await import("@/lib/anexos/anexos");
    expect(await anexarArquivo(s.id, PDF(), s.ana)).toMatchObject({ ok: true });
    expect(await marcarContratoAssinado(s.id, { arquivo: PDF() }, s.ana)).toEqual({ ok: true, mudou: true, anexo: null });
    expect(await db.anexo.count()).toBe(1);
  });

  it("anexo ruim não move nada: não é PDF, corrompido, vazio", async () => {
    const s = await semear();
    await emMontandoContrato(s);
    expect(await marcarContratoAssinado(s.id, { arquivo: { nome: "foto.png", bytes: PNG } }, s.ana)).toEqual({ ok: false, erro: "CONTRATO_NAO_E_PDF" });
    expect(await marcarContratoAssinado(s.id, { arquivo: { nome: "c.pdf", bytes: new TextEncoder().encode("%PDF-1.4 lixo") } }, s.ana)).toEqual({ ok: false, erro: "CORROMPIDO" });
    expect(await marcarContratoAssinado(s.id, { arquivo: { nome: "c.pdf", bytes: new Uint8Array() } }, s.ana)).toEqual({ ok: false, erro: "VAZIO" });
    expect((await lerCard(s.id)).fase.chave).toBe("montando_contrato");
    expect(await db.anexo.count()).toBe(0);
  });

  it("sem valor informado mantém o guardado; valor inválido recusa antes de tudo", async () => {
    const s = await semear();
    await emMontandoContrato(s);
    await db.projeto.update({ where: { id: s.id }, data: { valorFechado: "7000.00" } });
    expect(await marcarContratoAssinado(s.id, { valorFechado: "dez mil", arquivo: PDF() }, s.ana)).toEqual({ ok: false, erro: "VALOR_FECHADO_INVALIDO" });
    expect(await db.anexo.count()).toBe(0);
    expect(await marcarContratoAssinado(s.id, {}, s.ana)).toMatchObject({ ok: true });
    expect((await lerCard(s.id)).valorFechado?.toFixed(2)).toBe("7000.00");
  });

  it("fora da regra recusa sem anexar: antes do marco, nem gestor; VISUALIZADOR; já em Projetos; card excluído", async () => {
    const s = await semear();
    await aceita(s);
    for (const quem of [s.ana, s.gil]) {
      expect(await marcarContratoAssinado(s.id, { arquivo: PDF() }, quem)).toEqual({ ok: false, erro: "GANHO_SO_DE_MONTANDO_CONTRATO" });
    }
    expect(await db.anexo.count()).toBe(0);
    expect(await marcarContratoAssinado(s.id, {}, s.vera)).toEqual({ ok: false, erro: "SEM_PERMISSAO" });

    await moverCard(s.id, s.f("montando_contrato"), s.ana);
    expect(await marcarContratoAssinado(s.id, {}, s.ana)).toMatchObject({ ok: true });
    expect(await marcarContratoAssinado(s.id, {}, s.ana)).toEqual({ ok: false, erro: "PROJETO_FORA_DE_VENDAS" });
    await db.projeto.update({ where: { id: s.id }, data: { deletadoEm: new Date() } });
    expect(await marcarContratoAssinado(s.id, {}, s.ana)).toEqual({ ok: false, erro: "CARD_NAO_ENCONTRADO" });
  });

  it("sem proposta aceita: diz o que falta primeiro", async () => {
    const s = await semear();
    expect(await marcarContratoAssinado(s.id, {}, s.gil)).toEqual({ ok: false, erro: "PROPOSTA_NAO_ACEITA" });
  });

  it("isento marca de qualquer fase, com ou sem anexo", async () => {
    const s = await semear();
    await db.projeto.update({ where: { id: s.id }, data: { isentoTravaContrato: true } });
    expect(await marcarContratoAssinado(s.id, { valorFechado: "1.000,00", arquivo: PDF() }, s.ana)).toMatchObject({ ok: true, mudou: true });
    expect((await lerCard(s.id)).fase.marco).toBe("HANDOFF");
  });
});

describe("trava de Ganho no arraste (moverCard, GAB-99)", () => {
  it("proposta aceita não basta: de antes do marco é recusado, nem gestor, e nada muda", async () => {
    const s = await semear();
    await aceita(s);
    for (const quem of [s.ana, s.gil]) {
      expect(await moverCard(s.id, s.f("contrato_assinado"), quem, { dadosTerminal: { valorFechado: "1,00" } })).toEqual({ ok: false, erro: "GANHO_SO_DE_MONTANDO_CONTRATO" });
    }
    const c = await lerCard(s.id);
    expect(c).toMatchObject({ faseId: s.f("negociacao"), dataGanho: null, valorFechado: null });
  });

  it("de Montando contrato e da subfase depois dele, passa", async () => {
    const s = await semear();
    await aceita(s);
    await moverCard(s.id, s.f("juridico"), s.ana);
    expect(await moverCard(s.id, s.f("contrato_assinado"), s.ana, { dadosTerminal: {} })).toMatchObject({ ok: true, terminal: "GANHO" });
  });

  it("de Perdido direto para Ganho não vale, mesmo perdido em Montando contrato: reabre e marca", async () => {
    const s = await semear();
    await emMontandoContrato(s);
    await moverCard(s.id, s.f("perdido"), s.ana, { dadosTerminal: { motivo: "timing" } });
    expect(await moverCard(s.id, s.f("contrato_assinado"), s.gil, { dadosTerminal: {} })).toEqual({ ok: false, erro: "GANHO_SO_DE_MONTANDO_CONTRATO" });
    expect(await moverCard(s.id, s.f("montando_contrato"), s.ana)).toMatchObject({ ok: true });
    expect(await moverCard(s.id, s.f("contrato_assinado"), s.ana, { dadosTerminal: {} })).toMatchObject({ ok: true });
  });

  it("fase de ganho extra, mesmo posta antes do marco, também trava", async () => {
    const s = await semear();
    await aceita(s);
    const extra = await db.fase.create({ data: { pipelineId: s.vendas.id, chave: "ganho_extra", nome: "Ganho extra", ordem: 0, isTerminal: true, tipoTerminal: "GANHO" } });
    invalidarCachePipelines();
    expect(await moverCard(s.id, extra.id, s.ana, { dadosTerminal: {} })).toEqual({ ok: false, erro: "GANHO_SO_DE_MONTANDO_CONTRATO" });
  });

  it("isento segue isento: de Perdido e de antes do marco", async () => {
    const s = await semear();
    await db.projeto.update({ where: { id: s.id }, data: { isentoTravaContrato: true } });
    await moverCard(s.id, s.f("perdido"), s.ana, { dadosTerminal: { motivo: "timing" } });
    expect(await moverCard(s.id, s.f("contrato_assinado"), s.ana, { dadosTerminal: {} })).toMatchObject({ ok: true, terminal: "GANHO" });
  });
});
