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
import { excluirAnexoAction, excluirCardAction } from "./_lixeira/actions";
import { concluirPrazoAction, criarPrazoAction } from "./_calendario/actions";
import { definirProximaAction } from "./_semana/actions";
import CalendarioPage from "./calendario/page";
import { adicionarNotaAction, criarCardAction, editarCampoAction, moverCardAction } from "./kanban/actions";
import InicioPage from "./page";
import PainelPage from "./painel/page";
import CardPage from "./projetos/[id]/page";
import { MoverFase } from "./projetos/[id]/mover-fase";
import { CampoInline } from "./projetos/[id]/campo-inline";
import DiffPage from "./projetos/[id]/proposta/diff/page";
import PropostaPage from "./projetos/[id]/proposta/page";
import VersaoPage from "./projetos/[id]/proposta/versoes/[numero]/page";
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
    expect(campos.every((c) => c.props.somenteLeitura === !editaVendas)).toBe(true);
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
