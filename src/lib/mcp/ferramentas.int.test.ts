import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Papel } from "@prisma/client";
import { dbTeste, limparBanco } from "@/test/db";
import { db as dbApp } from "@/lib/db";
import { invalidarCachePipelines } from "@/lib/fases/cache";
import { criarCard } from "@/lib/projetos/projetos";
import { executarFerramenta, FERRAMENTAS, SO_LEITURA } from "./ferramentas";
import type { UsuarioMcp } from "./oauth";

const db = dbTeste();

async function semear() {
  const vendas = await db.pipeline.create({
    data: {
      chave: "vendas",
      nome: "Vendas",
      ordem: 0,
      fases: {
        create: [
          { chave: "primeiro_contato", nome: "Primeiro Contato", ordem: 0 },
          { chave: "em_negociacao", nome: "Em negociação", ordem: 1 },
          { chave: "perdido", nome: "Perdido", ordem: 2, isTerminal: true, tipoTerminal: "PERDIDO", marco: "PERDIDO" },
        ],
      },
    },
    include: { fases: { orderBy: { ordem: "asc" } } },
  });
  await db.pipeline.create({ data: { chave: "projetos", nome: "Projetos", ordem: 1, fases: { create: [{ chave: "handoff", nome: "Handoff", ordem: 0, marco: "HANDOFF" }] } } });
  const pessoa = async (nome: string, papel: Papel): Promise<UsuarioMcp> => {
    const u = await db.usuario.create({ data: { nome, email: `${nome.toLowerCase()}@ij.test`, papel } });
    return { id: u.id, nome: u.nome, papel: u.papel };
  };
  return {
    vendas,
    visualizador: await pessoa("Vera", "VISUALIZADOR"),
    vendedora: await pessoa("Ana", "VENDEDOR"),
    gestor: await pessoa("Gil", "GESTOR"),
    projetos: await pessoa("Paula", "PROJETOS"),
  };
}

const fase = (p: { fases: { chave: string; id: string }[] }, chave: string) => p.fases.find((f) => f.chave === chave)!;
const texto = (r: { content: unknown[] }) => (r.content[0] as { text: string }).text;
const dados = (r: { content: unknown[] }) => JSON.parse(texto(r));

beforeEach(async () => {
  await limparBanco(["transicao_fase", "timeline", "oportunidade", "fase", "pipeline", "sessao", "usuario"]);
  invalidarCachePipelines();
});
afterEach(() => vi.restoreAllMocks());

describe("permissão por ferramenta: o MCP não faz nada que a tela não deixa", () => {
  it("VISUALIZADOR: toda ferramenta de escrita é recusada e nada é gravado", async () => {
    const { vendas, visualizador, vendedora } = await semear();
    const card = await criarCard({ pipelineId: vendas.id, faseId: fase(vendas, "primeiro_contato").id, titulo: "Padaria" }, vendedora);
    if (!card.ok) throw new Error("seed");
    const id = card.id;
    // Um caso por ferramenta de escrita: ferramenta nova sem caso aqui quebra o teste.
    const casos: Record<string, object> = {
      criar_projeto: { titulo: "Novo" },
      atualizar_projeto: { id, campos: { titulo: "Outro" } },
      definir_proxima_acao: { id, acao: "Ligar", data: "2026-11-10" },
      mover_projeto: { id, fase_id: fase(vendas, "em_negociacao").id },
      registrar_nota: { id, texto: "oi" },
    };
    expect(Object.keys(casos).sort()).toEqual(FERRAMENTAS.filter((f) => f.escrita).map((f) => f.nome).sort());
    const antes = { cards: await db.projeto.count(), timeline: await db.timeline.count() };
    for (const [nome, args] of Object.entries(casos)) {
      const r = await executarFerramenta(nome, args, visualizador);
      expect(r.isError, nome).toBe(true);
      expect(texto(r)).toBe(SO_LEITURA);
    }
    expect({ cards: await db.projeto.count(), timeline: await db.timeline.count() }).toEqual(antes);
    const c = await db.projeto.findUniqueOrThrow({ where: { id } });
    expect(c.titulo).toBe("Padaria");
    expect(c.faseId).toBe(fase(vendas, "primeiro_contato").id);
  });

  it("VISUALIZADOR lê (como na tela): listar_fases, listar_responsaveis, buscar_projetos, ler_projeto", async () => {
    const { vendas, visualizador, vendedora } = await semear();
    const card = await criarCard({ pipelineId: vendas.id, faseId: fase(vendas, "primeiro_contato").id, titulo: "Padaria" }, vendedora);
    if (!card.ok) throw new Error("seed");
    for (const [nome, args] of [["listar_fases", {}], ["listar_responsaveis", {}], ["buscar_projetos", {}], ["ler_projeto", { id: card.id }]] as const) {
      const r = await executarFerramenta(nome, args, visualizador);
      expect(r.isError, nome).toBeFalsy();
    }
    // Responsável nunca é VISUALIZADOR (QUEM_ATUA), como no seletor da tela.
    const pessoas = dados(await executarFerramenta("listar_responsaveis", {}, visualizador));
    expect(pessoas.responsaveis.map((p: { nome: string }) => p.nome)).toEqual(["Ana", "Gil", "Paula"]);
  });

  it("PROJETOS (mesmo nível de VENDEDOR na tela) escreve; papel lido a cada chamada", async () => {
    const { projetos } = await semear();
    const r = await executarFerramenta("criar_projeto", { titulo: "Do lado de projetos" }, projetos);
    expect(r.isError).toBeFalsy();
    // Rebaixado na Gestão → o token é o mesmo, mas o papel vem do banco a cada request (ver oauth.int.test).
    expect((await executarFerramenta("criar_projeto", { titulo: "x" }, { ...projetos, papel: "VISUALIZADOR" })).isError).toBe(true);
  });

  it("deleção definitiva, merge e configuração ficam só na tela: não há ferramenta para elas", () => {
    for (const f of FERRAMENTAS) expect(f.nome).not.toMatch(/exclu|delet|apag|lixeira|merge|mescl|config|fase_criar|usuario/);
  });
});

