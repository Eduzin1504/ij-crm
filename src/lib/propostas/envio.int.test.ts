// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Area, Cargo, Papel } from "@prisma/client";
import { extractText, getDocumentProxy } from "unpdf";
import { dbTeste, limparBanco } from "@/test/db";
import { invalidarCachePipelines } from "@/lib/fases/cache";
import { criarCard, moverCard } from "@/lib/projetos/projetos";
import { aoMudarCaneta, type EventoCaneta } from "./avisos";
import {
  concluirRevisao,
  concordarProposta,
  criarProposta,
  devolverProposta,
  marcarEnviada,
  marcarInviavel,
  pdfDaProposta,
  registrarResposta,
  salvarRascunho,
  versaoFinalDaProposta,
} from "./propostas";

const db = dbTeste();

async function semear() {
  const vendas = await db.pipeline.create({
    data: {
      chave: "vendas",
      nome: "Vendas",
      ordem: 0,
      fases: {
        create: [
          { chave: "reuniao", nome: "Reunião", ordem: 0 },
          { chave: "proposta", nome: "Proposta", ordem: 1, marco: "PROPOSTA" },
          { chave: "montando_contrato", nome: "Montando contrato", ordem: 2, marco: "MONTANDO_CONTRATO" },
          { chave: "juridico", nome: "Jurídico", ordem: 3 },
          { chave: "contrato_assinado", nome: "Contrato assinado", ordem: 4, isTerminal: true, tipoTerminal: "GANHO", marco: "GANHO" },
          { chave: "perdido", nome: "Perdido", ordem: 5, isTerminal: true, tipoTerminal: "PERDIDO", marco: "PERDIDO" },
        ],
      },
    },
    include: { fases: { orderBy: { ordem: "asc" } } },
  });
  await db.pipeline.create({
    data: { chave: "projetos", nome: "Projetos", ordem: 1, fases: { create: [{ chave: "handoff", nome: "Handoff", ordem: 0, marco: "HANDOFF" }] } },
  });
  const [reuniao, faseProposta, mc, juridico, ganho, perdido] = vendas.fases;
  const pessoa = (nome: string, papel: Papel, area: Area | null = null, cargos: Cargo[] = []) =>
    db.usuario.create({ data: { nome, email: `${nome.toLowerCase()}@ij.test`, papel, area, cargos } });
  const ana = await pessoa("Ana", "VENDEDOR", "VENDAS");
  const bia = await pessoa("Bia", "VENDEDOR", "VENDAS");
  const gv = await pessoa("Gabi", "VENDEDOR", "VENDAS", ["GP"]);
  const paula = await pessoa("Paula", "PROJETOS", "PROJETOS");
  const gil = await pessoa("Gil", "GESTOR");
  const empresa = await db.empresa.create({ data: { nome: "Padaria São João" } });
  const projeto = await db.projeto.create({
    data: { pipelineId: vendas.id, faseId: faseProposta.id, titulo: "Site da Padaria", responsavelId: ana.id, empresaId: empresa.id, criadoVia: "UI" },
  });
  return { vendas, fases: { reuniao, faseProposta, mc, juridico, ganho, perdido }, ana, bia, gv, paula, gil, projeto };
}

type Semente = Awaited<ReturnType<typeof semear>>;

const ESTRUTURADO = { valor: "12.500,00", prazoDias: "60", escopoResumo: "Site institucional", entregas: [{ titulo: "Protótipo", dia: "2026-12-01", valor: "5.000,00" }] };

/** Vendas (Ana) devolve a v1 para Paula; Paula concorda → pronta para envio, caneta com Ana. */
async function pronta(s: Semente) {
  await criarProposta(s.projeto.id, s.ana);
  await devolverProposta(s.projeto.id, { revisao: 0, conteudo: { markdown: "## Escopo\n\nSite com **5 páginas**, coração e ação." }, estruturado: ESTRUTURADO, paraId: s.paula.id }, s.ana);
  const p = await db.proposta.findUniqueOrThrow({ where: { projetoId: s.projeto.id } });
  expect(await concordarProposta(s.projeto.id, p.revisao, s.paula)).toMatchObject({ ok: true, status: "PRONTA_PARA_ENVIO", canetaComId: s.ana.id });
}

