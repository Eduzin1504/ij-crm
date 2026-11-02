import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { OrigemTransicao, Prisma } from "@prisma/client";
import { dbTeste, limparBanco } from "@/test/db";
import { invalidarCachePipelines } from "@/lib/fases/cache";
import { executarFerramenta } from "@/lib/mcp/ferramentas";
import { resolverPeriodo } from "@/lib/ranking/periodo";
import { CONFIG_RANKING_PADRAO } from "@/lib/ranking/config";
import { salvarConfigRanking } from "@/lib/ranking/servico";
import { carregarAbertos, carregarFluxo, carregarInteracoes, carregarPainel, carregarPainelPara } from "./servico";

const db = dbTeste();
const sp = (iso: string) => new Date(`${iso}-03:00`);
const AGORA = sp("2026-11-01T15:00:00");
const OUTUBRO = resolverPeriodo("mes", "2026-10-15", AGORA);
const texto = (r: { content: unknown[] }) => (r.content[0] as { text: string }).text;

async function semear() {
  const vendas = await db.pipeline.create({
    data: {
      chave: "vendas",
      nome: "Vendas",
      ordem: 0,
      fases: {
        create: [
          { chave: "contato", nome: "Primeiro contato", ordem: 0 },
          { chave: "reuniao", nome: "Reunião", ordem: 1 },
          { chave: "ganho", nome: "Contrato assinado", ordem: 2, isTerminal: true, tipoTerminal: "GANHO", marco: "GANHO" },
          { chave: "perdido", nome: "Perdido", ordem: 3, isTerminal: true, tipoTerminal: "PERDIDO", marco: "PERDIDO" },
        ],
      },
    },
    include: { fases: true },
  });
  const projetos = await db.pipeline.create({
    data: { chave: "projetos", nome: "Projetos", ordem: 1, fases: { create: [{ chave: "handoff", nome: "Handoff", ordem: 0, marco: "HANDOFF" }] } },
    include: { fases: true },
  });
  const ana = await db.usuario.create({ data: { nome: "Ana", email: "ana@ij.test" } });
  const bia = await db.usuario.create({ data: { nome: "Bia", email: "bia@ij.test" } });
  const gil = await db.usuario.create({ data: { nome: "Gil", email: "gil@ij.test", papel: "PROJETOS" } });
  const F = (chave: string) => [...vendas.fases, ...projetos.fases].find((f) => f.chave === chave)!.id;
  return { vendas, projetos, ana, bia, gil, F };
}
type S = Awaited<ReturnType<typeof semear>>;

/** Card com histórico gravado direto (datas fixas e origens SISTEMA/IMPORT). */
async function card(
  s: S,
  titulo: string,
  dono: { id: string },
  passos: { para: string; origem: OrigemTransicao; em: Date }[],
  extra: Partial<Prisma.ProjetoUncheckedCreateInput> = {},
) {
  const ultimo = passos.at(-1)!;
  const naProjetos = s.projetos.fases.some((f) => f.id === s.F(ultimo.para));
  const o = await db.projeto.create({
    data: {
      titulo,
      pipelineId: naProjetos ? s.projetos.id : s.vendas.id,
      faseId: s.F(ultimo.para),
      responsavelId: dono.id,
      criadoVia: passos[0].origem === "IMPORT" ? "IMPORT" : "UI",
      criadoEm: passos[0].em,
      faseDesde: ultimo.em,
      ...extra,
    },
  });
  let de: string | null = null;
  for (const p of passos) {
    await db.transicaoFase.create({ data: { projetoId: o.id, deFaseId: de, paraFaseId: s.F(p.para), usuarioId: dono.id, origem: p.origem, em: p.em } });
    de = s.F(p.para);
  }
  return o.id;
}

type Nota = { usuarioId: string | null; em: Date; viaMcp?: boolean; nota?: number; feito?: string | null; mensagem?: { id: string; remetente: string }; sentimento?: "POSITIVO" | "NEUTRO" | "NEGATIVO" };