describe("escrita via MCP: mesma camada de serviço, Timeline marcada 'via MCP' com o autor", () => {
  it("criar → atualizar → próxima ação → nota → mover: tudo gravado como a tela, com via_mcp", async () => {
    const { vendas, vendedora } = await semear();
    const criado = dados(await executarFerramenta("criar_projeto", { titulo: "  Oficina   do Zé ", descricao: "Quer site" }, vendedora));
    const c = await db.projeto.findUniqueOrThrow({ where: { id: criado.id } });
    expect(c).toMatchObject({ titulo: "Oficina do Zé", responsavelId: vendedora.id, faseId: fase(vendas, "primeiro_contato").id, descricao: "Quer site" });

    expect(texto(await executarFerramenta("atualizar_projeto", { id: c.id, campos: { orcamentoPrevisto: "12.500,00", estado: "sp" } }, vendedora))).toContain("orcamentoPrevisto");
    await executarFerramenta("definir_proxima_acao", { id: c.id, acao: "Mandar proposta", data: "2026-11-10" }, vendedora);
    await executarFerramenta("registrar_nota", { id: c.id, texto: "Cliente animado" }, vendedora);
    const mov = dados(await executarFerramenta("mover_projeto", { id: c.id, fase_id: fase(vendas, "em_negociacao").id }, vendedora));
    expect(mov.mudou).toBe(true);

    const depois = await db.projeto.findUniqueOrThrow({ where: { id: c.id } });
    expect(depois.orcamentoPrevisto?.toFixed(2)).toBe("12500.00");
    expect(depois.estado).toBe("SP");
    expect(depois.proximaAcao).toBe("Mandar proposta");
    expect(depois.faseId).toBe(fase(vendas, "em_negociacao").id);

    const tl = await db.timeline.findMany({ where: { projetoId: c.id }, orderBy: [{ em: "asc" }, { id: "asc" }] });
    expect(tl.map((t) => t.tipo)).toEqual(["CRIACAO", "CAMPO_ALTERADO", "CAMPO_ALTERADO", "CAMPO_ALTERADO", "CAMPO_ALTERADO", "NOTA", "MOVIMENTACAO"]);
    expect(tl.every((t) => t.viaMcp && t.usuarioId === vendedora.id)).toBe(true);
    // A transição também é do autor (métricas de tempo por fase não mudam).
    expect(await db.transicaoFase.count({ where: { projetoId: c.id, usuarioId: vendedora.id } })).toBe(2);
  });

  it("a mesma ação pela tela (serviço direto, fora do MCP) não é marcada", async () => {
    const { vendas, vendedora } = await semear();
    const r = await criarCard({ pipelineId: vendas.id, faseId: fase(vendas, "primeiro_contato").id, titulo: "Pela tela" }, vendedora);
    if (!r.ok) throw new Error("seed");
    expect((await db.timeline.findFirstOrThrow({ where: { projetoId: r.id } })).viaMcp).toBe(false);
  });

  it("ganchos internos (perdido) também saem via MCP; regra do serviço volta como texto da tela", async () => {
    const { vendas, gestor } = await semear();
    const criado = dados(await executarFerramenta("criar_projeto", { titulo: "Loja" }, gestor));
    const semMotivo = await executarFerramenta("mover_projeto", { id: criado.id, fase_id: fase(vendas, "perdido").id }, gestor);
    expect(semMotivo.isError).toBe(true);
    expect(texto(semMotivo)).toMatch(/motivo|fechamento/i);
    const r = await executarFerramenta("mover_projeto", { id: criado.id, fase_id: fase(vendas, "perdido").id, motivo_perda: "preco" }, gestor);
    expect(r.isError).toBeFalsy();
    const tl = await db.timeline.findMany({ where: { projetoId: criado.id } });
    expect(tl.length).toBeGreaterThan(2);
    expect(tl.every((t) => t.viaMcp)).toBe(true);
  });

  it("erros de regra: mensagem útil para o Claude (campo inválido, card inexistente, argumento)", async () => {
    const { vendedora } = await semear();
    const criado = dados(await executarFerramenta("criar_projeto", { titulo: "Loja" }, vendedora));
    expect(texto(await executarFerramenta("atualizar_projeto", { id: criado.id, campos: { estado: "XX" } }, vendedora))).toBe("Estado: use a sigla da UF (ex.: SP).");
    expect(texto(await executarFerramenta("ler_projeto", { id: "nao-existe" }, vendedora))).toMatch(/Card não encontrado/);
    const semTitulo = await executarFerramenta("criar_projeto", {}, vendedora);
    expect(semTitulo.isError).toBe(true);
    expect(texto(semTitulo)).toMatch(/Argumento inválido em titulo/);
    expect(texto(await executarFerramenta("atualizar_projeto", { id: criado.id, campos: { senha: "x" } }, vendedora))).toMatch(/Argumento inválido/);
  });

  it("exceção inesperada: o Claude recebe a ref, o log tem a causa com a mesma ref", async () => {
    const { vendedora } = await semear();
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(dbApp, "$transaction").mockRejectedValue(new TypeError("banco caiu"));
    const r = await executarFerramenta("criar_projeto", { titulo: "Loja" }, vendedora);
    expect(r.isError).toBe(true);
    const ref = /ref: ([0-9a-f]{8})/.exec(texto(r))?.[1];
    expect(ref).toBeDefined();
    expect(String(log.mock.calls[0][0])).toMatch(new RegExp(`^\\[mcp\\.criar_projeto\\] ref=${ref} TypeError: banco caiu`));
  });
});

