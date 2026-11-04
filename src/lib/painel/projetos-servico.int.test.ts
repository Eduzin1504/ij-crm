// @vitest-environment node
/**
 * Painel de projetos (GAB-96) contra o banco: quem conta, cancelada fora das contas, fase terminal como
 * registro, GP que vale, recorte da caneta por papel, e os mesmos números na tela (serviço) e no MCP.
 */
import { beforeEach, describe, expect, it } from "vitest";
import type { Area, Cargo, Papel, StatusProposta } from "@prisma/client";
import { invalidarCachePipelines } from "@/lib/fases/cache";
import { executarFerramenta, FERRAMENTAS } from "@/lib/mcp/ferramentas";
import { LIMITE_LISTA_MCP } from "@/lib/mcp/painel-projetos";
import { resolverPeriodo } from "@/lib/ranking/periodo";
import { CONFIG_RANKING_PADRAO } from "@/lib/ranking/config";
import { salvarConfigRanking } from "@/lib/ranking/servico";
import { dbTeste, limparBanco } from "@/test/db";
import { carregarCanetaPara, carregarExecucaoProjetos, pessoaDoFiltro } from "./projetos-servico";

const db = dbTeste();
const dia = (d: string) => new Date(`${d}T00:00:00Z`);
const sp = (iso: string) => new Date(`${iso}-03:00`);
// Quarta, 11/11/2026, 12h em São Paulo. As ferramentas usam o relógio real: lá, datas relativas a hoje.
const AGORA = sp("2026-11-11T12:00:00");
const NOVEMBRO = resolverPeriodo("mes", "2026-11-05", AGORA);

async function pessoa(nome: string, papel: Papel, area: Area | null = null, cargos: Cargo[] = [], ativo = true) {
  const u = await db.usuario.create({ data: { nome, email: `${nome.toLowerCase().replace(/\s/g, ".")}@ij.test`, papel, area, cargos, ativo } });
  return { id: u.id, nome: u.nome, papel: u.papel, area: u.area, cargos: u.cargos };
}

async function semear() {
  await limparBanco(["configuracao", "proposta_caneta", "proposta", "projeto_handoff", "transicao_fase", "timeline", "oportunidade", "fase", "pipeline", "usuario"]);
  invalidarCachePipelines();
  const vendas = await db.pipeline.create({
    data: {
      chave: "vendas",
      nome: "Vendas",
      ordem: 0,
      fases: {
        create: [
          { chave: "contato", nome: "Contato", ordem: 0 },
          { chave: "perdido_v", nome: "Perdido V", ordem: 1, isTerminal: true, tipoTerminal: "PERDIDO", marco: "PERDIDO" },
        ],
      },
    },
    include: { fases: true },
  });
  const projetos = await db.pipeline.create({
    data: {
      chave: "projetos",
      nome: "Projetos",
      ordem: 1,
      fases: {
        create: [
          { chave: "handoff", nome: "Handoff", ordem: 0, marco: "HANDOFF" },
          { chave: "execucao", nome: "Em execução", ordem: 1, marco: "EXECUCAO" },
          { chave: "testes", nome: "Testes", ordem: 2 },
          { chave: "finalizado", nome: "Finalizado", ordem: 3, isTerminal: true, tipoTerminal: "GANHO", marco: "FINALIZADO" },
          { chave: "perdido", nome: "Perdido", ordem: 4, isTerminal: true, tipoTerminal: "PERDIDO" },
        ],
      },
    },
    include: { fases: true },
  });
  const fase = (chave: string) => [...vendas.fases, ...projetos.fases].find((f) => f.chave === chave)!;
  const p = {
    gil: await pessoa("Gil", "PROJETOS", "PROJETOS"),
    rui: await pessoa("Rui", "PROJETOS", "PROJETOS"),
    saiu: await pessoa("Saiu", "PROJETOS", "PROJETOS", [], false),
    vera: await pessoa("Vera", "VENDEDOR", "VENDAS"),
    outra: await pessoa("Outra", "VENDEDOR", "VENDAS"),
    gp: await pessoa("Gepe", "VENDEDOR", "VENDAS", ["GP"]),
    gestor: await pessoa("Gestor", "GESTOR", "PROJETOS"),
    visual: await pessoa("Visual", "VISUALIZADOR"),
  };
  const card = (titulo: string, chave: string, responsavelId: string, extra: { execucaoDesde?: Date | null; deletadoEm?: Date; absorvidoPorId?: string; faseDesde?: Date; gpId?: string } = {}) => {
    const f = fase(chave);
    const { gpId, execucaoDesde, ...resto } = extra;
    return db.projeto.create({
      data: {
        titulo,
        pipelineId: f.pipelineId,
        faseId: f.id,
        responsavelId,
        criadoVia: "UI",
        execucaoDesde: execucaoDesde === undefined ? sp("2026-10-01T12:00:00") : execucaoDesde,
        ...resto,
        ...(gpId ? { handoff: { create: { gpProjetoId: gpId } } } : {}),
      },
    });
  };
  const entrega = (projetoId: string, ordem: number, previsto: string, extra: { atual?: string; feita?: string; cancelada?: boolean } = {}) =>
    db.projetoEntrega.create({
      data: {
        projetoId,
        ordem,
        titulo: `Entrega ${ordem}`,
        valor: "1000.00",
        previstoOriginal: dia(previsto),
        previstoAtual: dia(extra.atual ?? previsto),
        realizadoEm: extra.feita ? dia(extra.feita) : null,
        origem: "MANUAL",
        ...(extra.cancelada ? { canceladaEm: sp("2026-11-02T12:00:00"), motivoCancelamento: "saiu do escopo" } : {}),
      },
    });
  return { fase, p, card, entrega };
}

