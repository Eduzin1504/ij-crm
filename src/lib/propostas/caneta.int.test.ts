import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Area, Cargo, Papel } from "@prisma/client";
import { dbTeste, limparBanco } from "@/test/db";
import { invalidarCachePipelines } from "@/lib/fases/cache";
import { atualizarUsuario } from "@/lib/auth/usuarios";
import { moverCard } from "@/lib/projetos/projetos";
import { aoMudarCaneta, type EventoCaneta } from "./avisos";
import {
  concordarProposta,
  criarProposta,
  devolverProposta,
  diffDaProposta,
  marcarInviavel,
  obterPropostaDoProjeto,
  passarCaneta,
  pegarCaneta,
  reabrirProposta,
  salvarRascunho,
  salvarVersao,
  tempoComCaneta,
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
          { chave: "proposta", nome: "Proposta", ordem: 0, marco: "PROPOSTA" },
          { chave: "perdido", nome: "Perdido", ordem: 1, isTerminal: true, tipoTerminal: "PERDIDO", marco: "PERDIDO" },
        ],
      },
    },
    include: { fases: { orderBy: { ordem: "asc" } } },
  });
  const pessoa = (nome: string, papel: Papel, area: Area | null = null, cargos: Cargo[] = []) =>
    db.usuario.create({ data: { nome, email: `${nome.toLowerCase()}@ij.test`, papel, area, cargos } });
  const ana = await pessoa("Ana", "VENDEDOR", "VENDAS");
  const bia = await pessoa("Bia", "VENDEDOR", "VENDAS");
  const gv = await pessoa("Gabi", "VENDEDOR", "VENDAS", ["GP"]);
  const paula = await pessoa("Paula", "PROJETOS", "PROJETOS");
  const pedro = await pessoa("Pedro", "PROJETOS", "PROJETOS");
  const gp = await pessoa("Guto", "PROJETOS", "PROJETOS", ["GP"]);
  const gil = await pessoa("Gil", "GESTOR");
  const vera = await pessoa("Vera", "VISUALIZADOR");
  const projeto = await db.projeto.create({
    data: { pipelineId: vendas.id, faseId: vendas.fases[0].id, titulo: "Site da Padaria", responsavelId: ana.id, criadoVia: "UI" },
  });
  return { vendas, ana, bia, gv, paula, pedro, gp, gil, vera, projeto };
}

const proposta = (projetoId: string) => db.proposta.findUniqueOrThrow({ where: { projetoId } });
/** Revisão atual (toda ação de caneta a incrementa). */
const rev = async (projetoId: string) => (await proposta(projetoId)).revisao;
const eventos = async (projetoId: string) =>
  (await db.timeline.findMany({ where: { projetoId, tipo: "PROPOSTA" }, orderBy: { em: "asc" } })).map((t) => (t.payload as { evento: string }).evento);

beforeEach(async () => {
  await limparBanco(["proposta_caneta", "proposta_versao", "proposta", "transicao_fase", "timeline", "oportunidade", "fase", "pipeline", "sessao", "usuario"]);
  invalidarCachePipelines();
});
afterEach(() => vi.restoreAllMocks());

describe("caneta ao criar: o pingue-pongue começa em vendas", () => {
  it("vai para o responsável (de vendas), com um período aberto", async () => {
    const { ana, gil, projeto } = await semear();
    expect(await criarProposta(projeto.id, gil)).toMatchObject({ ok: true, canetaComId: ana.id });
    expect(await proposta(projeto.id)).toMatchObject({ canetaComId: ana.id, canetaLado: "VENDAS", status: "RASCUNHO" });
    expect(await db.propostaCaneta.findMany()).toMatchObject([{ usuarioId: ana.id, lado: "VENDAS", fim: null }]);
  });

  it("responsável que não é de vendas: ninguém com a caneta (o GP de vendas pega)", async () => {
    const { gil, gv, paula, vendas } = await semear();
    const p = await db.projeto.create({ data: { pipelineId: vendas.id, faseId: vendas.fases[0].id, titulo: "X", responsavelId: paula.id, criadoVia: "UI" } });
    expect(await criarProposta(p.id, gil)).toMatchObject({ ok: true, canetaComId: null });
    expect(await salvarRascunho(p.id, { revisao: 0, conteudo: { markdown: "x" } }, gil)).toEqual({ ok: false, erro: "SEM_CANETA" });
    expect(await pegarCaneta(p.id, gv)).toMatchObject({ ok: true, canetaComId: gv.id });
    expect((await salvarRascunho(p.id, { revisao: 0, conteudo: { markdown: "x" } }, gv))).toMatchObject({ ok: false, erro: "CONFLITO" }); // pegar mudou a revisão
    expect((await salvarRascunho(p.id, { revisao: await rev(p.id), conteudo: { markdown: "x" } }, gv)).ok).toBe(true);
  });
});

