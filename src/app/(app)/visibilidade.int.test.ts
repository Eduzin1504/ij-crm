// @vitest-environment node
/**
 * Matriz papel × área na tela (GAB-98, spec áreas §4.4 a §4.7): sessão de verdade
 * (cookie → `obterUsuarioDaSessao`, com área e cargos), páginas, actions e rotas.
 */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactElement, ReactNode } from "react";

const { sessao } = vi.hoisted(() => ({ sessao: { valor: "" } }));
vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => ({ value: sessao.valor }) }) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { criarSessao } from "@/lib/auth/sessao";
import { listarAvisos } from "@/lib/avisos/avisos";
import { carregarItens } from "@/lib/calendario/calendario";
import { listarQuadro } from "@/lib/projetos/projetos";
import { ocultarPropostasDoQuadro } from "@/lib/propostas/acesso";
import { comentar } from "@/lib/propostas/comentarios";
import { criarProposta, listarPropostas, passarCaneta } from "@/lib/propostas/propostas";
import { MATRIZ, semearVisibilidade, type Mundo, type NomePersona, type Persona } from "@/test/visibilidade";
import { excluirAnexoAction, excluirCardAction, restaurarCardAction } from "./_lixeira/actions";
import { concluirPrazoAction, criarPrazoAction } from "./_calendario/actions";
import { definirProximaAction } from "./_semana/actions";
import CalendarioPage from "./calendario/page";
import { adicionarNotaAction, criarCardAction, editarCampoAction, moverCardAction } from "./kanban/actions";
import InicioPage from "./page";
import PainelPage from "./painel/page";
import CardPage from "./projetos/[id]/page";
import { MoverFase } from "./projetos/[id]/mover-fase";
import { sugerirDeAnexoAction } from "./projetos/[id]/proposta/preencher-actions";
import { ResultadoTerminal } from "./projetos/[id]/resultado-terminal";
import { Timeline } from "./projetos/[id]/timeline";
import { CampoInline } from "./projetos/[id]/campo-inline";
import DiffPage from "./projetos/[id]/proposta/diff/page";
import PropostaPage from "./projetos/[id]/proposta/page";
import VersaoPage from "./projetos/[id]/proposta/versoes/[numero]/page";
import { marcarItemAction, moverParaExecucaoAction } from "./projetos/[id]/handoff-actions";
import { POST as handoffContratoPOST } from "@/app/api/projetos/[id]/handoff/contrato/route";
import { vincularAction } from "./projetos/[id]/vinculos-actions";
import { GET as pdfGET } from "@/app/api/projetos/[id]/proposta/pdf/route";
import { GET as comentariosGET } from "@/app/api/projetos/[id]/comentarios/route";
import { POST as anexoPOST } from "@/app/api/projetos/[id]/anexos/route";
import { POST as contratoPOST } from "@/app/api/projetos/[id]/contrato-assinado/route";
import PropostasPage from "./propostas/page";
import RankingPage from "./ranking/page";
import SemanaPage from "./semana/page";
import { GET as csvGET } from "./tabela/csv/route";
import TabelaPage from "./tabela/page";

let m: Mundo;
let dirAnexos: string;

beforeAll(async () => {
  dirAnexos = await mkdtemp(join(tmpdir(), "ij-vis-"));
  process.env.ANEXOS_DIR = dirAnexos;
});
afterAll(async () => {
  delete process.env.ANEXOS_DIR;
  await rm(dirAnexos, { recursive: true, force: true });
});
beforeEach(async () => {
  m = await semearVisibilidade();
});

async function como(p: Persona) {
  sessao.valor = await criarSessao(p.id);
}

/** Para onde foi o redirect (`NEXT_REDIRECT;...;/403;307;`), ou "abriu". `notFound` vira "404". */
async function destino(fn: () => Promise<unknown>): Promise<string> {
  try {
    await fn();
    return "abriu";
  } catch (e) {
    const digest = (e as { digest?: string }).digest ?? "";
    if (digest.startsWith("NEXT_REDIRECT")) return digest.split(";")[2];
    if (digest.includes("404")) return "404";
    throw e;
  }
}

const params = <T,>(x: T) => Promise.resolve(x);
const semBusca = { searchParams: params({}) };