type S = Awaited<ReturnType<typeof semear>>;
let s: S;

beforeEach(async () => {
  s = await semear();
});

const ajuste = (entregaId: string, porId: string) => db.entregaAjuste.create({ data: { entregaId, de: dia("2026-11-08"), para: dia("2026-11-25"), motivo: "cliente pediu", porId } });

describe("execução: o que conta", () => {
  it("previstas × feitas, atraso, ajustes e último check-in; entrega cancelada e os ajustes dela ficam de fora", async () => {
    const c = await s.card("Site", "execucao", s.p.gil.id, { gpId: s.p.gil.id });
    await s.entrega(c.id, 0, "2026-11-03", { feita: "2026-11-05" }); // 2 dias
    await s.entrega(c.id, 1, "2026-11-09"); // vencida: 2 dias
    const empurrada = await s.entrega(c.id, 2, "2026-11-08", { atual: "2026-11-25" }); // 17 dias
    const cancelada = await s.entrega(c.id, 3, "2026-10-01", { atual: "2026-10-20", cancelada: true });
    await ajuste(empurrada.id, s.p.gil.id);
    await ajuste(cancelada.id, s.p.gil.id);
    await ajuste(cancelada.id, s.p.gil.id);
    await db.projetoCheckin.create({ data: { projetoId: c.id, status: "VERMELHO", motivo: "travou", semana: dia("2026-11-02"), porId: s.p.gil.id, em: sp("2026-11-03T12:00:00") } });
    await db.projetoCheckin.create({ data: { projetoId: c.id, status: "AMARELO", motivo: "andando", semana: dia("2026-11-02"), porId: s.p.gil.id, em: sp("2026-11-04T12:00:00") } });
    await db.lembreteCheckin.create({ data: { projetoId: c.id, semana: dia("2026-10-26") } });

    const e = await carregarExecucaoProjetos({ periodo: NOVEMBRO, gpId: null }, AGORA);
    expect(e.projetos).toHaveLength(1);
    expect(e.projetos[0]).toMatchObject({
      semPrevisto: false,
      totalEntregas: 3,
      feitas: 1,
      previstasNoPeriodo: 3,
      feitasNoPeriodo: 1,
      atrasadas: 1,
      atrasoDias: 21,
      ajustes: 1,
      semCheckinNaSemana: true,
      semanasCobradas: 1,
      ultimoCheckin: { status: "AMARELO", motivo: "andando", semana: "2026-11-02" },
    });
    expect(e.alertas.amarelos.map((x) => x.id)).toEqual([c.id]);
    expect(e.alertas.vermelhos).toEqual([]);
  });

  it("não lê valor nem versão da proposta", async () => {
    const c = await s.card("Site", "execucao", s.p.gil.id);
    await s.entrega(c.id, 0, "2026-11-03");
    expect(JSON.stringify(await carregarExecucaoProjetos({ periodo: NOVEMBRO, gpId: null }, AGORA))).not.toMatch(/valor|1000|propostaVersao/i);
  });

  it("migrado sem cronograma: 'sem previsto', sem atraso e sem cobrança de check-in; tudo cancelado também é 'sem previsto'", async () => {
    const migrado = await s.card("Migrado", "execucao", s.p.gil.id, { execucaoDesde: null });
    const cancelado = await s.card("Tudo cancelado", "execucao", s.p.gil.id);
    await s.entrega(cancelado.id, 0, "2026-10-01", { cancelada: true });
    const e = await carregarExecucaoProjetos({ periodo: NOVEMBRO, gpId: null }, AGORA);
    expect(e.totais).toMatchObject({ emExecucao: 2, semPrevisto: 2, comAtraso: 0, atrasoDias: 0 });
    const m = e.projetos.find((x) => x.id === migrado.id)!;
    expect(m).toMatchObject({ semPrevisto: true, atrasadas: 0, ultimoCheckin: null, semCheckinNaSemana: false });
    expect(e.atrasados).toEqual([]);
  });

  it("migrado com check-in antigo passa a ser cobrado, pela mesma regra do lembrete", async () => {
    const m = await s.card("Migrado", "execucao", s.p.gil.id, { execucaoDesde: null });
    await db.projetoCheckin.create({ data: { projetoId: m.id, status: "VERDE", motivo: "ok", semana: dia("2026-10-26"), porId: s.p.gil.id, em: sp("2026-10-27T12:00:00") } });
    const e = await carregarExecucaoProjetos({ periodo: NOVEMBRO, gpId: null }, AGORA);
    expect(e.alertas.semCheckin.map((x) => x.id)).toEqual([m.id]);
  });

  it("subfase depois de Execução conta; Handoff, lixeira e casca absorvida não; Finalizado e Perdido são registro", async () => {
    const execucao = await s.card("Na execução", "execucao", s.p.gil.id);
    const subfase = await s.card("Na subfase", "testes", s.p.gil.id);
    const handoff = await s.card("Em handoff", "handoff", s.p.gil.id);
    await s.entrega(handoff.id, 0, "2026-11-01");
    await s.card("Na lixeira", "execucao", s.p.gil.id, { deletadoEm: sp("2026-11-01T12:00:00") });
    await s.card("Absorvida", "execucao", s.p.gil.id, { absorvidoPorId: execucao.id });
    const emVendas = await s.card("Em vendas", "contato", s.p.vera.id);
    await s.entrega(emVendas.id, 0, "2026-11-01");

    const perdido = await s.card("Perdido", "perdido", s.p.gil.id, { faseDesde: sp("2026-11-05T12:00:00") });
    await s.entrega(perdido.id, 0, "2026-10-01");
    await s.entrega(perdido.id, 1, "2026-10-02", { feita: "2026-10-02" });
    await db.projetoCheckin.create({ data: { projetoId: perdido.id, status: "VERMELHO", motivo: "acabou", semana: dia("2026-11-02"), porId: s.p.gil.id, em: sp("2026-11-03T12:00:00") } });
    const finalizado = await s.card("Finalizado", "finalizado", s.p.gil.id, { faseDesde: sp("2026-11-04T12:00:00") });
    await s.card("Perdido antigo", "perdido", s.p.gil.id, { faseDesde: sp("2026-09-05T12:00:00") });

    const e = await carregarExecucaoProjetos({ periodo: NOVEMBRO, gpId: null }, AGORA);
    expect(e.projetos.map((x) => x.id).sort()).toEqual([execucao.id, subfase.id].sort());
    expect(e.totais).toMatchObject({ emExecucao: 2, comAtraso: 0, atrasoDias: 0, vermelhos: 0, previstasNoPeriodo: 0 });
    expect(e.alertas.vermelhos).toEqual([]);
    expect(e.encerrados.map((x) => [x.id, x.tipo, x.feitas, x.totalEntregas])).toEqual([
      [perdido.id, "PERDIDO", 1, 2],
      [finalizado.id, "FINALIZADO", 0, 0],
    ]);
  });

  it("mês passado: encerrado depois, com entrega naquele mês, entra em previstas e feitas e na tabela à parte", async () => {
    const OUTUBRO = resolverPeriodo("mes", "2026-10-15", AGORA);
    const fechado = await s.card("Fechou em novembro", "finalizado", s.p.gil.id, { faseDesde: sp("2026-11-05T12:00:00") });
    await s.entrega(fechado.id, 0, "2026-10-05", { feita: "2026-10-06" });
    await s.entrega(fechado.id, 1, "2026-10-10", { cancelada: true });
    const perdido = await s.card("Caiu em novembro", "perdido", s.p.gil.id, { faseDesde: sp("2026-11-06T12:00:00") });
    await s.entrega(perdido.id, 0, "2026-10-20");
    await s.card("Sem nada em outubro", "finalizado", s.p.gil.id, { faseDesde: sp("2026-11-07T12:00:00") });
    const e = await carregarExecucaoProjetos({ periodo: OUTUBRO, gpId: null }, AGORA);
    expect(e.totais).toMatchObject({ emExecucao: 0, previstasNoPeriodo: 2, feitasNoPeriodo: 1, previstasEncerrados: 2, feitasEncerrados: 1, atrasadas: 0, atrasoDias: 0 });
    expect(e.encerrados.map((x) => [x.titulo, x.previstasNoPeriodo, x.feitasNoPeriodo])).toEqual([
      ["Caiu em novembro", 1, 0],
      ["Fechou em novembro", 1, 1],
    ]);
  });

  it("Perdido antes de começar (de Handoff, sem execução nem entrega) fica fora de Encerrados; quem teve algo de execução fica", async () => {
    const quando = { faseDesde: sp("2026-11-05T12:00:00") };
    await s.card("Caiu no handoff", "perdido", s.p.gil.id, { execucaoDesde: null, ...quando });
    const comExecucao = await s.card("Caiu executando", "perdido", s.p.gil.id, quando);
    const migrado = await s.card("Migrado com check-in", "perdido", s.p.gil.id, { execucaoDesde: null, ...quando });
    await db.projetoCheckin.create({ data: { projetoId: migrado.id, status: "VERDE", motivo: "ok", semana: dia("2026-10-26"), porId: s.p.gil.id, em: sp("2026-10-27T12:00:00") } });
    const finalizado = await s.card("Finalizado isento", "finalizado", s.p.gil.id, { execucaoDesde: null, ...quando });
    const e = await carregarExecucaoProjetos({ periodo: NOVEMBRO, gpId: null }, AGORA);
    expect(e.encerrados.map((x) => x.id).sort()).toEqual([comExecucao.id, migrado.id, finalizado.id].sort());
  });

  it("id com \\0 no filtro é pessoa desconhecida, sem erro do Postgres", async () => {
    expect(await pessoaDoFiltro("a\0b")).toBeNull();
  });

  it("filtro por GP: o designado que vale, ou o responsável quando o designado saiu", async () => {
    const doGil = await s.card("Do Gil", "execucao", s.p.rui.id, { gpId: s.p.gil.id });
    const gpSaiu = await s.card("GP saiu", "execucao", s.p.rui.id, { gpId: s.p.saiu.id });
    const e = await carregarExecucaoProjetos({ periodo: NOVEMBRO, gpId: s.p.rui.id }, AGORA);
    expect(e.projetos.map((x) => x.id)).toEqual([gpSaiu.id]);
    expect(e.gps.map((g) => [g.nome, g.projetos])).toEqual([
      ["Gil", 1],
      ["Rui", 1],
    ]);
    const doGilVisao = await carregarExecucaoProjetos({ periodo: NOVEMBRO, gpId: s.p.gil.id }, AGORA);
    expect(doGilVisao.projetos.map((x) => x.id)).toEqual([doGil.id]);
  });
});