describe("pingue-pongue: devolver ⇄ devolver → concordar = pronta para envio", () => {
  it("ciclo completo com status, versões por lado, Timeline e períodos", async () => {
    const { ana, paula, projeto } = await semear();
    await criarProposta(projeto.id, ana);

    // vendas devolve (salva v1 com o que está no editor) para Paula
    const d1 = await devolverProposta(projeto.id, { revisao: 0, conteudo: { markdown: "Site com 5 páginas." }, paraId: paula.id, nota: "primeira" }, ana);
    expect(d1).toMatchObject({ ok: true, status: "EM_ANALISE", canetaComId: paula.id, canetaComNome: "Paula", numero: 1, revisao: 2 }); // v1 (rascunho) + caneta
    expect(await proposta(projeto.id)).toMatchObject({ status: "EM_ANALISE", canetaComId: paula.id, canetaLado: "PROJETOS" });
    // Ana não edita mais; Paula edita
    expect(await salvarRascunho(projeto.id, { revisao: 2, conteudo: { markdown: "de Ana" } }, ana)).toEqual({ ok: false, erro: "SEM_CANETA" });
    expect((await salvarRascunho(projeto.id, { revisao: 2, conteudo: { markdown: "Site com 8 páginas." } }, paula)).ok).toBe(true);

    // projetos devolve (v2, lado projetos) para Ana → em ajuste
    const d2 = await devolverProposta(projeto.id, { revisao: 3, paraId: ana.id }, paula);
    expect(d2).toMatchObject({ ok: true, status: "EM_AJUSTE", canetaComId: ana.id, numero: 2 });
    const versoes = await db.propostaVersao.findMany({ orderBy: { numero: "asc" } });
    expect(versoes.map((v) => [v.numero, v.autorLado, v.conteudoMd])).toEqual([
      [1, "VENDAS", "Site com 5 páginas."],
      [2, "PROJETOS", "Site com 8 páginas."],
    ]);

    // Ana vê o diff do que entregou (v1) para o que voltou (v2)
    const diff = await diffDaProposta(projeto.id, { quem: ana.id });
    expect(diff).toMatchObject({ de: { numero: 1, lado: "VENDAS" }, para: { numero: 2, lado: "PROJETOS" } });
    expect(diff!.texto[0]).toMatchObject({ tipo: "alterada" });

    // concorda sem editar → pronta para envio, caneta fica com vendas
    expect(await concordarProposta(projeto.id, 4, ana)).toMatchObject({ ok: true, status: "PRONTA_PARA_ENVIO", canetaComId: ana.id, numero: 2, revisao: 5 });
    expect(await proposta(projeto.id)).toMatchObject({ status: "PRONTA_PARA_ENVIO", canetaComId: ana.id, canetaLado: "VENDAS" });
    // pronta: ninguém edita sem reabrir
    expect(await salvarRascunho(projeto.id, { revisao: 5, conteudo: { markdown: "mexi" } }, ana)).toEqual({ ok: false, erro: "PROPOSTA_PRONTA" });

    expect(await eventos(projeto.id)).toEqual(["criada", "versao_salva", "devolvida", "versao_salva", "devolvida", "concordou"]);
    const periodos = await db.propostaCaneta.findMany({ orderBy: { inicio: "asc" } });
    expect(periodos.map((p) => [p.usuarioId, p.lado, p.fim === null])).toEqual([
      [ana.id, "VENDAS", false],
      [paula.id, "PROJETOS", false],
      [ana.id, "VENDAS", false],
      [ana.id, "VENDAS", true],
    ]);
    const tempo = await tempoComCaneta(projeto.id);
    expect(tempo.map((t) => t.nome).sort()).toEqual(["Ana", "Paula"]);
  });

  it("projetos concorda com a versão de vendas: pronta, e a caneta volta para quem a salvou (vendas envia)", async () => {
    const { ana, paula, projeto } = await semear();
    await criarProposta(projeto.id, ana);
    await devolverProposta(projeto.id, { revisao: 0, conteudo: { markdown: "ok assim" }, paraId: paula.id }, ana);
    expect(await concordarProposta(projeto.id, await rev(projeto.id), paula)).toMatchObject({ ok: true, status: "PRONTA_PARA_ENVIO", canetaComId: ana.id });
    expect(await proposta(projeto.id)).toMatchObject({ canetaLado: "VENDAS", canetaComId: ana.id });
  });

  it("…e se quem salvou saiu: pronta sem ninguém com a caneta (o GP de vendas pega)", async () => {
    const { ana, paula, gv, projeto } = await semear();
    await criarProposta(projeto.id, ana);
    await devolverProposta(projeto.id, { revisao: 0, conteudo: { markdown: "ok" }, paraId: paula.id }, ana);
    await db.usuario.update({ where: { id: ana.id }, data: { ativo: false } });
    expect(await concordarProposta(projeto.id, await rev(projeto.id), paula)).toMatchObject({ ok: true, canetaComId: null });
    expect(await pegarCaneta(projeto.id, gv)).toMatchObject({ ok: true, canetaComId: gv.id, status: "PRONTA_PARA_ENVIO" });
  });
});