async function enviada(s: Semente) {
  await pronta(s);
  expect(await marcarEnviada(s.projeto.id, s.ana)).toMatchObject({ ok: true, status: "ENVIADA", numero: 1 });
}

const proposta = (projetoId: string) => db.proposta.findUniqueOrThrow({ where: { projetoId } });
const eventos = async (projetoId: string) =>
  (await db.timeline.findMany({ where: { projetoId, tipo: "PROPOSTA" }, orderBy: { em: "asc" } })).map((t) => (t.payload as { evento: string }).evento);

async function textoDoPdf(bytes: Uint8Array) {
  const r = await extractText(await getDocumentProxy(new Uint8Array(bytes)), { mergePages: true });
  return (r.text as string).replace(/\s+/g, " ");
}

beforeEach(async () => {
  await limparBanco(["proposta_caneta", "proposta_versao", "proposta", "transicao_fase", "timeline", "oportunidade", "empresa", "fase", "pipeline", "sessao", "usuario"]);
  invalidarCachePipelines();
});
afterEach(() => vi.restoreAllMocks());

describe("PDF da proposta", () => {
  it("só da versão final (pronta ou enviada), com o texto e a parte estruturada, acentos inclusive", async () => {
    const s = await semear();
    await criarProposta(s.projeto.id, s.ana);
    expect(await pdfDaProposta(s.projeto.id)).toEqual({ ok: false, erro: "PDF_INDISPONIVEL" });
    await pronta(s);
    expect(await versaoFinalDaProposta(s.projeto.id)).toEqual({ ok: true, numero: 1, nomeArquivo: "Proposta - Site da Padaria - v1.pdf" });
    expect(await versaoFinalDaProposta(s.projeto.id, 2)).toEqual({ ok: false, erro: "VERSAO_FINAL_MUDOU" });
    const r = await pdfDaProposta(s.projeto.id, 1);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const t = await textoDoPdf(r.bytes);
    for (const trecho of ["Proposta comercial", "Padaria São João · Site da Padaria", "Versão 1", "Escopo", "5 páginas", "coração e ação", "R$ 12.500,00", "60 dias corridos", "Site institucional", "Cronograma de entregas", "Protótipo", "01/12/2026", "R$ 5.000,00"]) {
      expect(t).toContain(trecho);
    }
  });

  it("projeto ou proposta inexistente", async () => {
    const s = await semear();
    expect(await pdfDaProposta("nao-existe")).toEqual({ ok: false, erro: "PROJETO_NAO_ENCONTRADO" });
    expect(await pdfDaProposta(s.projeto.id)).toEqual({ ok: false, erro: "PROPOSTA_NAO_ENCONTRADA" });
  });
});