describe("tempo com a caneta: quem vê o quê", () => {
  async function proposta(titulo: string, dono: { id: string }, status: StatusProposta = "EM_AJUSTE", chave = "contato", periodos: { usuarioId: string; lado: Area; inicio: Date; fim?: Date }[] = [{ usuarioId: dono.id, lado: "VENDAS", inicio: sp("2026-11-09T12:00:00") }]) {
    const c = await s.card(titulo, chave, dono.id);
    const aberto = periodos.find((x) => !x.fim);
    return db.proposta.create({ data: { projetoId: c.id, status, criadoPorId: dono.id, canetaComId: aberto?.usuarioId ?? null, canetaLado: "VENDAS", periodosCaneta: { create: periodos } } });
  }

  async function cenario() {
    await proposta("Da Vera", s.p.vera);
    await proposta("Da Outra", s.p.outra, "EM_AJUSTE", "contato", [{ usuarioId: s.p.outra.id, lado: "VENDAS", inicio: sp("2026-11-07T12:00:00") }]);
  }

  it("visualizador não recebe nada, mesmo com o painel completo aberto a ele", async () => {
    await cenario();
    expect(await carregarCanetaPara(s.p.visual, { periodo: NOVEMBRO, gpId: null }, AGORA)).toBeNull();
  });

  it("GP, gestor: todas as propostas", async () => {
    await cenario();
    for (const quem of [s.p.gp, s.p.gestor]) {
      const v = await carregarCanetaPara(quem, { periodo: NOVEMBRO, gpId: null }, AGORA);
      expect(v?.visao).toBe("todas");
      expect(v?.caneta.porPessoa.map((l) => [l.usuario.nome, l.paradas, l.maiorDias])).toEqual([
        ["Outra", 1, 4],
        ["Vera", 1, 2],
      ]);
    }
  });

  it("membro: só as propostas em que está escalado, sem os títulos nem o tempo das outras", async () => {
    await cenario();
    const v = await carregarCanetaPara(s.p.vera, { periodo: NOVEMBRO, gpId: null }, AGORA);
    expect(v?.visao).toBe("escaladas");
    expect(v?.caneta.porPessoa.map((l) => l.usuario.nome)).toEqual(["Vera"]);
    expect(JSON.stringify(v)).not.toContain("Da Outra");
    // Ninguém de fora: membro de projetos que não está em nenhuma proposta não vê nada.
    expect((await carregarCanetaPara(s.p.rui, { periodo: NOVEMBRO, gpId: null }, AGORA))?.caneta).toMatchObject({ paradas: 0, porPessoa: [], maisParadas: [] });
  });

  it("ranking oculto: quem não vê todas fica só com as próprias linhas, mesmo em proposta em que está escalado", async () => {
    await proposta("Passou pelas duas", s.p.vera, "EM_AJUSTE", "contato", [
      { usuarioId: s.p.vera.id, lado: "VENDAS", inicio: sp("2026-11-02T12:00:00"), fim: sp("2026-11-03T12:00:00") },
      { usuarioId: s.p.outra.id, lado: "VENDAS", inicio: sp("2026-11-03T12:00:00") },
    ]);
    const aberto = await carregarCanetaPara(s.p.vera, { periodo: NOVEMBRO, gpId: null }, AGORA);
    expect(aberto?.caneta.porPessoa.map((l) => l.usuario.nome).sort()).toEqual(["Outra", "Vera"]);

    const r = await salvarConfigRanking({ ...CONFIG_RANKING_PADRAO, mostrarAosVendedores: false }, { id: s.p.gestor.id, papel: "GESTOR" }, null);
    expect(r.ok).toBe(true);
    const oculto = await carregarCanetaPara(s.p.vera, { periodo: NOVEMBRO, gpId: null }, AGORA);
    expect(oculto?.visao).toBe("so_minhas");
    expect(oculto?.caneta).toMatchObject({ paradas: 0, noPeriodoDias: 1, maisParadas: [] });
    expect(oculto?.caneta.porPessoa.map((l) => l.usuario.nome)).toEqual(["Vera"]);
    // O GP continua vendo todas: precisa destravar.
    expect((await carregarCanetaPara(s.p.gp, { periodo: NOVEMBRO, gpId: null }, AGORA))?.visao).toBe("todas");
  });

  it("só conta o que está parado: enviada, aceita, congelada em Projetos, card perdido e lixeira ficam fora; sem dono é contada", async () => {
    await proposta("Enviada", s.p.vera, "ENVIADA");
    await proposta("Aceita", s.p.vera, "ACEITA");
    await proposta("Congelada", s.p.vera, "EM_AJUSTE", "execucao");
    await proposta("Perdida", s.p.vera, "EM_AJUSTE", "perdido_v");
    const naLixeira = await proposta("Lixeira", s.p.vera);
    await db.projeto.update({ where: { id: naLixeira.projetoId }, data: { deletadoEm: sp("2026-11-10T12:00:00") } });
    await proposta("Sem dono", s.p.vera, "EM_ANALISE", "contato", []);
    const v = await carregarCanetaPara(s.p.gp, { periodo: NOVEMBRO, gpId: null }, AGORA);
    expect(v?.caneta.paradas).toBe(0);
    expect(v?.caneta.semDono).toBe(1);
  });

  it("filtro por pessoa: as opções continuam todas, e sem dono não acompanha", async () => {
    await cenario();
    await proposta("Sem dono", s.p.vera, "EM_ANALISE", "contato", []);
    const v = await carregarCanetaPara(s.p.gp, { periodo: NOVEMBRO, gpId: s.p.vera.id }, AGORA);
    expect(v?.caneta.porPessoa.map((l) => l.usuario.nome)).toEqual(["Vera"]);
    expect(v?.caneta.paradas).toBe(1);
    expect(v?.caneta.pessoas.map((x) => x.nome)).toEqual(["Outra", "Vera"]);
    expect(v?.caneta.semDono).toBe(1);
  });

  it("reenvio: os eventos da Timeline tiram a espera de cada envio; Timeline de outro projeto não interfere", async () => {
    const criar = (titulo: string) =>
      proposta(titulo, s.p.vera, "ACEITA", "contato", [{ usuarioId: s.p.vera.id, lado: "VENDAS", inicio: sp("2026-11-01T12:00:00"), fim: sp("2026-11-10T12:00:00") }]);
    const p = await criar("Reenviada");
    await db.proposta.update({ where: { id: p.id }, data: { enviadaEm: sp("2026-11-06T12:00:00"), respondidaEm: sp("2026-11-10T12:00:00") } });
    const evento = (projetoId: string, nome: string, em: Date) => db.timeline.create({ data: { projetoId, tipo: "PROPOSTA", payload: { evento: nome }, usuarioId: s.p.vera.id, em } });
    await evento(p.projetoId, "enviada", sp("2026-11-02T12:00:00"));
    await evento(p.projetoId, "revisao_pedida", sp("2026-11-04T12:00:00"));
    await evento(p.projetoId, "versao_salva", sp("2026-11-05T12:00:00"));
    await evento(p.projetoId, "enviada", sp("2026-11-06T12:00:00"));
    await evento(p.projetoId, "aceita", sp("2026-11-10T12:00:00"));
    const v = await carregarCanetaPara(s.p.gp, { periodo: NOVEMBRO, gpId: null }, AGORA);
    // 9 dias com a caneta, menos 2 e 4 de espera.
    expect(v?.caneta.noPeriodoDias).toBe(3);
  });

  it("caneta aberta com o card já em Projetos: conta até a entrada na fase, e não cresce", async () => {
    const c = await proposta("Congelada", s.p.vera, "EM_AJUSTE", "execucao", [{ usuarioId: s.p.vera.id, lado: "VENDAS", inicio: sp("2026-11-02T12:00:00") }]);
    await db.projeto.update({ where: { id: c.projetoId }, data: { faseDesde: sp("2026-11-05T12:00:00") } });
    const v = await carregarCanetaPara(s.p.gp, { periodo: NOVEMBRO, gpId: null }, AGORA);
    expect(v?.caneta).toMatchObject({ paradas: 0, noPeriodoDias: 3 });
  });
});