async function interacao(projetoId: string, n: Nota) {
  if (n.mensagem) {
    await db.mensagemBruta.create({
      data: { id: n.mensagem.id, eventoId: `ev-${n.mensagem.id}`, grupoJid: "g@g.us", texto: "#crm", recebidaEm: n.em, remetenteUsuarioId: n.mensagem.remetente, status: "PROCESSADA" },
    });
  }
  await db.timeline.create({
    data: {
      projetoId,
      tipo: n.mensagem ? "MENSAGEM_WHATSAPP" : "NOTA",
      usuarioId: n.usuarioId,
      mensagemBrutaId: n.mensagem?.id ?? null,
      viaMcp: n.viaMcp ?? false,
      nota: n.nota ?? null,
      sentimento: n.sentimento ?? null,
      em: n.em,
      payload: n.feito !== undefined ? { texto: "Feito: x", feito: { acao: "x", dia: n.feito } } : { texto: "nota" },
    },
  });
}

/** O cenário de exemplo de outubro/2026 (comentários = o que cada card exercita). */
async function cenario() {
  const s = await semear();
  const { ana, bia, gil } = s;
  // c1 (Ana): contato 01/10 → reunião 04/10 (3 dias) → ganho 06/10 (2 dias, R$ 10.000) → Handoff (SISTEMA). Hoje em Projetos com o Gil.
  const c1 = await card(
    s,
    "C1 ganho",
    gil,
    [
      { para: "contato", origem: "UI", em: sp("2026-10-01T10:00:00") },
      { para: "reuniao", origem: "UI", em: sp("2026-10-04T10:00:00") },
      { para: "ganho", origem: "UI", em: sp("2026-10-06T10:00:00") },
      { para: "handoff", origem: "SISTEMA", em: sp("2026-10-06T10:00:00.001") },
    ],
    { vendedorId: ana.id, dataGanho: sp("2026-10-06T10:00:00"), valorFechado: "10000" },
  );
  // c2 (Ana): contato 25/09 (antes do período) → perdido 10/10 (15 dias).
  const c2 = await card(s, "C2 perdido", ana, [
    { para: "contato", origem: "UI", em: sp("2026-09-25T10:00:00") },
    { para: "perdido", origem: "UI", em: sp("2026-10-10T10:00:00") },
  ]);
  // c3 (Bia): importado do Pipefy (contato 02/10, reunião 05/10 — IMPORT não é movimento), volta a contato 08/10 por gente (recuo, 3 dias).
  const c3 = await card(
    s,
    "C3 importado",
    bia,
    [
      { para: "contato", origem: "IMPORT", em: sp("2026-10-02T10:00:00") },
      { para: "reuniao", origem: "IMPORT", em: sp("2026-10-05T10:00:00") },
      { para: "contato", origem: "UI", em: sp("2026-10-08T10:00:00") },
    ],
    { proximaAcaoEm: sp("2026-10-30T00:00:00") },
  );
  // c4 (Bia): na lixeira — fora de tudo.
  const c4 = await card(s, "C4 lixeira", bia, [{ para: "contato", origem: "UI", em: sp("2026-10-03T10:00:00") }], { deletadoEm: sp("2026-10-04T10:00:00") });
  // c5: casca absorvida pelo ciclo único (fora mesmo se não estivesse na lixeira).
  await card(s, "C5 casca", ana, [{ para: "contato", origem: "UI", em: sp("2026-10-03T10:00:00") }], { absorvidoPorId: c1 });
  // c6 (Ana): criado 31/10 23:30 de SP (= 01/11 UTC) — ainda outubro em SP. Sem próxima ação, sem contato.
  const c6 = await card(s, "C6 virada", ana, [{ para: "contato", origem: "UI", em: sp("2026-10-31T23:30:00") }]);
  // c7 (Ana): criado 01/11 00:30 de SP — novembro. Próxima ação hoje.
  await card(s, "C7 novembro", ana, [{ para: "contato", origem: "UI", em: sp("2026-11-01T00:30:00") }], { proximaAcaoEm: sp("2026-11-01T00:00:00") });

  // Interações.
  await interacao(c1, { usuarioId: ana.id, em: sp("2026-10-02T10:00:00"), nota: 5 }); // tela
  await interacao(c1, { usuarioId: ana.id, em: sp("2026-10-03T10:00:00"), viaMcp: true }); // MCP
  // #crm da Ana resolvida manualmente pela Bia: conta para a Ana.
  await interacao(c1, { usuarioId: bia.id, em: sp("2026-10-05T10:00:00"), mensagem: { id: "m1", remetente: ana.id }, sentimento: "POSITIVO" });
  await interacao(c1, { usuarioId: ana.id, em: sp("2026-10-20T10:00:00") }); // card já em Projetos: não conta
  await interacao(c2, { usuarioId: ana.id, em: sp("2026-10-09T10:00:00"), feito: "2026-10-09", nota: 3 }); // no prazo
  await interacao(c2, { usuarioId: ana.id, em: sp("2026-10-09T23:30:00"), feito: "2026-10-09" }); // no prazo (dia de SP; já 10/10 em UTC)
  await interacao(c2, { usuarioId: ana.id, em: sp("2026-10-07T10:00:00"), feito: "2026-10-05" }); // atrasada
  await interacao(c2, { usuarioId: ana.id, em: sp("2026-10-08T10:00:00"), feito: null }); // feita sem data
  await interacao(c3, { usuarioId: bia.id, em: sp("2026-09-30T10:00:00") }); // setembro
  await interacao(c3, { usuarioId: bia.id, em: sp("2026-10-09T12:00:00"), mensagem: { id: "m2", remetente: bia.id }, sentimento: "NEGATIVO" });
  await interacao(c4, { usuarioId: bia.id, em: sp("2026-10-05T10:00:00"), nota: 1 }); // lixeira
  // Nota do Gil (PROJETOS) com o card já em Projetos: não entra na satisfação nem no engajamento.
  await interacao(c1, { usuarioId: gil.id, em: sp("2026-10-21T10:00:00"), nota: 1 });
  // NOTA sem autor (sistema) não é contato.
  await interacao(c3, { usuarioId: null, em: sp("2026-10-31T10:00:00") });
  return { ...s, c1, c2, c3, c4, c6 };
}