describe("marcar como enviada", () => {
  it("só pronta, só vendas (dono da caneta ou GP de vendas); grava a versão enviada e trava a edição", async () => {
    const s = await semear();
    await criarProposta(s.projeto.id, s.ana);
    expect(await marcarEnviada(s.projeto.id, s.ana)).toEqual({ ok: false, erro: "ENVIAR_SO_PRONTA" });
    await pronta(s);
    expect(await marcarEnviada(s.projeto.id, s.paula)).toEqual({ ok: false, erro: "ENVIO_SO_VENDAS" });
    expect(await marcarEnviada(s.projeto.id, s.bia)).toEqual({ ok: false, erro: "ENVIO_SO_VENDAS" });
    expect(await marcarEnviada(s.projeto.id, s.gil)).toEqual({ ok: false, erro: "ENVIO_SO_VENDAS" });
    expect(await marcarEnviada(s.projeto.id, s.ana, { versao: 7 })).toEqual({ ok: false, erro: "VERSAO_FINAL_MUDOU" });

    const antes = await proposta(s.projeto.id);
    expect(await marcarEnviada(s.projeto.id, s.ana, { versao: 1 })).toMatchObject({ ok: true, status: "ENVIADA", canetaComId: s.ana.id, numero: 1 });
    const p = await proposta(s.projeto.id);
    expect(p).toMatchObject({ status: "ENVIADA", versaoEnviada: 1, canetaComId: s.ana.id });
    expect(p.enviadaEm).toBeInstanceOf(Date);
    expect(p.revisao).toBe(antes.revisao + 1);
    expect((await eventos(s.projeto.id)).at(-1)).toBe("enviada");

    // Com o cliente: ninguém edita, devolve, concorda nem marca inviável.
    expect(await salvarRascunho(s.projeto.id, { revisao: p.revisao, conteudo: { markdown: "mexi" } }, s.ana)).toEqual({ ok: false, erro: "PROPOSTA_COM_O_CLIENTE" });
    expect(await devolverProposta(s.projeto.id, { revisao: p.revisao, paraId: s.paula.id }, s.ana)).toEqual({ ok: false, erro: "PROPOSTA_COM_O_CLIENTE" });
    expect(await marcarInviavel(s.projeto.id, "x", s.paula)).toEqual({ ok: false, erro: "PROPOSTA_COM_O_CLIENTE" });
    expect(await marcarEnviada(s.projeto.id, s.ana)).toEqual({ ok: false, erro: "ENVIAR_SO_PRONTA" });
    // O PDF continua sendo o da versão enviada.
    expect(await versaoFinalDaProposta(s.projeto.id)).toMatchObject({ ok: true, numero: 1 });
  });

  it("GP de vendas envia sem estar com a caneta", async () => {
    const s = await semear();
    await pronta(s);
    expect(await marcarEnviada(s.projeto.id, s.gv)).toMatchObject({ ok: true, status: "ENVIADA" });
  });
});