describe("MCP: os mesmos números da tela, só leitura", () => {
  const dados = (r: { content: unknown[] }) => JSON.parse((r.content[0] as { text: string }).text);
  const NOMES = ["consultar_execucao_projetos", "listar_projetos_atrasados", "listar_projetos_em_alerta", "consultar_tempo_caneta_proposta"];
  const hoje = new Date();
  const periodo = resolverPeriodo("mes", undefined, hoje);
  // O relógio real das ferramentas: datas bem longe de hoje, para não mudar de faixa no meio do teste.
  const passado = new Date(hoje.getTime() - 30 * 86_400_000).toISOString().slice(0, 10);

  it("nenhuma das quatro escreve: anúncio com readOnlyHint", () => {
    for (const nome of NOMES) {
      const f = FERRAMENTAS.find((x) => x.nome === nome)!;
      expect(f.escrita, nome).toBe(false);
      expect(f.muda, nome).toBeFalsy();
    }
  });

  it("execução, atrasados e alertas: mesmos valores do serviço, para qualquer papel", async () => {
    const c = await s.card("Atrasado", "execucao", s.p.gil.id, { gpId: s.p.gil.id });
    await s.entrega(c.id, 0, passado);
    await db.projetoCheckin.create({ data: { projetoId: c.id, status: "VERMELHO", motivo: "travou", semana: dia("2026-10-26"), porId: s.p.gil.id, em: sp("2026-10-27T12:00:00") } });
    await s.card("Migrado", "execucao", s.p.rui.id, { execucaoDesde: null });

    const agora = new Date();
    const e = JSON.parse(JSON.stringify(await carregarExecucaoProjetos({ periodo, gpId: null }, agora)));
    const visual = s.p.visual;
    const execucao = dados(await executarFerramenta("consultar_execucao_projetos", {}, visual));
    expect(execucao.totais).toEqual(e.totais);
    expect(execucao.projetos).toEqual({ itens: e.projetos, total: 2, foraDaLista: 0 });
    expect(execucao.projetos.itens.find((x: { titulo: string }) => x.titulo === "Migrado").semPrevisto).toBe(true);
    expect(execucao.definicoes.execucao.length).toBeGreaterThan(0);
    expect(execucao.tela).toContain("/painel/projetos?");

    const atrasados = dados(await executarFerramenta("listar_projetos_atrasados", {}, visual));
    expect(atrasados.atrasados.itens).toEqual(e.atrasados);
    expect(atrasados.atrasados.itens.map((x: { titulo: string }) => x.titulo)).toEqual(["Atrasado"]);
    expect(atrasados).toMatchObject({ comAtraso: 1, semPrevisto: 1 });

    const alertas = dados(await executarFerramenta("listar_projetos_em_alerta", {}, visual));
    expect(alertas.vermelhos.itens).toEqual(e.alertas.vermelhos);
    expect(alertas.semCheckin.itens).toEqual(e.alertas.semCheckin);
    expect(alertas.vermelhos.itens.map((x: { titulo: string }) => x.titulo)).toEqual(["Atrasado"]);
  });

  it("gp_id: \"eu\" e pessoa desconhecida", async () => {
    await s.card("Do Gil", "execucao", s.p.gil.id);
    await s.card("Do Rui", "execucao", s.p.rui.id);
    const meu = dados(await executarFerramenta("consultar_execucao_projetos", { gp_id: "eu" }, s.p.gil));
    expect(meu.projetos.itens.map((x: { titulo: string }) => x.titulo)).toEqual(["Do Gil"]);
    const r = await executarFerramenta("listar_projetos_atrasados", { gp_id: "ninguem" }, s.p.gil);
    expect(r.isError).toBe(true);
    expect((r.content[0] as { text: string }).text).toMatch(/não encontrada/);
  });

  it("ref inválido é recusado com mensagem clara; \\0 no id é recusado pelo zod", async () => {
    for (const ref of ["0001-01-01", "1999-12-31", "2026-02-30", "2999-01-01"]) {
      const r = await executarFerramenta("consultar_execucao_projetos", { ref }, s.p.gil);
      expect(r.isError, ref).toBe(true);
      expect((r.content[0] as { text: string }).text, ref).toMatch(/ref inválido/);
    }
    const r = await executarFerramenta("listar_projetos_em_alerta", { gp_id: "a\0b" }, s.p.gil);
    expect(r.isError).toBe(true);
    expect((r.content[0] as { text: string }).text).toMatch(/Argumento inválido em gp_id/);
  });

  it("listas limitadas: totais completos e quantos ficaram de fora; atrasoDias só dos atrasados", async () => {
    const f = s.fase("execucao");
    const base = { pipelineId: f.pipelineId, faseId: f.id, responsavelId: s.p.gil.id, criadoVia: "UI" as const, execucaoDesde: new Date(hoje.getTime() - 60 * 86_400_000) };
    await db.projeto.createMany({ data: Array.from({ length: LIMITE_LISTA_MCP + 2 }, (_, i) => ({ ...base, titulo: `P${i}` })) });
    const execucao = dados(await executarFerramenta("consultar_execucao_projetos", {}, s.p.gil));
    expect(execucao.totais.emExecucao).toBe(LIMITE_LISTA_MCP + 2);
    expect(execucao.projetos.itens).toHaveLength(LIMITE_LISTA_MCP);
    expect(execucao.projetos).toMatchObject({ total: LIMITE_LISTA_MCP + 2, foraDaLista: 2 });

    const empurrado = await s.card("Só empurrou", "execucao", s.p.rui.id, { gpId: s.p.rui.id });
    const futuro = new Date(hoje.getTime() + 30 * 86_400_000).toISOString().slice(0, 10);
    await s.entrega(empurrado.id, 0, passado, { atual: futuro });
    const atrasado = await s.card("Atrasado", "execucao", s.p.rui.id, { gpId: s.p.rui.id });
    await s.entrega(atrasado.id, 0, passado);
    const a = dados(await executarFerramenta("listar_projetos_atrasados", { gp_id: s.p.rui.id }, s.p.gil));
    expect(a.atrasados.itens.map((x: { titulo: string }) => x.titulo)).toEqual(["Atrasado"]);
    expect(a.atrasoDias).toBe(a.atrasados.itens[0].atrasoDias);
  });

  it("caneta: visualizador é recusado na guarda; membro recebe o mesmo recorte da tela", async () => {
    const c = await s.card("Da Vera", "contato", s.p.vera.id);
    await db.proposta.create({ data: { projetoId: c.id, status: "EM_AJUSTE", criadoPorId: s.p.vera.id, canetaComId: s.p.vera.id, canetaLado: "VENDAS", periodosCaneta: { create: { usuarioId: s.p.vera.id, lado: "VENDAS", inicio: new Date(hoje.getTime() - 3 * 86_400_000) } } } });
    const recusa = await executarFerramenta("consultar_tempo_caneta_proposta", {}, s.p.visual);
    expect(recusa.isError).toBe(true);
    expect((recusa.content[0] as { text: string }).text).toMatch(/não tem acesso às propostas/);

    const dela = dados(await executarFerramenta("consultar_tempo_caneta_proposta", {}, s.p.vera));
    expect(dela.visao).toBe("escaladas");
    expect(dela.porPessoa[0]).toMatchObject({ paradas: 1, maiorDias: 3 });
    const servico = await carregarCanetaPara(s.p.vera, { periodo, gpId: null }, new Date());
    expect(dela.paradas).toBe(servico?.caneta.paradas);
    expect(dela.mediaDias).toBe(servico?.caneta.mediaDias);

    const deFora = dados(await executarFerramenta("consultar_tempo_caneta_proposta", {}, s.p.rui));
    expect(deFora).toMatchObject({ visao: "escaladas", paradas: 0, porPessoa: [] });
    expect(JSON.stringify(deFora)).not.toContain("Da Vera");
  });
});