describe("recusas da máquina de estados (nada é gravado)", () => {
  it("concordar: sem versão, versão do próprio lado, rascunho alterado, revisão velha", async () => {
    const { ana, paula, projeto } = await semear();
    await criarProposta(projeto.id, ana);
    expect(await concordarProposta(projeto.id, 0, ana)).toEqual({ ok: false, erro: "CONCORDAR_SEM_VERSAO" });
    await salvarVersao(projeto.id, { revisao: 0, conteudo: { markdown: "v1" } }, ana);
    expect(await concordarProposta(projeto.id, 1, ana)).toEqual({ ok: false, erro: "CONCORDAR_PROPRIA_VERSAO" });
    await devolverProposta(projeto.id, { revisao: 1, paraId: paula.id }, ana);
    // Paula mexeu no rascunho: concordar é sem editar
    await salvarRascunho(projeto.id, { revisao: 2, conteudo: { markdown: "v1 mexida" } }, paula);
    expect(await concordarProposta(projeto.id, 3, paula)).toEqual({ ok: false, erro: "CONCORDAR_RASCUNHO_ALTERADO" });
    expect(await concordarProposta(projeto.id, 2, paula)).toMatchObject({ ok: false, erro: "CONFLITO" });
    expect((await proposta(projeto.id)).status).toBe("EM_ANALISE");
  });

  it("devolver sem mudança: se a última versão é do meu lado só passa; se veio do outro, é Concordar", async () => {
    const { ana, paula, projeto } = await semear();
    await criarProposta(projeto.id, ana);
    await salvarVersao(projeto.id, { revisao: 0, conteudo: { markdown: "v1" } }, ana);
    expect(await devolverProposta(projeto.id, { revisao: 1, paraId: paula.id }, ana)).toMatchObject({ ok: true, numero: 1 });
    expect(await db.propostaVersao.count()).toBe(1);
    expect(await devolverProposta(projeto.id, { revisao: 2, paraId: ana.id }, paula)).toEqual({ ok: false, erro: "DEVOLVER_SEM_MUDANCAS" });
  });

  it("devolver: destino tem de ser do outro lado, ativo e que edita; o rascunho mandado não fica gravado", async () => {
    const { ana, bia, gil, vera, paula, projeto } = await semear();
    await criarProposta(projeto.id, ana);
    await db.usuario.update({ where: { id: paula.id }, data: { ativo: false } });
    for (const paraId of [bia.id, gil.id, vera.id, paula.id, "nao-existe"]) {
      expect(await devolverProposta(projeto.id, { revisao: 0, conteudo: { markdown: "não grava" }, paraId }, ana), paraId).toEqual({ ok: false, erro: "DESTINO_OUTRO_LADO" });
    }
    expect(await proposta(projeto.id)).toMatchObject({ revisao: 0, canetaComId: ana.id });
    expect(await db.propostaVersao.count()).toBe(0);
  });

  it("só o dono passa/devolve/concorda — nem gestor, nem GP sem pegar, nem o Claude de outra pessoa", async () => {
    const { ana, bia, gv, gil, vera, paula, projeto } = await semear();
    await criarProposta(projeto.id, ana);
    for (const quem of [bia, gv, gil, vera, paula]) {
      expect(await passarCaneta(projeto.id, bia.id, quem)).toMatchObject({ ok: false });
      expect(await devolverProposta(projeto.id, { revisao: 0, paraId: paula.id }, quem)).toEqual({ ok: false, erro: "SEM_CANETA" });
      expect(await concordarProposta(projeto.id, 0, quem)).toEqual({ ok: false, erro: "SEM_CANETA" });
    }
    expect((await proposta(projeto.id)).canetaComId).toBe(ana.id);
  });

  it("duas passagens ao mesmo tempo: só uma vale (a outra já não está com a caneta)", async () => {
    const { ana, bia, paula, projeto } = await semear();
    await criarProposta(projeto.id, ana);
    const [a, b] = await Promise.all([passarCaneta(projeto.id, bia.id, ana), devolverProposta(projeto.id, { revisao: 0, conteudo: { markdown: "x" }, paraId: paula.id }, ana)]);
    expect([a.ok, b.ok].filter(Boolean)).toHaveLength(1);
    expect(await db.propostaCaneta.count({ where: { fim: null } })).toBe(1);
  });
});