describe("leitura", () => {
  it("buscar_projetos filtra por quadro, fase, responsável ('eu') e texto sem acento", async () => {
    const { vendas, vendedora, gestor } = await semear();
    await executarFerramenta("criar_projeto", { titulo: "Padaria São João" }, vendedora);
    await executarFerramenta("criar_projeto", { titulo: "Oficina", fase_id: fase(vendas, "em_negociacao").id }, gestor);
    const busca = async (args: object) => dados(await executarFerramenta("buscar_projetos", args, vendedora)).projetos.map((p: { titulo: string }) => p.titulo);
    expect((await busca({})).sort()).toEqual(["Oficina", "Padaria São João"]);
    expect(await busca({ texto: "sao joao" })).toEqual(["Padaria São João"]);
    expect(await busca({ responsavel_id: "eu" })).toEqual(["Padaria São João"]);
    expect(await busca({ fase_id: fase(vendas, "em_negociacao").id })).toEqual(["Oficina"]);
    expect(await busca({ quadro: "projetos" })).toEqual([]);
  });

  it("ler_projeto traz fase, responsável, próxima ação e a Timeline recente com autor e via MCP", async () => {
    const { vendedora } = await semear();
    const criado = dados(await executarFerramenta("criar_projeto", { titulo: "Loja" }, vendedora));
    await executarFerramenta("registrar_nota", { id: criado.id, texto: "Primeira conversa" }, vendedora);
    const p = dados(await executarFerramenta("ler_projeto", { id: criado.id }, vendedora));
    expect(p).toMatchObject({ titulo: "Loja", quadro: "vendas", fase: { nome: "Primeiro Contato" }, responsavel: { nome: "Ana" } });
    expect(p.timeline[0]).toMatchObject({ tipo: "NOTA", autor: "Ana", viaMcp: true, dados: { texto: "Primeira conversa" } });
    expect(p.url).toMatch(new RegExp(`/projetos/${criado.id}$`));
  });
});
