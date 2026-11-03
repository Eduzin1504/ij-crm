import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Papel } from "@prisma/client";
import { dbTeste, limparBanco } from "@/test/db";
import { db as dbApp } from "@/lib/db";
import { invalidarCachePipelines } from "@/lib/fases/cache";
import { criarCard } from "@/lib/projetos/projetos";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { anexarArquivo } from "@/lib/anexos/anexos";
import { excluirCard } from "@/lib/lixeira/cards";
import { pdfDeTexto, PNG } from "@/test/fixtures/anexos";
import { criarProposta, salvarVersao } from "@/lib/propostas/propostas";
import { definirPropostaArquivoMock } from "@/lib/llm/provedores/mock";
import { ErroLlm } from "@/lib/llm/tipos";
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

let dirAnexos: string;
beforeEach(async () => {
  dirAnexos = await mkdtemp(path.join(tmpdir(), "mcp-anexos-"));
  process.env.ANEXOS_DIR = dirAnexos;
  await limparBanco(["log_llm", "alerta_operacional", "proposta_caneta", "proposta_versao", "proposta", "anexo", "prazo", "transicao_fase", "timeline", "oportunidade", "contato", "empresa", "fase", "pipeline", "sessao", "usuario"]);
  invalidarCachePipelines();
});
afterEach(async () => {
  vi.restoreAllMocks();
  delete process.env.ANEXOS_DIR;
  await rm(dirAnexos, { recursive: true, force: true });
});