describe("passar e pegar", () => {
  it("passar para alguém do mesmo lado; para o outro lado não (é Devolver)", async () => {
    const { ana, bia, paula, projeto } = await semear();
    await criarProposta(projeto.id, ana);
    expect(await passarCaneta(projeto.id, paula.id, ana)).toEqual({ ok: false, erro: "DESTINO_MESMO_LADO" });
    expect(await passarCaneta(projeto.id, ana.id, ana)).toEqual({ ok: false, erro: "DESTINO_MESMO_LADO" });
    expect(await passarCaneta(projeto.id, bia.id, ana)).toMatchObject({ ok: true, status: "RASCUNHO", canetaComId: bia.id });
    expect(await salvarRascunho(projeto.id, { revisao: 1, conteudo: { markdown: "x" } }, ana)).toEqual({ ok: false, erro: "SEM_CANETA" });
    expect((await salvarRascunho(projeto.id, { revisao: 1, conteudo: { markdown: "x" } }, bia)).ok).toBe(true);
    expect(await eventos(projeto.id)).toEqual(["criada", "caneta_passada"]);
  });

  it("GP do lado da caneta pega; GP do outro lado, membro comum e gestor não", async () => {
    const { ana, bia, gv, gp, gil, projeto } = await semear();
    await criarProposta(projeto.id, ana);
    for (const quem of [bia, gp, gil]) expect(await pegarCaneta(projeto.id, quem)).toEqual({ ok: false, erro: "SO_GP_PEGA" });
    expect(await pegarCaneta(projeto.id, gv)).toMatchObject({ ok: true, canetaComId: gv.id });
    expect(await pegarCaneta(projeto.id, gv)).toEqual({ ok: false, erro: "JA_COM_A_CANETA" });
    const tl = await db.timeline.findFirstOrThrow({ where: { projetoId: projeto.id, payload: { path: ["evento"], equals: "caneta_pega" } } });
    expect(tl.payload).toMatchObject({ deId: ana.id, deNome: "Ana", lado: "VENDAS" });
  });

  it("quem mudou de lado na Gestão perde a caneta na hora", async () => {
    const { ana, projeto } = await semear();
    await criarProposta(projeto.id, ana);
    await db.usuario.update({ where: { id: ana.id }, data: { papel: "PROJETOS", area: "PROJETOS" } });
    expect(await salvarRascunho(projeto.id, { revisao: 0, conteudo: { markdown: "x" } }, ana)).toEqual({ ok: false, erro: "SEM_CANETA" });
  });
});