describe("resposta do cliente", () => {
  it("ACEITA: Projeto vai para Montando contrato pelo caminho do Kanban; caneta fecha; aviso 'aceita'", async () => {
    const s = await semear();
    await enviada(s);
    const avisos: EventoCaneta[] = [];
    const parar = aoMudarCaneta((e) => {
      avisos.push(e);
    });
    try {
      expect(await registrarResposta(s.projeto.id, { resposta: "ACEITA" }, s.paula)).toEqual({ ok: false, erro: "ENVIO_SO_VENDAS" });
      expect(await registrarResposta(s.projeto.id, { resposta: "ACEITA" }, s.ana)).toMatchObject({ ok: true, status: "ACEITA", canetaComId: null, numero: 1 });
    } finally {
      parar();
    }
    expect(await proposta(s.projeto.id)).toMatchObject({ status: "ACEITA", canetaComId: null });
    expect((await proposta(s.projeto.id)).respondidaEm).toBeInstanceOf(Date);
    const p = await db.projeto.findUniqueOrThrow({ where: { id: s.projeto.id } });
    expect(p.faseId).toBe(s.fases.mc.id);
    expect(await db.transicaoFase.findMany({ where: { projetoId: s.projeto.id }, select: { deFaseId: true, paraFaseId: true, origem: true } })).toEqual([
      { deFaseId: s.fases.faseProposta.id, paraFaseId: s.fases.mc.id, origem: "UI" },
    ]);
    const tl = await db.timeline.findMany({ where: { projetoId: s.projeto.id }, orderBy: { em: "asc" } });
    expect(tl.slice(-2).map((t) => [t.tipo, (t.payload as { evento?: string }).evento ?? null])).toEqual([
      ["PROPOSTA", "aceita"],
      ["MOVIMENTACAO", null],
    ]);
    expect(await db.propostaCaneta.count({ where: { fim: null } })).toBe(0);
    expect(avisos).toEqual([expect.objectContaining({ acao: "aceita", status: "ACEITA", porId: s.ana.id, numero: 1 })]);
    // Respondida: nada mais.
    expect(await registrarResposta(s.projeto.id, { resposta: "RECUSADA", motivo: "preco" }, s.ana)).toEqual({ ok: false, erro: "RESPONDER_SO_ENVIADA" });
  });

  it("ACEITA com o card já em Montando contrato ou além (migrado): fica onde está", async () => {
    const s = await semear();
    await enviada(s);
    await db.projeto.update({ where: { id: s.projeto.id }, data: { faseId: s.fases.juridico.id } });
    expect(await registrarResposta(s.projeto.id, { resposta: "ACEITA" }, s.ana)).toMatchObject({ ok: true, status: "ACEITA" });
    expect((await db.projeto.findUniqueOrThrow({ where: { id: s.projeto.id } })).faseId).toBe(s.fases.juridico.id);
    expect(await db.transicaoFase.count()).toBe(0);
  });

  it("ACEITA/RECUSADA com o card em perdido: reabra antes (nada muda)", async () => {
    const s = await semear();
    await enviada(s);
    await db.projeto.update({ where: { id: s.projeto.id }, data: { faseId: s.fases.perdido.id } });
    expect(await registrarResposta(s.projeto.id, { resposta: "ACEITA" }, s.ana)).toEqual({ ok: false, erro: "PROJETO_ENCERRADO" });
    expect((await proposta(s.projeto.id)).status).toBe("ENVIADA");
  });

  it("RECUSADA: motivo obrigatório (lista do Kanban) → Projeto em Perdido com o motivo", async () => {
    const s = await semear();
    await enviada(s);
    expect(await registrarResposta(s.projeto.id, { resposta: "RECUSADA" }, s.ana)).toMatchObject({ ok: false, erro: "REGRA_PROJETO", mensagem: "Escolha o motivo da perda." });
    expect(await registrarResposta(s.projeto.id, { resposta: "RECUSADA", motivo: "outro" }, s.ana)).toMatchObject({ ok: false, erro: "REGRA_PROJETO" });
    expect(await registrarResposta(s.projeto.id, { resposta: "RECUSADA", motivo: "preco", detalhe: " achou  caro " }, s.ana)).toMatchObject({ ok: true, status: "RECUSADA" });
    expect(await proposta(s.projeto.id)).toMatchObject({ status: "RECUSADA", motivoRecusa: "Preço: achou caro", canetaComId: null });
    const p = await db.projeto.findUniqueOrThrow({ where: { id: s.projeto.id } });
    expect(p).toMatchObject({ faseId: s.fases.perdido.id, motivoPerda: "Preço: achou caro" });
    expect((await eventos(s.projeto.id)).at(-1)).toBe("recusada");
  });

  it("resposta inválida e pedido de revisão longo", async () => {
    const s = await semear();
    await enviada(s);
    expect(await registrarResposta(s.projeto.id, { resposta: "TALVEZ" as never }, s.ana)).toEqual({ ok: false, erro: "RESPOSTA_INVALIDA" });
    expect(await registrarResposta(s.projeto.id, { resposta: "REVISAO_PEDIDA", pedido: "x".repeat(1001) }, s.ana)).toEqual({ ok: false, erro: "PEDIDO_REVISAO_LONGO" });
  });
});