describe("permissão por ferramenta: o MCP não faz nada que a tela não deixa", () => {
  it("VISUALIZADOR: toda ferramenta de escrita é recusada e nada é gravado", async () => {
    const { vendas, visualizador, vendedora } = await semear();
    const card = await criarCard({ pipelineId: vendas.id, faseId: fase(vendas, "primeiro_contato").id, titulo: "Padaria" }, vendedora);
    if (!card.ok) throw new Error("seed");
    const id = card.id;
    const empresa = await db.empresa.create({ data: { nome: "Padaria SA" } });
    const prazo = await db.prazo.create({ data: { titulo: "P", data: new Date("2026-11-20T12:00:00Z"), responsavelId: visualizador.id, criadoPorId: vendedora.id } });
    // Um caso por ferramenta de escrita: ferramenta nova sem caso aqui quebra o teste.
    const casos: Record<string, object> = {
      criar_projeto: { titulo: "Novo" },
      atualizar_projeto: { id, campos: { titulo: "Outro" } },
      definir_proxima_acao: { id, acao: "Ligar", data: "2026-11-10" },
      mover_projeto: { id, fase_id: fase(vendas, "em_negociacao").id },
      registrar_nota: { id, texto: "oi" },
      vincular_empresa_contato: { id, campo: "empresa", alvo_id: empresa.id },
      criar_prazo: { titulo: "Entregar", dia: "2026-11-20", projeto_id: id },
      concluir_prazo: { prazo_id: prazo.id },
      criar_proposta: { projeto_id: id },
      editar_proposta: { projeto_id: id, revisao: 0, markdown: "x" },
      salvar_versao_proposta: { projeto_id: id, revisao: 0 },
      passar_caneta_proposta: { projeto_id: id, para_id: vendedora.id },
      devolver_proposta: { projeto_id: id, revisao: 0, para_id: vendedora.id },
      concordar_proposta: { projeto_id: id, revisao: 0 },
      pegar_caneta_proposta: { projeto_id: id },
      reabrir_proposta: { projeto_id: id },
      marcar_proposta_inviavel: { projeto_id: id, motivo: "x" },
      preencher_proposta_de_anexo: { projeto_id: id, anexo_id: "a".repeat(32) },
    };
    expect(Object.keys(casos).sort()).toEqual(FERRAMENTAS.filter((f) => f.escrita).map((f) => f.nome).sort());
    const antes = { cards: await db.projeto.count(), timeline: await db.timeline.count() };
    for (const [nome, args] of Object.entries(casos)) {
      const r = await executarFerramenta(nome, args, visualizador);
      expect(r.isError, nome).toBe(true);
      expect(texto(r)).toBe(SO_LEITURA);
    }
    expect({ cards: await db.projeto.count(), timeline: await db.timeline.count() }).toEqual(antes);
    expect(await db.proposta.count()).toBe(0);
    expect(await db.prazo.count()).toBe(1);
    expect((await db.prazo.findUniqueOrThrow({ where: { id: prazo.id } })).feitoEm).toBeNull();
    const c = await db.projeto.findUniqueOrThrow({ where: { id } });
    expect(c.titulo).toBe("Padaria");
    expect(c.faseId).toBe(fase(vendas, "primeiro_contato").id);
  });

  it("VISUALIZADOR lê (como na tela): toda ferramenta de leitura, inclusive anexos", async () => {
    const { vendas, visualizador, vendedora } = await semear();
    const card = await criarCard({ pipelineId: vendas.id, faseId: fase(vendas, "primeiro_contato").id, titulo: "Padaria" }, vendedora);
    if (!card.ok) throw new Error("seed");
    const anexo = await anexarArquivo(card.id, { nome: "notas.md", bytes: new TextEncoder().encode("# Reunião") }, vendedora);
    if (!anexo.ok) throw new Error("seed anexo");
    await criarProposta(card.id, vendedora);
    await salvarVersao(card.id, { revisao: 0 }, vendedora);
    const leituras = [
      ["listar_fases", {}],
      ["listar_responsaveis", {}],
      ["buscar_projetos", {}],
      ["ler_projeto", { id: card.id }],
      ["buscar_empresas_contatos", { texto: "pad" }],
      ["listar_anexos", { projeto_id: card.id }],
      ["ler_anexo", { anexo_id: anexo.anexo.id }],
      ["consultar_painel_vendas", { indicador: "acompanhamento" }],
      ["ler_proposta", { projeto_id: card.id }],
      ["listar_versoes_proposta", { projeto_id: card.id }],
      ["ler_versao_proposta", { projeto_id: card.id, numero: 1 }],
      ["ver_diff_proposta", { projeto_id: card.id }],
    ] as const;
    // Um caso por ferramenta de leitura: ferramenta nova sem caso aqui quebra o teste.
    expect(leituras.map(([n]) => n).sort()).toEqual(FERRAMENTAS.filter((f) => !f.escrita).map((f) => f.nome).sort());
    for (const [nome, args] of leituras) {
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

  it("registrar_nota aceita nota do contato 1–5 opcional (GAB-85); inválida não grava; ler_projeto mostra", async () => {
    const { vendedora } = await semear();
    const criado = dados(await executarFerramenta("criar_projeto", { titulo: "Loja" }, vendedora));
    for (const nota of [0, 6, 2.5, "4"]) {
      const r = await executarFerramenta("registrar_nota", { id: criado.id, texto: "Reunião", nota }, vendedora);
      expect(r.isError, String(nota)).toBe(true);
      expect(texto(r)).toMatch(/nota/);
    }
    expect(await db.timeline.count({ where: { projetoId: criado.id, tipo: "NOTA" } })).toBe(0);
    expect((await executarFerramenta("registrar_nota", { id: criado.id, texto: "Reunião ótima", nota: 5 }, vendedora)).isError).toBeFalsy();
    expect((await executarFerramenta("registrar_nota", { id: criado.id, texto: "Sem nota" }, vendedora)).isError).toBeFalsy();
    const notas = await db.timeline.findMany({ where: { projetoId: criado.id, tipo: "NOTA" }, orderBy: [{ em: "asc" }, { id: "asc" }] });
    expect(notas.map((n) => [n.nota, n.viaMcp])).toEqual([
      [5, true],
      [null, true],
    ]);
    const p = dados(await executarFerramenta("ler_projeto", { id: criado.id }, vendedora));
    const lidas = (p.timeline as { tipo: string; nota?: number }[]).filter((t) => t.tipo === "NOTA");
    expect(lidas.map((t) => t.nota ?? null).sort()).toEqual([5, null].sort());
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

describe("empresa/contato e prazos (mesmos serviços da tela)", () => {
  it("busca e vincula empresa e contato; desvincula com vazio; tudo via MCP na Timeline", async () => {
    const { vendedora } = await semear();
    const emp = await db.empresa.create({ data: { nome: "Padaria São João" } });
    const ctt = await db.contato.create({ data: { nome: "Joana Lima", empresaId: emp.id } });
    const criado = dados(await executarFerramenta("criar_projeto", { titulo: "Site" }, vendedora));
    const achados = dados(await executarFerramenta("buscar_empresas_contatos", { texto: "pad" }, vendedora));
    expect(achados.empresas.map((e: { id: string }) => e.id)).toEqual([emp.id]);
    expect(dados(await executarFerramenta("buscar_empresas_contatos", { texto: "joa", tipo: "contato" }, vendedora)).contatos[0]).toMatchObject({ id: ctt.id, empresa: "Padaria São João" });

    expect(dados(await executarFerramenta("vincular_empresa_contato", { id: criado.id, campo: "empresa", alvo_id: emp.id }, vendedora)).mudou).toBe(true);
    await executarFerramenta("vincular_empresa_contato", { id: criado.id, campo: "contato", alvo_id: ctt.id }, vendedora);
    const lido = dados(await executarFerramenta("ler_projeto", { id: criado.id }, vendedora));
    expect(lido.empresa).toEqual({ id: emp.id, nome: "Padaria São João" });
    expect(lido.contato).toEqual({ id: ctt.id, nome: "Joana Lima" });
    await executarFerramenta("vincular_empresa_contato", { id: criado.id, campo: "contato", alvo_id: "" }, vendedora);
    expect((await db.projeto.findUniqueOrThrow({ where: { id: criado.id } })).contatoId).toBeNull();
    expect(texto(await executarFerramenta("vincular_empresa_contato", { id: criado.id, campo: "empresa", alvo_id: "nao-existe" }, vendedora))).toMatch(/Empresa não encontrada/);
    const vinculos = await db.timeline.findMany({ where: { projetoId: criado.id, tipo: "CAMPO_ALTERADO" } });
    expect(vinculos).toHaveLength(3);
    expect(vinculos.every((t) => t.viaMcp)).toBe(true);
  });

  it("prazo: cria do projeto (Timeline via MCP), aparece no ler_projeto, conclui; vendedor não cria prazo de outra pessoa", async () => {
    const { vendedora, gestor } = await semear();
    const criado = dados(await executarFerramenta("criar_projeto", { titulo: "Site" }, vendedora));
    const p = dados(await executarFerramenta("criar_prazo", { titulo: "Enviar proposta", dia: "2026-11-20", projeto_id: criado.id }, vendedora));
    const lido = dados(await executarFerramenta("ler_projeto", { id: criado.id }, vendedora));
    expect(lido.prazos).toEqual([expect.objectContaining({ id: p.id, titulo: "Enviar proposta", dia: "2026-11-20", responsavel: { id: vendedora.id, nome: "Ana" }, voceMexe: true })]);
    expect(dados(await executarFerramenta("concluir_prazo", { prazo_id: p.id }, vendedora)).feito).toBe(true);
    expect((await db.prazo.findUniqueOrThrow({ where: { id: p.id } })).feitoEm).not.toBeNull();
    const tl = await db.timeline.findMany({ where: { projetoId: criado.id, tipo: "PRAZO" } });
    expect(tl.map((t) => (t.payload as { evento: string }).evento).sort()).toEqual(["concluido", "criado"]);
    expect(tl.every((t) => t.viaMcp)).toBe(true);

    // Regra da tela (`podeMexerNoPrazo`): vendedor só de si; gestor de qualquer um.
    expect(texto(await executarFerramenta("criar_prazo", { titulo: "X", dia: "2026-11-21", responsavel_id: gestor.id }, vendedora))).toBe("Só o responsável pelo prazo ou a gestão podem mexer nele.");
    expect((await executarFerramenta("criar_prazo", { titulo: "X", dia: "2026-11-21", responsavel_id: vendedora.id }, gestor)).isError).toBeFalsy();
    expect(texto(await executarFerramenta("criar_prazo", { titulo: "X", dia: "31/12" }, vendedora))).toBe("Data inválida.");
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
    // timeline: 0 → nenhuma entrada (não a lista inteira).
    expect(dados(await executarFerramenta("ler_projeto", { id: criado.id, timeline: 0 }, vendedora)).timeline).toEqual([]);
    expect(dados(await executarFerramenta("ler_projeto", { id: criado.id, timeline: 1 }, vendedora)).timeline).toHaveLength(1);
  });
});

describe("anexos (GAB-84): mesmos serviços da tela", () => {
  it("listar_anexos e ler_anexo em trechos; escaneado vem sem texto; card na lixeira esconde tudo", async () => {
    const { vendas, vendedora, visualizador } = await semear();
    const card = await criarCard({ pipelineId: vendas.id, faseId: fase(vendas, "primeiro_contato").id, titulo: "Padaria" }, vendedora);
    if (!card.ok) throw new Error("seed");
    const pdf = await anexarArquivo(card.id, { nome: "Proposta.pdf", bytes: pdfDeTexto(["Proposta comercial para a padaria"]) }, vendedora);
    const foto = await anexarArquivo(card.id, { nome: "foto.png", bytes: PNG }, vendedora);
    if (!pdf.ok || !foto.ok) throw new Error("seed anexo");

    const lista = dados(await executarFerramenta("listar_anexos", { projeto_id: card.id }, visualizador));
    expect(lista.anexos).toHaveLength(2);
    expect(lista.anexos.find((a: { nome: string }) => a.nome === "Proposta.pdf")).toMatchObject({ tipo: "PDF", semTexto: false, caracteres: 33, autor: { nome: "Ana" } });

    const inteiro = dados(await executarFerramenta("ler_anexo", { anexo_id: pdf.anexo.id }, visualizador));
    expect(inteiro).toMatchObject({ texto: "Proposta comercial para a padaria", caracteres: 33, continua: false, projetoId: card.id });
    const trecho = dados(await executarFerramenta("ler_anexo", { anexo_id: pdf.anexo.id, inicio: 9, limite: 9 }, visualizador));
    expect(trecho).toMatchObject({ texto: "comercial", inicio: 9, fim: 18, continua: true });
    expect(dados(await executarFerramenta("ler_anexo", { anexo_id: foto.anexo.id }, visualizador))).toMatchObject({ semTexto: true, texto: null });

    await excluirCard(card.id, vendedora);
    const r = await executarFerramenta("ler_anexo", { anexo_id: pdf.anexo.id }, visualizador);
    expect(r.isError).toBe(true);
    expect(texto(r)).toMatch(/Anexo não encontrado/);
    expect((await executarFerramenta("listar_anexos", { projeto_id: card.id }, visualizador)).isError).toBe(true);
  });
});

describe("proposta via MCP (GAB-86): mesmas operações e permissões da tela", () => {
  async function comProjeto() {
    const s = await semear();
    const card = await criarCard({ pipelineId: s.vendas.id, faseId: fase(s.vendas, "primeiro_contato").id, titulo: "Site da Padaria" }, s.vendedora);
    if (!card.ok) throw new Error("seed");
    return { ...s, id: card.id };
  }

  it("criar → ler → editar texto e estruturado → salvar versão → listar/ler versões; Timeline via MCP", async () => {
    const { id, vendedora } = await comProjeto();
    expect(dados(await executarFerramenta("ler_proposta", { projeto_id: id }, vendedora))).toMatchObject({ existe: false, voceCria: true });
    expect(dados(await executarFerramenta("criar_proposta", { projeto_id: id }, vendedora))).toMatchObject({ criada: true, revisao: 0 });
    const lida = dados(await executarFerramenta("ler_proposta", { projeto_id: id }, vendedora));
    expect(lida).toMatchObject({ existe: true, status: "Rascunho", revisao: 0, voceEdita: true, voceEstaComACaneta: true, caneta: { com: "Ana", lado: "Vendas" }, versoes: [] });

    const ed = dados(await executarFerramenta("editar_proposta", { projeto_id: id, revisao: 0, markdown: "# Proposta\n\nTexto __forte__ <b>x</b>" }, vendedora));
    expect(ed).toMatchObject({ mudou: true, revisao: 1, markdownGravado: "# Proposta\n\nTexto **forte** \\<b>x\\</b>" });
    const est = dados(
      await executarFerramenta("editar_proposta", { projeto_id: id, revisao: 1, valor: "20.000,00", prazo_dias: "60", entregas: [{ titulo: "MVP", dia: "2026-12-15", valor: "8.000,00" }] }, vendedora),
    );
    expect(est.estruturado).toEqual({ valor: "20.000,00", prazo_dias: 60, escopo_resumo: null, entregas: [{ titulo: "MVP", dia: "2026-12-15", valor: "8.000,00" }] });
    // só o escopo: o resto do estruturado continua
    const so = dados(await executarFerramenta("editar_proposta", { projeto_id: id, revisao: 2, escopo_resumo: "Site institucional" }, vendedora));
    expect(so.estruturado).toMatchObject({ valor: "20.000,00", escopo_resumo: "Site institucional" });

    expect(dados(await executarFerramenta("salvar_versao_proposta", { projeto_id: id, revisao: 3, nota: "primeira do Claude" }, vendedora))).toMatchObject({ versao: 1 });
    expect(dados(await executarFerramenta("listar_versoes_proposta", { projeto_id: id }, vendedora)).versoes).toEqual([
      { numero: 1, nota: "primeira do Claude", autor: "Ana", em: expect.any(String), viaMcp: true },
    ]);
    const v1 = dados(await executarFerramenta("ler_versao_proposta", { projeto_id: id, numero: 1 }, vendedora));
    expect(v1).toMatchObject({ numero: 1, markdown: "# Proposta\n\nTexto **forte** \\<b>x\\</b>", estruturado: { valor: "20.000,00", prazo_dias: 60 } });
    expect((await executarFerramenta("ler_versao_proposta", { projeto_id: id, numero: 9 }, vendedora)).isError).toBe(true);

    const tl = await db.timeline.findMany({ where: { projetoId: id, tipo: "PROPOSTA" }, orderBy: { em: "asc" } });
    expect(tl.map((t) => (t.payload as { evento: string }).evento)).toEqual(["criada", "versao_salva"]);
    expect(tl.every((t) => t.viaMcp && t.usuarioId === vendedora.id)).toBe(true);
  });

  it("conflito: revisão velha não sobrescreve; a mensagem manda reler", async () => {
    const { id, vendedora } = await comProjeto();
    await executarFerramenta("criar_proposta", { projeto_id: id }, vendedora);
    await executarFerramenta("editar_proposta", { projeto_id: id, revisao: 0, markdown: "da tela" }, vendedora);
    const r = await executarFerramenta("editar_proposta", { projeto_id: id, revisao: 0, markdown: "do Claude" }, vendedora);
    expect(r.isError).toBe(true);
    expect(texto(r)).toMatch(/alterada em outro lugar.*revisão 1.*Use ler_proposta/);
    expect(dados(await executarFerramenta("ler_proposta", { projeto_id: id }, vendedora)).markdown).toBe("da tela");
    expect(texto(await executarFerramenta("salvar_versao_proposta", { projeto_id: id, revisao: 0 }, vendedora))).toMatch(/Use ler_proposta/);
  });

  it("só o dono da caneta edita: projetos, outro vendedor e gestor leem (mesma regra da tela)", async () => {
    const { id, vendedora, projetos, gestor } = await comProjeto();
    const outro = await db.usuario.create({ data: { nome: "Beto", email: "beto@ij.test", papel: "VENDEDOR" } });
    await executarFerramenta("criar_proposta", { projeto_id: id }, vendedora);
    for (const quem of [projetos, gestor, { id: outro.id, nome: outro.nome, papel: outro.papel }]) {
      expect(dados(await executarFerramenta("ler_proposta", { projeto_id: id }, quem))).toMatchObject({ existe: true, voceEdita: false, acoesQueVocePode: [] });
      const r = await executarFerramenta("editar_proposta", { projeto_id: id, revisao: 0, markdown: "x" }, quem);
      expect(texto(r)).toMatch(/não está com a caneta/);
      expect(texto(await executarFerramenta("salvar_versao_proposta", { projeto_id: id, revisao: 0 }, quem))).toMatch(/não está com a caneta/);
    }
  });

  it("estruturado inválido volta a mensagem da validação; sem nada para mudar é recusado", async () => {
    const { id, vendedora } = await comProjeto();
    await executarFerramenta("criar_proposta", { projeto_id: id }, vendedora);
    expect(texto(await executarFerramenta("editar_proposta", { projeto_id: id, revisao: 0, entregas: [{ titulo: "A", dia: "2026-02-31" }] }, vendedora))).toBe(
      "Entrega 1: data inválida (use AAAA-MM-DD).",
    );
    expect(texto(await executarFerramenta("editar_proposta", { projeto_id: id, revisao: 0, valor: "-1" }, vendedora))).toMatch(/Valor inválido/);
    expect(texto(await executarFerramenta("editar_proposta", { projeto_id: id, revisao: 0 }, vendedora))).toMatch(/Informe o markdown/);
    expect(texto(await executarFerramenta("criar_proposta", { projeto_id: id }, vendedora))).toMatch(/já tem uma proposta/);
  });
});

describe("caneta via MCP (GAB-87): mesmas regras e permissões da tela", () => {
  async function comProposta() {
    const s = await semear();
    const card = await criarCard({ pipelineId: s.vendas.id, faseId: fase(s.vendas, "primeiro_contato").id, titulo: "Site da Padaria" }, s.vendedora);
    if (!card.ok) throw new Error("seed");
    await executarFerramenta("criar_proposta", { projeto_id: card.id }, s.vendedora);
    return { ...s, id: card.id };
  }

  it("devolver → editar do outro lado → devolver → ver diff → concordar: pronta para envio, Timeline via MCP", async () => {
    const { id, vendedora, projetos } = await comProposta();
    const lida = dados(await executarFerramenta("ler_proposta", { projeto_id: id }, vendedora));
    expect(lida.acoesQueVocePode).toEqual(["passar_caneta_proposta", "devolver_proposta"]);
    expect(lida.pessoasParaCaneta).toEqual(expect.arrayContaining([{ id: projetos.id, nome: "Paula", lado: "Projetos" }]));

    await executarFerramenta("editar_proposta", { projeto_id: id, revisao: 0, markdown: "Site com 5 páginas." }, vendedora);
    expect(dados(await executarFerramenta("devolver_proposta", { projeto_id: id, revisao: 1, para_id: projetos.id, nota: "avaliem" }, vendedora))).toMatchObject({
      status: "Em análise",
      canetaCom: "Paula",
      versao: 1,
    });
    // vendedora não edita mais pelo Claude; Paula sim
    // devolver passou a caneta (rev 1 → 2): toda passagem incrementa a revisão
    expect(texto(await executarFerramenta("editar_proposta", { projeto_id: id, revisao: 2, markdown: "x" }, vendedora))).toMatch(/não está com a caneta/);
    expect(dados(await executarFerramenta("ler_proposta", { projeto_id: id }, projetos)).acoesQueVocePode).toEqual(["passar_caneta_proposta", "devolver_proposta", "concordar_proposta", "marcar_proposta_inviavel"]);
    expect(dados(await executarFerramenta("ler_proposta", { projeto_id: id }, projetos)).revisao).toBe(2);
    await executarFerramenta("editar_proposta", { projeto_id: id, revisao: 2, markdown: "Site com 8 páginas." }, projetos);
    expect(dados(await executarFerramenta("devolver_proposta", { projeto_id: id, revisao: 3, para_id: vendedora.id }, projetos))).toMatchObject({ status: "Em ajuste", canetaCom: "Ana", versao: 2 });

    const diff = dados(await executarFerramenta("ver_diff_proposta", { projeto_id: id }, vendedora));
    expect(diff).toMatchObject({ de: { versao: 1, lado: "Vendas" }, para: { versao: 2, lado: "Projetos" }, texto: "- Site com 5 páginas.\n+ Site com 8 páginas." });
    expect((await executarFerramenta("ver_diff_proposta", { projeto_id: id, de: 7 }, vendedora)).isError).toBe(true);

    // concordar com revisão velha → conflito; com a atual → pronta
    expect(texto(await executarFerramenta("concordar_proposta", { projeto_id: id, revisao: 3 }, vendedora))).toMatch(/Use ler_proposta/);
    expect(dados(await executarFerramenta("concordar_proposta", { projeto_id: id, revisao: 4 }, vendedora))).toMatchObject({ status: "Pronta para envio", canetaCom: "Ana" });
    expect(dados(await executarFerramenta("ler_proposta", { projeto_id: id }, vendedora))).toMatchObject({ status: "Pronta para envio", voceEdita: false, acoesQueVocePode: ["passar_caneta_proposta", "reabrir_proposta"] });

    const tl = await db.timeline.findMany({ where: { projetoId: id, tipo: "PROPOSTA" }, orderBy: { em: "asc" } });
    expect(tl.map((t) => (t.payload as { evento: string }).evento)).toEqual(["criada", "versao_salva", "devolvida", "versao_salva", "devolvida", "concordou"]);
    expect(tl.every((t) => t.viaMcp)).toBe(true);
  });

  it("recusas com o mesmo texto da tela: concordar com a própria versão, passar ao outro lado, gestor/GP de fora", async () => {
    const { id, vendedora, projetos, gestor } = await comProposta();
    await executarFerramenta("salvar_versao_proposta", { projeto_id: id, revisao: 0 }, vendedora);
    expect(texto(await executarFerramenta("concordar_proposta", { projeto_id: id, revisao: 0 }, vendedora))).toMatch(/Só dá para concordar com uma versão que veio do outro lado/);
    expect(texto(await executarFerramenta("passar_caneta_proposta", { projeto_id: id, para_id: projetos.id }, vendedora))).toMatch(/MESMO lado/);
    expect(texto(await executarFerramenta("pegar_caneta_proposta", { projeto_id: id }, gestor))).toMatch(/Só o GP do lado/);
    expect(texto(await executarFerramenta("marcar_proposta_inviavel", { projeto_id: id, motivo: "caro" }, vendedora))).toMatch(/Só o GP de projetos/);
    expect(texto(await executarFerramenta("reabrir_proposta", { projeto_id: id }, vendedora))).toMatch(/Só dá para reabrir/);
  });

  it("inviável pelo Claude de quem está com a caneta em projetos: Projeto em Perdido, via MCP", async () => {
    const { id, vendas, vendedora, projetos } = await comProposta();
    await executarFerramenta("devolver_proposta", { projeto_id: id, revisao: 0, para_id: projetos.id }, vendedora);
    expect(dados(await executarFerramenta("marcar_proposta_inviavel", { projeto_id: id, motivo: "Escopo fora do que entregamos" }, projetos))).toMatchObject({ status: "Inviável", canetaCom: null });
    const p = await db.projeto.findUniqueOrThrow({ where: { id } });
    expect(p).toMatchObject({ faseId: fase(vendas, "perdido").id, motivoPerda: "Outro: Proposta inviável: Escopo fora do que entregamos" });
    expect(await db.timeline.count({ where: { projetoId: id, tipo: "MOVIMENTACAO", viaMcp: true } })).toBe(1);
describe("preencher_proposta_de_anexo (GAB-90): mesma camada e permissão da tela", () => {
  const LEITURA = {
    valor_total: { valor: "20000.00", confianca: 0.95, trecho: "Total: R$ 20.000,00" },
    prazo_dias: { valor: null, confianca: 0, trecho: null },
    escopo_resumo: { valor: "Site institucional", confianca: 0.9, trecho: null },
    entregas: { itens: [{ titulo: "MVP", dia: "2026-12-15", valor: null, trecho: "MVP: 15/12/2026" }], confianca: 0.9 },
  };
  let provedorAntes: string | undefined;
  beforeEach(() => {
    provedorAntes = process.env.LLM_PROVEDOR;
    process.env.LLM_PROVEDOR = "mock"; // nunca API paga nos testes
  });
  afterEach(() => {
    definirPropostaArquivoMock(null);
    if (provedorAntes === undefined) delete process.env.LLM_PROVEDOR;
    else process.env.LLM_PROVEDOR = provedorAntes;
  });

  async function comAnexo() {
    const s = await semear();
    const card = await criarCard({ pipelineId: s.vendas.id, faseId: fase(s.vendas, "primeiro_contato").id, titulo: "Site da Padaria" }, s.vendedora);
    if (!card.ok) throw new Error("seed");
    const anexo = await anexarArquivo(card.id, { nome: "proposta.md", bytes: new TextEncoder().encode("# Proposta\n\nTotal: R$ 20.000,00") }, s.vendedora);
    if (!anexo.ok) throw new Error("seed anexo");
    await criarProposta(card.id, s.vendedora);
    vi.spyOn(console, "info").mockImplementation(() => {});
    return { ...s, id: card.id, anexoId: anexo.anexo.id };
  }

  it("sugere sem gravar; aplicar grava pelo rascunho (via MCP) e só com a revisão atual", async () => {
    const { id, anexoId, vendedora } = await comAnexo();
    definirPropostaArquivoMock(() => LEITURA);
    const s = dados(await executarFerramenta("preencher_proposta_de_anexo", { projeto_id: id, anexo_id: anexoId }, vendedora));
    expect(s).toMatchObject({
      aplicado: false,
      markdown: "# Proposta\n\nTotal: R$ 20.000,00",
      campos: { valor: "20.000,00", prazo_dias: null, escopo_resumo: "Site institucional", entregas: [{ titulo: "MVP", dia: "2026-12-15" }] },
      revisar: [{ campo: "Prazo (dias)", motivo: "não encontrado no arquivo" }],
    });
    expect((await db.proposta.findFirstOrThrow()).revisao).toBe(0);

    expect(texto(await executarFerramenta("preencher_proposta_de_anexo", { projeto_id: id, anexo_id: anexoId, aplicar: true }, vendedora))).toMatch(/informe a revisao/);
    await executarFerramenta("editar_proposta", { projeto_id: id, revisao: 0, markdown: "outra pessoa mexeu" }, vendedora);
    const velho = await executarFerramenta("preencher_proposta_de_anexo", { projeto_id: id, anexo_id: anexoId, aplicar: true, revisao: 0 }, vendedora);
    expect(velho.isError).toBe(true);
    expect(texto(velho)).toMatch(/alterada em outro lugar[\s\S]*Use ler_proposta/);
    expect((await db.proposta.findFirstOrThrow()).conteudoMd).toBe("outra pessoa mexeu");
    // revisão velha recusada ANTES da IA: só a sugestão inicial gastou até aqui
    expect(await db.logLlm.count()).toBe(1);

    const ap = dados(await executarFerramenta("preencher_proposta_de_anexo", { projeto_id: id, anexo_id: anexoId, aplicar: true, revisao: 1 }, vendedora));
    expect(ap).toMatchObject({ aplicado: true, revisao: 2 });
    const p = await db.proposta.findFirstOrThrow();
    expect(p).toMatchObject({ conteudoMd: "# Proposta\n\nTotal: R$ 20.000,00", rascunhoViaMcp: true, estruturado: { valor: "20000.00", prazoDias: null } });
    expect(await db.logLlm.count()).toBe(2);
  });

  it("quem não edita a proposta (projetos, outro vendedor) é recusado antes de gastar com a IA", async () => {
    const { id, anexoId, projetos } = await comAnexo();
    const outro = await db.usuario.create({ data: { nome: "Beto", email: "beto@ij.test", papel: "VENDEDOR" } });
    const chamado = vi.fn(() => LEITURA);
    definirPropostaArquivoMock(chamado);
    for (const quem of [projetos, { id: outro.id, nome: outro.nome, papel: outro.papel }]) {
      expect(texto(await executarFerramenta("preencher_proposta_de_anexo", { projeto_id: id, anexo_id: anexoId }, quem))).toMatch(/Só quem é de vendas e responsável/);
    }
    expect(chamado).not.toHaveBeenCalled();
  });

  it("falha da IA: erro com ref (a mesma do log do servidor) e o rascunho intacto", async () => {
    const { id, anexoId, vendedora } = await comAnexo();
    definirPropostaArquivoMock(() => {
      throw new ErroLlm("TIMEOUT");
    });
    const erro = vi.spyOn(console, "error").mockImplementation(() => {});
    const r = await executarFerramenta("preencher_proposta_de_anexo", { projeto_id: id, anexo_id: anexoId, aplicar: true, revisao: 0 }, vendedora);
    expect(r.isError).toBe(true);
    const ref = /\(ref: ([0-9a-f]{8})\)/.exec(texto(r))?.[1];
    expect(texto(r)).toMatch(/demorou demais.*O rascunho não foi alterado/);
    expect(erro.mock.calls.some((c) => String(c[0]).includes(`ref=${ref}`))).toBe(true);
    expect(await db.proposta.findFirstOrThrow()).toMatchObject({ revisao: 0 });
  });
});