describe("reabrir", () => {
  it("pronta → em ajuste, com vendas; tem de passar por projetos de novo", async () => {
    const { ana, paula, projeto } = await semear();
    await criarProposta(projeto.id, ana);
    await devolverProposta(projeto.id, { revisao: 0, conteudo: { markdown: "v1" }, paraId: paula.id }, ana);
    await concordarProposta(projeto.id, 2, paula);
    expect(await reabrirProposta(projeto.id, paula)).toEqual({ ok: false, erro: "SEM_CANETA" });
    expect(await reabrirProposta(projeto.id, ana)).toMatchObject({ ok: true, status: "EM_AJUSTE", revisao: 4 });
    expect(await reabrirProposta(projeto.id, ana)).toEqual({ ok: false, erro: "REABRIR_SO_PRONTA" });
    expect((await salvarRascunho(projeto.id, { revisao: 4, conteudo: { markdown: "v1 com ajuste" } }, ana)).ok).toBe(true);
    // a última versão é de vendas: não dá para concordar consigo mesmo
    expect(await concordarProposta(projeto.id, 5, ana)).toEqual({ ok: false, erro: "CONCORDAR_PROPRIA_VERSAO" });
  });
});

describe("inviável", () => {
  it("exige motivo; vendas não marca; dono de projetos marca → proposta Inviável e Projeto em Perdido", async () => {
    const { ana, paula, projeto, vendas } = await semear();
    await criarProposta(projeto.id, ana);
    expect(await marcarInviavel(projeto.id, "porque sim", ana)).toEqual({ ok: false, erro: "INVIAVEL_SEM_PERMISSAO" });
    await devolverProposta(projeto.id, { revisao: 0, conteudo: { markdown: "v1" }, paraId: paula.id }, ana);
    expect(await marcarInviavel(projeto.id, "   ", paula)).toEqual({ ok: false, erro: "MOTIVO_INVIAVEL_OBRIGATORIO" });
    expect(await marcarInviavel(projeto.id, "x".repeat(401), paula)).toEqual({ ok: false, erro: "MOTIVO_INVIAVEL_LONGO" });

    expect(await marcarInviavel(projeto.id, " Prazo  impossível para o escopo ", paula)).toMatchObject({ ok: true, status: "INVIAVEL", canetaComId: null });
    expect(await proposta(projeto.id)).toMatchObject({ status: "INVIAVEL", motivoInviavel: "Prazo impossível para o escopo", canetaComId: null });
    const p = await db.projeto.findUniqueOrThrow({ where: { id: projeto.id } });
    expect(p.faseId).toBe(vendas.fases[1].id);
    expect(p.motivoPerda).toBe("Outro: Proposta inviável: Prazo impossível para o escopo");
    expect(await db.transicaoFase.count({ where: { projetoId: projeto.id, paraFaseId: vendas.fases[1].id } })).toBe(1);
    expect(await db.propostaCaneta.count({ where: { fim: null } })).toBe(0);
    const tl = await db.timeline.findMany({ where: { projetoId: projeto.id }, orderBy: { em: "asc" } });
    expect(tl.slice(-3).map((t) => t.tipo)).toEqual(["PROPOSTA", "MOVIMENTACAO", "CAMPO_ALTERADO"]);
    // encerrada: nada mais
    expect(await salvarRascunho(projeto.id, { revisao: 1, conteudo: { markdown: "x" } }, paula)).toEqual({ ok: false, erro: "PROPOSTA_ENCERRADA" });
    expect(await pegarCaneta(projeto.id, paula)).toEqual({ ok: false, erro: "PROPOSTA_ENCERRADA" });
  });

  it("GP de projetos marca mesmo com a caneta em vendas; outro de projetos sem caneta não", async () => {
    const { ana, pedro, gp, projeto } = await semear();
    await criarProposta(projeto.id, ana);
    expect(await marcarInviavel(projeto.id, "fora do que fazemos", pedro)).toEqual({ ok: false, erro: "INVIAVEL_SEM_PERMISSAO" });
    expect(await marcarInviavel(projeto.id, "fora do que fazemos", gp)).toMatchObject({ ok: true, status: "INVIAVEL" });
  });

  it("projeto já em perdido/ganho: reabra o card antes (nada muda)", async () => {
    const { ana, gp, projeto, vendas } = await semear();
    await criarProposta(projeto.id, ana);
    await db.projeto.update({ where: { id: projeto.id }, data: { faseId: vendas.fases[1].id } });
    expect(await marcarInviavel(projeto.id, "x", gp)).toEqual({ ok: false, erro: "PROJETO_ENCERRADO" });
    expect((await proposta(projeto.id)).status).toBe("RASCUNHO");
  });
});