describe.each(MATRIZ)("matriz tela: $nome", ({ nome, escreve, editaVendas, editaProjetos, veTabela, todasPropostas }) => {
  const FORA = /outra área/;
  const eu = () => m.p[nome];
  const abriuOu403 = (pode: boolean) => (pode ? "abriu" : "/403");

  it("Tabela e Ranking, página e CSV, seguem o item; Painel é de todos", async () => {
    await como(eu());
    expect(await destino(() => TabelaPage(semBusca))).toBe(abriuOu403(veTabela));
    expect(await destino(() => RankingPage(semBusca))).toBe(abriuOu403(veTabela));
    expect(await destino(() => csvGET(new Request("http://x/tabela/csv")))).toBe(abriuOu403(veTabela));
    expect(await destino(() => PainelPage(semBusca))).toBe("abriu");
  });

  it("Propostas, Calendário e Minha Semana: visualizador não tem", async () => {
    await como(eu());
    expect(await destino(() => PropostasPage(semBusca))).toBe(abriuOu403(escreve));
    expect(await destino(() => CalendarioPage(semBusca))).toBe(abriuOu403(escreve));
    expect(await destino(() => SemanaPage(semBusca))).toBe(abriuOu403(escreve));
  });

  it("actions: mover e editar seguem a área dona; nota e prazo, quem escreve", async () => {
    await como(eu());
    const espera = async (fn: () => Promise<unknown>, pode: boolean) => {
      if (!escreve) return expect(await destino(fn)).toBe("/403");
      const r = (await fn()) as { erro?: string };
      if (pode) expect(r.erro ?? "").not.toMatch(FORA);
      else expect(r.erro).toMatch(FORA);
    };
    for (const [card, pode, destinoFase, pipeline] of [
      [m.cardV, editaVendas, m.fase("em_negociacao").id, m.vendas],
      [m.cardP, editaProjetos, m.fase("execucao").id, m.projetos],
    ] as const) {
      await espera(() => editarCampoAction(card.id, "cidade", "Santos"), pode);
      await espera(() => moverCardAction(card.id, destinoFase), pode);
      await espera(() => vincularAction(card.id, "empresa", null), pode);
      await espera(() => definirProximaAction(card.id, "Ligar", "2099-01-10"), pode);
      await espera(() => criarCardAction(pipeline.id, pipeline.fases[0].id, "Novo"), pode);
      expect((await m.db.projeto.findUniqueOrThrow({ where: { id: card.id } })).cidade).toBe(pode ? "Santos" : null);

      await espera(() => adicionarNotaAction(card.id, "de fora"), true);
      await espera(() => criarPrazoAction({ titulo: "Prazo", dia: "2099-01-10", responsavelId: eu().id, projetoId: card.id }), true);
    }
    expect(await m.db.timeline.count({ where: { tipo: "NOTA", usuarioId: eu().id } })).toBe(escreve ? 2 : 0);
  });

  it("anexar em card de outra área: quem escreve; o contrato assinado segue a área dona", async () => {
    await como(eu());
    const anexo = new Request("http://x", { method: "POST", headers: { "x-nome-arquivo": "nota.txt" }, body: "texto" });
    const r = await anexoPOST(anexo, { params: params({ id: m.cardP.id }) });
    expect(r.status).toBe(escreve ? 201 : 403);
    const c = await contratoPOST(new Request("http://x", { method: "POST", headers: { "x-nome-arquivo": "c.pdf", "x-valor-fechado": "1,00" }, body: "x" }), { params: params({ id: m.cardV.id }) });
    expect(c.status === 403).toBe(!editaVendas);
  });

  it("proposta sem estar escalado: página, versão, diff, PDF e comentários", async () => {
    await criarProposta(m.cardV.id, m.p.donoV);
    await como(eu());
    const id = m.cardV.id;
    const esperado = abriuOu403(todasPropostas);
    expect(await destino(() => PropostaPage({ params: params({ id }) }))).toBe(esperado);
    // Sem versão salva: quem vê chega ao 404 da versão; quem não vê para no /403 antes.
    expect(await destino(() => VersaoPage({ params: params({ id, numero: "1" }) }))).toBe(todasPropostas ? "404" : "/403");
    expect(await destino(() => DiffPage({ params: params({ id }), searchParams: params({}) }))).toBe(todasPropostas ? "404" : "/403");
    expect((await pdfGET(new Request(`http://x/api/projetos/${id}/proposta/pdf`), { params: params({ id }) })).status === 403).toBe(!todasPropostas);
    expect((await comentariosGET(new Request(`http://x/api/projetos/${id}/comentarios`), { params: params({ id }) })).status).toBe(todasPropostas ? 200 : 403);
    const lista = await listarPropostas({}, eu());
    expect(lista.length).toBe(todasPropostas ? 1 : 0);
  });

  it("tela do card: controles e proposta só para quem pode", async () => {
    await criarProposta(m.cardV.id, m.p.donoV);
    await m.db.projeto.update({ where: { id: m.cardV.id }, data: { propostaUrl: "https://docs.exemplo/p" } });
    await como(eu());
    const pagina = (await CardPage({ params: params({ id: m.cardV.id }) })) as ReactElement;
    expect(acharPorTipo(pagina, MoverFase)[0].props.somenteLeitura).toBe(!editaVendas);
    const campos = acharPorTipo(pagina, CampoInline);
    expect(campos.filter((c) => c.props.campo !== "responsavelId").every((c) => c.props.somenteLeitura === !editaVendas)).toBe(true);
    const responsavel = campos.find((c) => c.props.campo === "responsavelId")!;
    const trocaResponsavel = editaVendas && nome !== "vendedor";
    expect(responsavel.props.somenteLeitura).toBe(!trocaResponsavel);
    expect(campos.some((c) => c.props.campo === "propostaUrl")).toBe(todasPropostas);
    const texto = JSON.stringify(textos(pagina));
    expect(texto.includes("Abrir proposta")).toBe(todasPropostas);
  });

  it("badge do Kanban: só com acesso à proposta", async () => {
    await criarProposta(m.cardV.id, m.p.donoV);
    const quadro = await ocultarPropostasDoQuadro((await listarQuadro("vendas"))!, eu());
    expect(quadro.cards.find((c) => c.id === m.cardV.id)?.proposta !== null).toBe(todasPropostas);
  });
});