beforeEach(async () => {
  await limparBanco(["configuracao", "transicao_fase", "timeline", "mensagem_bruta", "oportunidade", "fase", "pipeline", "sessao", "usuario"]);
  invalidarCachePipelines();
});
afterEach(() => vi.useRealTimers());

describe("painel de vendas: cada indicador no cenário de exemplo (outubro/2026)", () => {
  it("conversão: ganhos/perdidos/R$ fechado como o ranking; funil por fase com tempo médio; IMPORT, lixeira e casca fora", async () => {
    await cenario();
    const { conversao: c } = await carregarPainel({ periodo: OUTUBRO, vendedorId: null }, AGORA);
    expect(c).toMatchObject({ ganhos: 1, perdidos: 1, conversao: 0.5, valorFechado: 10_000 });
    expect(c!.fases).toEqual([
      // Entradas por gente: c1 (01/10), c3 (volta 08/10), c6 (31/10 SP). Saídas: c1 avança (3 d), c2 perde (15 d).
      { faseId: expect.any(String), nome: "Primeiro contato", entradas: 3, avancos: 1, perdas: 1, recuos: 0, conversao: 0.5, tempoMedioDias: 9 },
      // Entrada: c1 (a do c3 é IMPORT). Saídas: c1 → ganho (2 d), c3 recua (3 d; a entrada IMPORT abre a estadia).
      { faseId: expect.any(String), nome: "Reunião", entradas: 1, avancos: 1, perdas: 0, recuos: 1, conversao: 1, tempoMedioDias: 2.5 },
    ]);
    expect(c!.valorEmProposta.disponivel).toBe(false);
    expect(c!.versoesAteFechar.disponivel).toBe(false);
  });

  it("engajamento: #crm (de quem mandou), tela e MCP; ações no prazo pelo dia de SP; só enquanto o card estava em Vendas", async () => {
    const s = await cenario();
    const { engajamento: e } = await carregarPainel({ periodo: OUTUBRO, vendedorId: null }, AGORA);
    const linha = (id: string) => e!.porVendedor.find((l) => l.usuario.id === id);
    expect(linha(s.ana.id)).toMatchObject({ whatsapp: 1, tela: 5, mcp: 1, interacoes: 7, acoesFeitas: 4, acoesComPrazo: 3, acoesNoPrazo: 2, taxaNoPrazo: 2 / 3 });
    expect(linha(s.bia.id)).toMatchObject({ whatsapp: 1, tela: 0, mcp: 0, interacoes: 1, acoesFeitas: 0, taxaNoPrazo: null });
    expect(e!.time).toMatchObject({ interacoes: 8, whatsapp: 2 });
  });

  it("acompanhamento (agora): abertos em Vendas, sem próxima ação, vencidas, dias desde o último contato", async () => {
    const s = await cenario();
    const { acompanhamento: a } = await carregarPainel({ periodo: OUTUBRO, vendedorId: null }, AGORA);
    // Abertos: c3 (Bia), c6 e c7 (Ana). c1 em Projetos, c2 perdido, c4 na lixeira, c5 casca.
    expect(a).toMatchObject({ abertos: 3, semProximaAcao: 1, vencidas: 1, semContatoRegistrado: 2 });
    expect(a!.maisParados.map((c) => [c.titulo, c.diasSemContato])).toEqual([
      ["C3 importado", 23], // último contato: #crm de 09/10 12:00
      ["C6 virada", 0],
      ["C7 novembro", 0],
    ]);
    expect(a!.porResponsavel.find((l) => l.usuario.id === s.bia.id)).toMatchObject({ abertos: 1, vencidas: 1, mediaDiasSemContato: 23 });
  });

  it("satisfação: reaproveita avaliacoesPorVendedor (GAB-85)", async () => {
    const s = await cenario();
    const { satisfacao: sat } = await carregarPainel({ periodo: OUTUBRO, vendedorId: null }, AGORA);
    expect(sat!.time).toEqual({ notas: 2, notaMedia: 4, positivos: 1, neutros: 0, negativos: 1 });
    expect(sat!.porVendedor.find((l) => l.usuario.id === s.ana.id)).toMatchObject({ notas: 2, notaMedia: 4, positivos: 1 });
  });

  it("filtro por vendedor: cada indicador só com a pessoa", async () => {
    const s = await cenario();
    const p = await carregarPainel({ periodo: OUTUBRO, vendedorId: s.bia.id }, AGORA);
    expect(p.vendedor?.nome).toBe("Bia");
    expect(p.conversao).toMatchObject({ ganhos: 0, perdidos: 0, conversao: null });
    expect(p.conversao!.fases.map((f) => [f.nome, f.entradas, f.recuos])).toEqual([
      ["Primeiro contato", 1, 0],
      ["Reunião", 0, 1],
    ]);
    expect(p.engajamento!.porVendedor.map((l) => l.usuario.nome)).toEqual(["Bia"]);
    expect(p.acompanhamento!.abertos).toBe(1);
    expect(p.satisfacao!.time).toMatchObject({ notas: 0, negativos: 1 });
  });

  it("semana: o período corta pelas segundas de SP", async () => {
    await cenario();
    const semana = resolverPeriodo("semana", "2026-10-07", AGORA); // 05/10 a 11/10
    const { conversao: c } = await carregarPainel({ periodo: semana, vendedorId: null }, AGORA, ["conversao"]);
    expect(c).toMatchObject({ ganhos: 1, perdidos: 1 });
    expect(c!.fases.map((f) => [f.nome, f.entradas, f.avancos, f.perdas, f.recuos])).toEqual([
      ["Primeiro contato", 1, 0, 1, 0],
      ["Reunião", 0, 1, 0, 1],
    ]);
  });

  it("indicadores pedidos: só carrega o que foi pedido", async () => {
    await cenario();
    const p = await carregarPainel({ periodo: OUTUBRO, vendedorId: null }, AGORA, ["satisfacao"]);
    expect(Object.keys(p).sort()).toEqual(["periodo", "satisfacao", "vendedor", "vendedores"]);
  });
});