describe("diff, leitura e avisos", () => {
  it("diff entre quaisquer duas versões; sem `de`, desde a última entregue pelo lado de quem pede", async () => {
    const { ana, paula, projeto } = await semear();
    await criarProposta(projeto.id, ana);
    await salvarVersao(projeto.id, { revisao: 0, conteudo: { markdown: "A" }, estruturado: { valor: "1.000,00" } }, ana);
    await salvarVersao(projeto.id, { revisao: 1, conteudo: { markdown: "A\n\nB" } }, ana);
    expect(await diffDaProposta(projeto.id, { de: 1, para: 2 })).toMatchObject({ de: { numero: 1 }, para: { numero: 2 }, texto: [{ tipo: "igual" }, { tipo: "adicionada", texto: "B" }], estruturado: [] });
    // projetos nunca entregou: compara com a versão anterior
    expect(await diffDaProposta(projeto.id, { quem: paula.id })).toMatchObject({ de: { numero: 1 }, para: { numero: 2 } });
    expect(await diffDaProposta(projeto.id, { para: 1 })).toMatchObject({ de: null, estruturado: [{ campo: "Valor" }] });
    expect(await diffDaProposta(projeto.id, { de: 9 })).toBeNull();
  });

  it("obterPropostaDoProjeto traz quem está com a caneta, desde quando e o estado", async () => {
    const { ana, projeto } = await semear();
    await criarProposta(projeto.id, ana);
    const r = await obterPropostaDoProjeto(projeto.id);
    expect(r?.proposta).toMatchObject({ canetaCom: { nome: "Ana" }, canetaLado: "VENDAS", canetaDesde: expect.any(Date), estado: { status: "RASCUNHO", canetaComId: ana.id } });
  });

  it("aviso depois do commit (ponto de extensão do GAB-88); ouvinte que falha não desfaz nada", async () => {
    const { ana, paula, projeto } = await semear();
    await criarProposta(projeto.id, ana);
    const recebidos: EventoCaneta[] = [];
    const tirar = aoMudarCaneta((e) => {
      recebidos.push(e);
    });
    const tirarRuim = aoMudarCaneta(() => {
      throw new Error("whatsapp fora");
    });
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      expect((await devolverProposta(projeto.id, { revisao: 0, conteudo: { markdown: "v1" }, paraId: paula.id }, ana)).ok).toBe(true);
      expect(await passarCaneta(projeto.id, ana.id, paula)).toMatchObject({ ok: false }); // recusa não avisa
    } finally {
      tirar();
      tirarRuim();
    }
    expect(recebidos).toEqual([expect.objectContaining({ acao: "devolveu", paraId: paula.id, lado: "PROJETOS", status: "EM_ANALISE", numero: 1 })]);
    expect((await proposta(projeto.id)).canetaComId).toBe(paula.id);
  });
});