describe("revisão pedida", () => {
  it("caneta volta para vendas; sem mudar escopo/prazo/valor, vendas conclui direto e reenvia (v2)", async () => {
    const s = await semear();
    await enviada(s);
    // O GP de vendas registra: a caneta fica com quem registrou.
    expect(await registrarResposta(s.projeto.id, { resposta: "REVISAO_PEDIDA", pedido: "trocar o tom do texto" }, s.gv)).toMatchObject({
      ok: true,
      status: "REVISAO_PEDIDA",
      canetaComId: s.gv.id,
    });
    const tl = await db.timeline.findMany({ where: { projetoId: s.projeto.id, tipo: "PROPOSTA" }, orderBy: { em: "asc" } });
    expect(tl.at(-1)!.payload).toMatchObject({ evento: "revisao_pedida", numero: 1, pedido: "trocar o tom do texto" });
    // Edita só o texto (a parte estruturada continua a enviada).
    const p = await proposta(s.projeto.id);
    expect(await concluirRevisao(s.projeto.id, { revisao: p.revisao, conteudo: { markdown: "## Escopo\n\nTexto novo." } }, s.ana)).toEqual({ ok: false, erro: "SEM_CANETA" });
    expect(await concluirRevisao(s.projeto.id, { revisao: p.revisao, conteudo: { markdown: "## Escopo\n\nTexto novo." }, nota: "tom" }, s.gv)).toMatchObject({
      ok: true,
      status: "PRONTA_PARA_ENVIO",
      numero: 2,
    });
    expect(await versaoFinalDaProposta(s.projeto.id)).toMatchObject({ ok: true, numero: 2 });
    expect(await marcarEnviada(s.projeto.id, s.gv, { versao: 2 })).toMatchObject({ ok: true, numero: 2 });
    expect((await proposta(s.projeto.id)).versaoEnviada).toBe(2);
    expect(await eventos(s.projeto.id)).toEqual(expect.arrayContaining(["revisao_pedida", "versao_salva", "revisao_concluida", "enviada"]));
  });

  it("mudou valor/prazo/escopo desde a enviada: concluir direto é recusado e Devolver leva a projetos", async () => {
    const s = await semear();
    await enviada(s);
    await registrarResposta(s.projeto.id, { resposta: "REVISAO_PEDIDA" }, s.ana);
    let p = await proposta(s.projeto.id);
    expect(await salvarRascunho(s.projeto.id, { revisao: p.revisao, estruturado: { ...ESTRUTURADO, valor: "11.000,00" } }, s.ana)).toMatchObject({ ok: true });
    p = await proposta(s.projeto.id);
    expect(await concluirRevisao(s.projeto.id, { revisao: p.revisao }, s.ana)).toEqual({ ok: false, erro: "REVISAO_MUDOU_ESTRUTURADO" });
    expect((await proposta(s.projeto.id)).status).toBe("REVISAO_PEDIDA");
    // Voltar ao valor enviado libera de novo; mas aqui segue o caminho de projetos.
    expect(await devolverProposta(s.projeto.id, { revisao: p.revisao, paraId: s.paula.id }, s.ana)).toMatchObject({ ok: true, status: "EM_ANALISE", canetaComId: s.paula.id });
    p = await proposta(s.projeto.id);
    expect(await concordarProposta(s.projeto.id, p.revisao, s.paula)).toMatchObject({ ok: true, status: "PRONTA_PARA_ENVIO" });
    expect(await versaoFinalDaProposta(s.projeto.id)).toMatchObject({ ok: true, numero: 2 });
  });

  it("entrega mudada também conta como parte estruturada", async () => {
    const s = await semear();
    await enviada(s);
    await registrarResposta(s.projeto.id, { resposta: "REVISAO_PEDIDA" }, s.ana);
    const p = await proposta(s.projeto.id);
    const est = { ...ESTRUTURADO, entregas: [{ titulo: "Protótipo", dia: "2026-12-15", valor: "5.000,00" }] };
    expect(await concluirRevisao(s.projeto.id, { revisao: p.revisao, estruturado: est }, s.ana)).toEqual({ ok: false, erro: "REVISAO_MUDOU_ESTRUTURADO" });
    // nada gravado (a transação desfez o rascunho junto)
    expect((await proposta(s.projeto.id)).revisao).toBe(p.revisao);
  });
});