describe("painel: fuso da sessão não muda os números", () => {
  it("com a sessão em America/Sao_Paulo (SET LOCAL TIME ZONE) as consultas dão o mesmo", async () => {
    await cenario();
    const semFuso = { fluxo: await carregarFluxo(OUTUBRO), interacoes: await carregarInteracoes(OUTUBRO), abertos: await carregarAbertos() };
    const comFuso = await db.$transaction(async (tx) => {
      await tx.$executeRawUnsafe("SET LOCAL TIME ZONE 'America/Sao_Paulo'");
      return { fluxo: await carregarFluxo(OUTUBRO, tx), interacoes: await carregarInteracoes(OUTUBRO, tx), abertos: await carregarAbertos(tx) };
    });
    const ordenar = <T extends object>(xs: T[]) => [...xs].map((x) => JSON.stringify(x)).sort();
    expect(ordenar(comFuso.fluxo)).toEqual(ordenar(semFuso.fluxo));
    expect(comFuso.interacoes).toEqual(semFuso.interacoes);
    expect(ordenar(comFuso.abertos)).toEqual(ordenar(semFuso.abertos));
  });
});

describe("MCP consultar_painel_vendas: mesmos números da tela", () => {
  it("devolve o mesmo painel que a tela carrega; filtro 'eu' e indicador único", async () => {
    const s = await cenario();
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(AGORA);
    const eu = { id: s.ana.id, nome: "Ana", papel: "VENDEDOR" as const };
    const r = await executarFerramenta("consultar_painel_vendas", { periodo: "mes", ref: "2026-10-15" }, eu);
    expect(r.isError).toBeFalsy();
    const mcp = JSON.parse(texto(r));
    const tela = JSON.parse(JSON.stringify(await carregarPainel({ periodo: OUTUBRO, vendedorId: null }, AGORA)));
    for (const k of ["conversao", "engajamento", "acompanhamento", "satisfacao"]) expect(mcp[k], k).toEqual(tela[k]);
    expect(mcp.periodo).toMatchObject({ tipo: "mes", primeiroDia: "2026-10-01", ultimoDia: "2026-10-31" });

    const so = JSON.parse(texto(await executarFerramenta("consultar_painel_vendas", { indicador: "conversao", periodo: "mes", ref: "2026-10-15", vendedor_id: "eu" }, eu)));
    expect(so.vendedor).toMatchObject({ nome: "Ana" });
    expect(so.conversao).toMatchObject({ ganhos: 1, perdidos: 1, valorFechado: 10_000 });
    expect(so.engajamento).toBeUndefined();
  });

  it("vendedor desconhecido: erro claro; VISUALIZADOR pode consultar (leitura)", async () => {
    const s = await cenario();
    const vera = await db.usuario.create({ data: { nome: "Vera", email: "vera@ij.test", papel: "VISUALIZADOR" } });
    const r = await executarFerramenta("consultar_painel_vendas", { vendedor_id: "nao-existe" }, { id: s.ana.id, nome: "Ana", papel: "VENDEDOR" });
    expect(r.isError).toBe(true);
    expect(texto(r)).toContain("Vendedor não encontrado");
    const v = await executarFerramenta("consultar_painel_vendas", { indicador: "satisfacao" }, { id: vera.id, nome: "Vera", papel: "VISUALIZADOR" });
    expect(v.isError).toBeFalsy();
  });
});