// 5 iterações de limparBanco + semear cada: colado no timeout padrão de 5 s em máquina carregada.
describe("corridas com o autosave (lock + revisão a cada mudança de caneta)", { timeout: 30_000 }, () => {
  const ultimaVersao = (propostaId: string) => db.propostaVersao.findFirstOrThrow({ where: { propostaId }, orderBy: { numero: "desc" } });

  it("autosave em voo + concordar (tela e MCP da mesma pessoa): se ficou pronta, o rascunho é a versão acordada", async () => {
    for (let i = 0; i < 5; i++) {
      await limparBanco(["proposta_caneta", "proposta_versao", "proposta", "transicao_fase", "timeline", "oportunidade", "fase", "pipeline", "sessao", "usuario"]);
      const { ana, paula, projeto } = await semear();
      await criarProposta(projeto.id, ana);
      await devolverProposta(projeto.id, { revisao: 0, conteudo: { markdown: "v1 de vendas" }, paraId: paula.id }, ana);
      await devolverProposta(projeto.id, { revisao: await rev(projeto.id), conteudo: { markdown: "v2 de projetos" }, paraId: ana.id }, paula);
      const base = await rev(projeto.id);
      const [auto, conc] = await Promise.all([salvarRascunho(projeto.id, { revisao: base, conteudo: { markdown: "digitado" } }, ana), concordarProposta(projeto.id, base, ana)]);
      expect([auto.ok, conc.ok].filter(Boolean)).toHaveLength(1);
      const p = await proposta(projeto.id);
      if (p.status === "PRONTA_PARA_ENVIO") expect(p.conteudoMd).toBe((await ultimaVersao(p.id)).conteudoMd);
      else expect(p.conteudoMd).toBe("digitado");
    }
  });

  it("autosave em voo + devolver: nenhuma escrita sem caneta entra depois da passagem", async () => {
    for (let i = 0; i < 5; i++) {
      await limparBanco(["proposta_caneta", "proposta_versao", "proposta", "transicao_fase", "timeline", "oportunidade", "fase", "pipeline", "sessao", "usuario"]);
      const { ana, paula, projeto } = await semear();
      await criarProposta(projeto.id, ana);
      await salvarRascunho(projeto.id, { revisao: 0, conteudo: { markdown: "pronto para ir" } }, ana);
      const [auto, dev] = await Promise.all([
        salvarRascunho(projeto.id, { revisao: 1, conteudo: { markdown: "digitado depois" } }, ana),
        devolverProposta(projeto.id, { revisao: 1, paraId: paula.id }, ana),
      ]);
      const p = await proposta(projeto.id);
      if (dev.ok) {
        expect(p.canetaComId).toBe(paula.id);
        expect(auto).toMatchObject({ ok: false }); // CONFLITO ou SEM_CANETA, nunca gravado
        expect(p.conteudoMd).toBe((await ultimaVersao(p.id)).conteudoMd);
      } else {
        expect(dev).toMatchObject({ erro: "CONFLITO" });
        expect(auto.ok).toBe(true);
        expect(p).toMatchObject({ canetaComId: ana.id, conteudoMd: "digitado depois" });
      }
    }
  });

  it("toda ação de caneta incrementa a revisão: a aba antiga de quem passou recebe conflito/sem caneta, nunca grava", async () => {
    const { ana, bia, gv, projeto } = await semear();
    await criarProposta(projeto.id, ana);
    expect(await passarCaneta(projeto.id, bia.id, ana)).toMatchObject({ ok: true, revisao: 1 });
    expect(await pegarCaneta(projeto.id, gv)).toMatchObject({ ok: true, revisao: 2 });
    expect(await salvarRascunho(projeto.id, { revisao: 1, conteudo: { markdown: "x" } }, gv)).toMatchObject({ ok: false, erro: "CONFLITO" });
  });
});