describe("trava de Montando contrato (arraste/MCP = moverCard)", () => {
  it("sem proposta aceita não entra em Montando contrato nem além — nem gestor", async () => {
    const s = await semear();
    for (const fase of [s.fases.mc, s.fases.juridico]) {
      expect(await moverCard(s.projeto.id, fase.id, s.gil)).toEqual({ ok: false, erro: "PROPOSTA_NAO_ACEITA" });
      expect(await moverCard(s.projeto.id, fase.id, s.ana)).toEqual({ ok: false, erro: "PROPOSTA_NAO_ACEITA" });
    }
    expect(await moverCard(s.projeto.id, s.fases.ganho.id, s.gil, { dadosTerminal: {} })).toEqual({ ok: false, erro: "PROPOSTA_NAO_ACEITA" });
    // proposta enviada (ainda sem aceite) também trava
    await enviada(s);
    expect(await moverCard(s.projeto.id, s.fases.mc.id, s.gil)).toEqual({ ok: false, erro: "PROPOSTA_NAO_ACEITA" });
    // perdido e fases antes do marco: livres
    expect(await moverCard(s.projeto.id, s.fases.reuniao.id, s.ana)).toMatchObject({ ok: true, mudou: true });
    expect(await moverCard(s.projeto.id, s.fases.perdido.id, s.ana, { dadosTerminal: { motivo: "timing" } })).toMatchObject({ ok: true });
    expect((await db.projeto.findUniqueOrThrow({ where: { id: s.projeto.id } })).faseId).toBe(s.fases.perdido.id);
  });

  it("com a proposta aceita, anda livre (Montando contrato → Jurídico → Ganho; volta e vai de novo)", async () => {
    const s = await semear();
    await enviada(s);
    await registrarResposta(s.projeto.id, { resposta: "ACEITA" }, s.ana);
    expect(await moverCard(s.projeto.id, s.fases.faseProposta.id, s.ana)).toMatchObject({ ok: true });
    expect(await moverCard(s.projeto.id, s.fases.juridico.id, s.ana)).toMatchObject({ ok: true });
    expect(await moverCard(s.projeto.id, s.fases.ganho.id, s.ana, { dadosTerminal: {} })).toMatchObject({ ok: true, terminal: "GANHO" });
  });

  it("card migrado já além de Proposta não é afetado; saindo de Perdido conta onde foi perdido", async () => {
    const s = await semear();
    // migrado em Montando contrato, sem proposta: anda dentro da região
    await db.projeto.update({ where: { id: s.projeto.id }, data: { faseId: s.fases.mc.id } });
    expect(await moverCard(s.projeto.id, s.fases.juridico.id, s.ana)).toMatchObject({ ok: true });
    // perdido a partir do Jurídico → reabre direto em Montando contrato
    expect(await moverCard(s.projeto.id, s.fases.perdido.id, s.ana, { dadosTerminal: { motivo: "timing" } })).toMatchObject({ ok: true });
    expect(await moverCard(s.projeto.id, s.fases.mc.id, s.ana)).toMatchObject({ ok: true });
    // voltou para antes do marco: agora precisa da proposta
    expect(await moverCard(s.projeto.id, s.fases.faseProposta.id, s.ana)).toMatchObject({ ok: true });
    expect(await moverCard(s.projeto.id, s.fases.mc.id, s.ana)).toEqual({ ok: false, erro: "PROPOSTA_NAO_ACEITA" });
    // perdido a partir de Proposta → não reabre em Montando contrato
    expect(await moverCard(s.projeto.id, s.fases.perdido.id, s.ana, { dadosTerminal: { motivo: "timing" } })).toMatchObject({ ok: true });
    expect(await moverCard(s.projeto.id, s.fases.mc.id, s.ana)).toEqual({ ok: false, erro: "PROPOSTA_NAO_ACEITA" });
  });

  it("card novo não nasce em Montando contrato nem depois", async () => {
    const s = await semear();
    expect(await criarCard({ pipelineId: s.vendas.id, faseId: s.fases.mc.id, titulo: "Novo" }, s.gil)).toEqual({ ok: false, erro: "PROPOSTA_NAO_ACEITA" });
    expect(await criarCard({ pipelineId: s.vendas.id, faseId: s.fases.juridico.id, titulo: "Novo" }, s.ana)).toEqual({ ok: false, erro: "PROPOSTA_NAO_ACEITA" });
    expect(await criarCard({ pipelineId: s.vendas.id, faseId: s.fases.faseProposta.id, titulo: "Novo" }, s.ana)).toMatchObject({ ok: true });
  });
});