/** Procura no elemento devolvido pela página (sem renderizar client components). */
function percorrer(n: ReactNode, fn: (e: ReactElement<Record<string, unknown>>) => void) {
  if (Array.isArray(n)) return n.forEach((x) => percorrer(x, fn));
  if (!n || typeof n !== "object" || !("props" in (n as object))) return;
  const e = n as ReactElement<Record<string, unknown>>;
  fn(e);
  percorrer(e.props.children as ReactNode, fn);
}
function acharPorTipo(raiz: ReactNode, tipo: unknown) {
  const achados: ReactElement<Record<string, unknown>>[] = [];
  percorrer(raiz, (e) => {
    if (e.type === tipo) achados.push(e);
  });
  return achados;
}
function textos(raiz: ReactNode) {
  const lista: string[] = [];
  percorrer(raiz, (e) => {
    const c = e.props.children;
    for (const x of Array.isArray(c) ? c : [c]) if (typeof x === "string") lista.push(x);
  });
  return lista;
}

describe("casos que a matriz não cobre", () => {
  it("responsável: vendedor da área não se coloca; propostaUrl sem acesso à proposta é recusada", async () => {
    await criarProposta(m.cardV.id, m.p.donoV);
    await como(m.p.vendedor);
    expect(await editarCampoAction(m.cardV.id, "responsavelId", m.p.vendedor.id)).toMatchObject({ erro: expect.stringMatching(/Trocar o responsável/) });
    expect(await editarCampoAction(m.cardV.id, "propostaUrl", "https://docs.exemplo/x")).toMatchObject({ erro: expect.stringMatching(/não tem acesso/) });
    expect(await destino(() => PropostaPage({ params: params({ id: m.cardV.id }) }))).toBe("/403");
    await como(m.p.gpVendas);
    expect(await editarCampoAction(m.cardV.id, "responsavelId", m.p.vendedor.id)).toEqual({ ok: true });
    await como(m.p.vendedor);
    expect(await editarCampoAction(m.cardV.id, "propostaUrl", "https://docs.exemplo/x")).toEqual({ ok: true });
  });

  it("motivo antigo de inviável: mascarado no card, no diálogo e no Kanban para quem não vê", async () => {
    await criarProposta(m.cardV.id, m.p.donoV);
    const antigo = "Outro: Proposta inviável: Segredo do escopo";
    await m.db.projeto.update({ where: { id: m.cardV.id }, data: { motivoPerda: antigo } });
    await m.db.timeline.create({ data: { projetoId: m.cardV.id, tipo: "CAMPO_ALTERADO", payload: { campo: "motivoPerda", antes: null, depois: antigo } } });
    const pagina = async () => (await CardPage({ params: params({ id: m.cardV.id }) })) as ReactElement;
    await como(m.p.vendedor);
    const p = await pagina();
    expect(acharPorTipo(p, ResultadoTerminal)[0].props.card).toMatchObject({ motivoPerda: "Outro: Proposta inviável" });
    expect(acharPorTipo(p, MoverFase)[0].props.fechamento).toMatchObject({ motivoPerda: "Outro: Proposta inviável" });
    expect(JSON.stringify(acharPorTipo(p, Timeline)[0].props.entradas)).not.toContain("Segredo");
    const quadro = await ocultarPropostasDoQuadro((await listarQuadro("vendas"))!, m.p.vendedor);
    expect(JSON.stringify(quadro.cards)).not.toContain("Segredo");

    await como(m.p.gpProjetos);
    expect(acharPorTipo(await pagina(), ResultadoTerminal)[0].props.card).toMatchObject({ motivoPerda: antigo });
  });

  it("preencher de anexo e comentar: quem não vê não descobre se a proposta existe", async () => {
    await como(m.p.membroProjetos);
    expect(await sugerirDeAnexoAction(m.cardV.id, "qualquer")).toMatchObject({ ok: false, erro: expect.stringMatching(/não tem acesso/) });
    const semProposta = await comentar(m.cardV.id, { texto: "oi" }, m.p.membroProjetos);
    await criarProposta(m.cardV.id, m.p.donoV);
    expect(await comentar(m.cardV.id, { texto: "oi" }, m.p.membroProjetos)).toEqual(semProposta);
    expect(semProposta).toEqual({ ok: false, erro: "SEM_PERMISSAO" });
    expect(await comentar("nao-existe", { texto: "oi" }, m.p.membroProjetos)).toEqual(semProposta);
  });

  it("handoff na tela: itens seguem a área dona; o PDF do contrato também", async () => {
    await como(m.p.vendedor);
    expect(await marcarItemAction(m.cardP.id, "kickoff", true)).toMatchObject({ erro: expect.stringMatching(/outra área/) });
    expect(await moverParaExecucaoAction(m.cardP.id)).toMatchObject({ erro: expect.stringMatching(/outra área/) });
    const pdf = await handoffContratoPOST(new Request("http://x", { method: "POST", headers: { "x-nome-arquivo": "c.pdf" }, body: "x" }), { params: params({ id: m.cardP.id }) });
    expect(pdf.status).toBe(403);
    await como(m.p.membroProjetos);
    expect(await marcarItemAction(m.cardP.id, "kickoff", true)).toEqual({ ok: true });
  });

  it("lixeira: gestor de outra área não restaura; da área, sem área e admin restauram", async () => {
    const naLixeira = (id: string) => m.db.projeto.update({ where: { id }, data: { deletadoEm: new Date() } });
    await naLixeira(m.cardV.id);
    await como(m.p.gestorProjetos);
    expect(await restaurarCardAction(m.cardV.id, null)).toMatchObject({ erro: expect.stringMatching(/outra área/) });
    expect((await m.db.projeto.findUniqueOrThrow({ where: { id: m.cardV.id } })).deletadoEm).not.toBeNull();
    for (const quem of [m.p.gestorVendas, m.p.gestorSemArea, m.p.admin]) {
      await naLixeira(m.cardV.id);
      await como(quem);
      expect(await restaurarCardAction(m.cardV.id, null)).toMatchObject({ ok: true });
    }
  });

  it("`/?vendedor=`: visualizador cai na entrada dele, sem /403 nem loop; os outros seguem para a semana", async () => {
    const pedir = () => InicioPage({ searchParams: params({ vendedor: m.p.donoV.id }) });
    await como(m.p.visualizador);
    expect(await destino(pedir)).toBe("/painel");
    await m.db.usuario.update({ where: { id: m.p.visualizador.id }, data: { areaEntrada: "VENDAS" } });
    expect(await destino(pedir)).toBe("/kanban");
    await como(m.p.vendedor);
    expect(await destino(pedir)).toBe(`/semana?vendedor=${m.p.donoV.id}`);
  });

  it("aviso do sino: quem recebe consegue abrir o destino", async () => {
    await criarProposta(m.cardV.id, m.p.donoV);
    await passarCaneta(m.cardV.id, m.p.vendedor.id, m.p.donoV);
    const [aviso] = await listarAvisos(m.p.vendedor.id);
    expect(aviso.href).toBe(`/projetos/${m.cardV.id}/proposta`);
    await como(m.p.vendedor);
    expect(await destino(() => PropostaPage({ params: params({ id: m.cardV.id }) }))).toBe("abriu");
  });

  it("aviso de comentário e de aceite chegam a quem está escalado (o dono e o responsável)", async () => {
    await criarProposta(m.cardV.id, m.p.donoV);
    await comentar(m.cardV.id, { texto: "oi" }, m.p.gpProjetos);
    const [aviso] = await listarAvisos(m.p.donoV.id);
    expect(aviso.tipo).toBe("COMENTARIO");
    await como(m.p.donoV);
    expect(await destino(() => PropostaPage({ params: params({ id: m.cardV.id }) }))).toBe("abriu");
  });

  it("ex-dono e responsável do card continuam abrindo; responsável fora da área edita e arrasta", async () => {
    await criarProposta(m.cardV.id, m.p.donoV);
    await passarCaneta(m.cardV.id, m.p.vendedor.id, m.p.donoV);
    await passarCaneta(m.cardV.id, m.p.gpVendas.id, m.p.vendedor);
    await como(m.p.vendedor); // ex-dono: não é responsável nem está com a caneta
    expect(await destino(() => PropostaPage({ params: params({ id: m.cardV.id }) }))).toBe("abriu");

    await m.db.projeto.update({ where: { id: m.cardV.id }, data: { responsavelId: m.p.membroProjetos.id } });
    await como(m.p.membroProjetos);
    expect(await editarCampoAction(m.cardV.id, "cidade", "Santos")).toEqual({ ok: true });
    expect(await moverCardAction(m.cardV.id, m.fase("em_negociacao").id)).toEqual({ ok: true });
    expect(await destino(() => PropostaPage({ params: params({ id: m.cardV.id }) }))).toBe("abriu");
  });

  it("excluir card: área dona; anexo: o autor (de fora também) ou quem edita", async () => {
    await como(m.p.membroProjetos);
    expect(await excluirCardAction(m.cardV.id, "vendas")).toMatchObject({ erro: expect.stringMatching(/outra área/) });
    const anexo = await anexoPOST(new Request("http://x", { method: "POST", headers: { "x-nome-arquivo": "nota.txt" }, body: "texto" }), { params: params({ id: m.cardV.id }) });
    const { anexo: criado } = (await anexo.json()) as { anexo: { id: string } };

    const naoAutor: NomePersona = "gpProjetos";
    await como(m.p[naoAutor]);
    expect(await excluirAnexoAction(criado.id)).toMatchObject({ erro: expect.stringMatching(/outra área/) });
    await como(m.p.membroProjetos);
    expect(await excluirAnexoAction(criado.id)).toMatchObject({ ok: true });
  });

  it("Calendário: prazo de outra pessoa concluído por quem não é dono continua recusado; card fora da área aceita prazo próprio", async () => {
    await como(m.p.membroProjetos);
    expect(await criarPrazoAction({ titulo: "Meu", dia: "2099-01-10", responsavelId: m.p.membroProjetos.id, projetoId: m.cardV.id })).toEqual({ ok: true });
    const prazo = await m.db.prazo.findFirstOrThrow({ where: { projetoId: m.cardV.id } });
    await como(m.p.vendedor);
    expect(await concluirPrazoAction(prazo.id, true)).toMatchObject({ erro: expect.any(String) });
    // Atribuído: o responsável do card vê esse prazo no Calendário dele.
    const itens = await carregarItens({ responsavelIds: [m.p.donoV.id], comPrazosDosCards: true }, { primeiroDia: "2099-01-01", ultimoDia: "2099-01-31", hoje: "2099-01-01" }, m.p.donoV);
    expect(itens.prazos.map((p) => p.titulo)).toEqual(["Meu"]);
  });
});