describe("versões sem lado (salvas pela gestão antes da caneta)", () => {
  it("devolver sem mudança cria versão nova com o lado de quem devolve; o outro lado consegue concordar", async () => {
    const { ana, gil, paula, projeto } = await semear();
    await criarProposta(projeto.id, ana);
    const p = await proposta(projeto.id);
    await db.propostaVersao.create({ data: { propostaId: p.id, numero: 1, conteudoMd: p.conteudoMd, estruturado: p.estruturado ?? {}, autorId: gil.id, autorLado: null } });
    expect(await concordarProposta(projeto.id, 0, ana)).toEqual({ ok: false, erro: "CONCORDAR_PROPRIA_VERSAO" });
    expect(await devolverProposta(projeto.id, { revisao: 0, paraId: paula.id }, ana)).toMatchObject({ ok: true, numero: 2 });
    expect(await ultimaVersaoLado(p.id)).toBe("VENDAS");
    expect(await concordarProposta(projeto.id, await rev(projeto.id), paula)).toMatchObject({ ok: true, status: "PRONTA_PARA_ENVIO" });
  });

  async function ultimaVersaoLado(propostaId: string) {
    return (await db.propostaVersao.findFirstOrThrow({ where: { propostaId }, orderBy: { numero: "desc" } })).autorLado;
  }
});

describe("inviável tem volta: card reaberto pelo Kanban", () => {
  it("sair de Perdido volta a proposta para Em ajuste, sem caneta (o GP de vendas pega), com Timeline", async () => {
    const { ana, gp, gv, projeto, vendas } = await semear();
    await criarProposta(projeto.id, ana);
    await marcarInviavel(projeto.id, "caro demais", gp);
    const antes = await rev(projeto.id);
    expect(await moverCard(projeto.id, vendas.fases[0].id, ana)).toMatchObject({ ok: true, mudou: true });
    expect(await proposta(projeto.id)).toMatchObject({ status: "EM_AJUSTE", canetaComId: null, canetaLado: "VENDAS", motivoInviavel: null, revisao: antes + 1 });
    expect(await eventos(projeto.id)).toContain("reaberta_do_perdido");
    expect(await pegarCaneta(projeto.id, gv)).toMatchObject({ ok: true, status: "EM_AJUSTE" });
  });

  it("card sem proposta inviável sai de Perdido sem mexer na proposta", async () => {
    const { ana, projeto, vendas } = await semear();
    await criarProposta(projeto.id, ana);
    await moverCard(projeto.id, vendas.fases[1].id, ana, { dadosTerminal: { motivo: "preco" } });
    const antes = await proposta(projeto.id);
    await moverCard(projeto.id, vendas.fases[0].id, ana);
    expect(await proposta(projeto.id)).toMatchObject({ status: antes.status, revisao: antes.revisao, canetaComId: ana.id });
  });
});

describe("Gestão desativa ou troca o lado do dono da caneta", () => {
  it("a caneta fica sem dono e o período fecha (o tempo com a caneta não infla)", async () => {
    const { ana, gil, gv, projeto } = await semear();
    await criarProposta(projeto.id, ana);
    expect(await atualizarUsuario(ana.id, { ativo: false }, gil)).toEqual({ ok: true });
    expect(await proposta(projeto.id)).toMatchObject({ canetaComId: null, canetaLado: "VENDAS", revisao: 1 });
    expect(await db.propostaCaneta.count({ where: { fim: null } })).toBe(0);
    const tl = await db.timeline.findFirstOrThrow({ where: { projetoId: projeto.id, payload: { path: ["evento"], equals: "caneta_liberada" } } });
    expect(tl.payload).toMatchObject({ deId: ana.id, deNome: "Ana", motivo: "desativado" });
    expect(await pegarCaneta(projeto.id, gv)).toMatchObject({ ok: true });
  });

  it("mudou de lado: libera; mudança que mantém a pessoa apta (só nome) não mexe", async () => {
    const { ana, gil, projeto } = await semear();
    await criarProposta(projeto.id, ana);
    await atualizarUsuario(ana.id, { nome: "Ana Maria" }, gil);
    expect((await proposta(projeto.id)).canetaComId).toBe(ana.id);
    await atualizarUsuario(ana.id, { papel: "PROJETOS" }, gil);
    expect(await proposta(projeto.id)).toMatchObject({ canetaComId: null });
    expect((await db.timeline.findFirstOrThrow({ where: { payload: { path: ["evento"], equals: "caneta_liberada" } } })).payload).toMatchObject({ motivo: "mudou_de_lado" });
  });
});