describe("visibilidade: segue o \"Mostrar ranking aos vendedores\" (review do PR #54)", () => {
  async function esconderRanking() {
    const gestora = await db.usuario.create({ data: { nome: "Gê", email: "ge@ij.test", papel: "GESTOR" } });
    const r = await salvarConfigRanking({ ...CONFIG_RANKING_PADRAO, mostrarAosVendedores: false }, { id: gestora.id, papel: "GESTOR" }, null);
    expect(r.ok).toBe(true);
    return gestora;
  }
  const bia = (s: S) => ({ id: s.bia.id, papel: "VENDEDOR" as const });

  it("ranking visível (padrão): vendedor vê tudo e filtra por qualquer um", async () => {
    const s = await cenario();
    const v = await carregarPainelPara(bia(s), { periodo: OUTUBRO, vendedorId: s.ana.id }, AGORA);
    expect(v).toMatchObject({ ok: true, modo: "completo" });
  });

  it("ranking oculto: vendedor vê os totais do time e só as próprias linhas; filtro por outro é recusado", async () => {
    const s = await cenario();
    await esconderRanking();
    const v = await carregarPainelPara(bia(s), { periodo: OUTUBRO, vendedorId: null }, AGORA);
    if (!v.ok) throw new Error(v.erro);
    expect(v.modo).toBe("proprio");
    const p = v.painel;
    expect(p.vendedores.map((x) => x.id)).toEqual([s.bia.id]);
    expect(p.engajamento!.porVendedor.map((l) => l.usuario.id)).toEqual([s.bia.id]);
    expect(p.engajamento!.time.interacoes).toBe(8); // total do time
    expect(p.satisfacao!.porVendedor.map((l) => l.usuario.id)).toEqual([s.bia.id]);
    expect(p.acompanhamento!.porResponsavel.map((l) => l.usuario.id)).toEqual([s.bia.id]);
    expect(p.acompanhamento!.maisParados.map((c) => c.titulo)).toEqual(["C3 importado"]);
    expect(p.acompanhamento!.abertos).toBe(3); // total do time
    expect(p.conversao).toMatchObject({ ganhos: 1, perdidos: 1 });

    expect(await carregarPainelPara(bia(s), { periodo: OUTUBRO, vendedorId: s.ana.id }, AGORA)).toEqual({ ok: false, erro: "SEM_PERMISSAO" });
    const propria = await carregarPainelPara(bia(s), { periodo: OUTUBRO, vendedorId: s.bia.id }, AGORA);
    expect(propria).toMatchObject({ ok: true, modo: "proprio", painel: { vendedor: { id: s.bia.id } } });
    // PROJETOS também é escondido (como no ranking).
    expect(await carregarPainelPara({ id: s.gil.id, papel: "PROJETOS" }, { periodo: OUTUBRO, vendedorId: s.ana.id }, AGORA)).toEqual({ ok: false, erro: "SEM_PERMISSAO" });
  });

  it("ranking oculto: gestor e visualizador continuam vendo tudo", async () => {
    const s = await cenario();
    const gestora = await esconderRanking();
    const vera = await db.usuario.create({ data: { nome: "Vera", email: "vera@ij.test", papel: "VISUALIZADOR" } });
    for (const ator of [{ id: gestora.id, papel: "GESTOR" as const }, { id: vera.id, papel: "VISUALIZADOR" as const }]) {
      const v = await carregarPainelPara(ator, { periodo: OUTUBRO, vendedorId: s.ana.id }, AGORA);
      expect(v, ator.papel).toMatchObject({ ok: true, modo: "completo", painel: { vendedor: { id: s.ana.id } } });
    }
  });

  it("vendedor desconhecido é recusado antes de calcular", async () => {
    const s = await cenario();
    expect(await carregarPainelPara(bia(s), { periodo: OUTUBRO, vendedorId: "nao-existe" }, AGORA)).toEqual({ ok: false, erro: "VENDEDOR_DESCONHECIDO" });
  });

  it("MCP com ranking oculto: vendedor_id de outro → erro; \"eu\" e sem filtro funcionam, só com as próprias linhas", async () => {
    const s = await cenario();
    await esconderRanking();
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(AGORA);
    const eu = { id: s.bia.id, nome: "Bia", papel: "VENDEDOR" as const };
    const outro = await executarFerramenta("consultar_painel_vendas", { vendedor_id: s.ana.id, ref: "2026-10-15" }, eu);
    expect(outro.isError).toBe(true);
    expect(texto(outro)).toContain("ocultou o ranking");
    const proprio = await executarFerramenta("consultar_painel_vendas", { vendedor_id: "eu", ref: "2026-10-15" }, eu);
    expect(proprio.isError).toBeFalsy();
    const time = JSON.parse(texto(await executarFerramenta("consultar_painel_vendas", { indicador: "engajamento", ref: "2026-10-15" }, eu)));
    expect(time.engajamento.porVendedor.map((l: { usuario: { id: string } }) => l.usuario.id)).toEqual([s.bia.id]);
    expect(time.engajamento.time.interacoes).toBe(8);
    expect(time.definicoes.visibilidade).toContain("Mostrar ranking aos vendedores");
  });
});
