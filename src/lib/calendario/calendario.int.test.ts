import { beforeEach, describe, expect, it } from "vitest";
import type { Area, Cargo, Papel } from "@prisma/client";
import { dbTeste, limparBanco } from "@/test/db";
import { invalidarCachePipelines } from "@/lib/fases/cache";
import { inicioDoDia } from "@/lib/projetos/campos";
import { criarPrazo, marcarPrazoFeito } from "@/lib/prazos/prazos";
import { carregarItens, carregarItensDaSemana, resolverVisao } from "./calendario";
import { resolverPeriodo } from "./periodo";
import { instanteDoPrazo, resolverSemana } from "./semana";

const db = dbTeste();
const sp = (iso: string) => new Date(`${iso}-03:00`);
// Terça 27/10/2026, 10:00 de SP. Semana: 26/10 (seg) a 01/11 (dom).
const AGORA = sp("2026-10-27T10:00:00");
const SEMANA = resolverSemana(undefined, AGORA);

async function semear() {
  const vendas = await db.pipeline.create({
    data: {
      chave: "vendas",
      nome: "Vendas",
      ordem: 0,
      fases: {
        create: [
          { chave: "primeiro_contato", nome: "Primeiro Contato", ordem: 0 },
          { chave: "ganho", nome: "Ganho", ordem: 1, isTerminal: true, tipoTerminal: "GANHO" },
        ],
      },
    },
    include: { fases: true },
  });
  const ana = await db.usuario.create({ data: { nome: "Ana Vendas", email: "ana@ij.test" } });
  const bruno = await db.usuario.create({ data: { nome: "Bruno Lima", email: "bruno@ij.test" } });
  const ivo = await db.usuario.create({ data: { nome: "Ivo Inativo", email: "ivo@ij.test", ativo: false } });
  const principal = await db.empresa.create({ data: { nome: "Padaria Central" } });
  const mesclada = await db.empresa.create({ data: { nome: "Padaria do Zé", mergedIntoId: principal.id } });
  const fase = (chave: string) => vendas.fases.find((f) => f.chave === chave)!.id;
  const card = (titulo: string, dia: string | null, extra: { resp?: string; fase?: string; deletado?: boolean; empresaId?: string } = {}) =>
    db.projeto.create({
      data: {
        titulo,
        pipelineId: vendas.id,
        faseId: fase(extra.fase ?? "primeiro_contato"),
        responsavelId: extra.resp ?? ana.id,
        criadoVia: "UI",
        proximaAcao: `ação ${titulo}`,
        proximaAcaoEm: dia ? inicioDoDia(dia) : null,
        deletadoEm: extra.deletado ? new Date() : null,
        empresaId: extra.empresaId ?? null,
      },
    });
  return { ana, bruno, ivo, mesclada, card };
}

beforeEach(async () => {
  await limparBanco(["prazo", "transicao_fase", "timeline", "oportunidade", "fase", "pipeline", "empresa", "usuario"]);
  invalidarCachePipelines();
});

describe("carregarItensDaSemana", () => {
  it("ações: só cards abertos e vivos com próxima ação NA semana; vencida = antes de hoje; empresa mesclada pelo nome da principal", async () => {
    const s = await semear();
    await s.card("segunda", "2026-10-26", { empresaId: s.mesclada.id });
    await s.card("hoje", "2026-10-27");
    await s.card("domingo", "2026-11-01");
    await s.card("semana passada", "2026-10-25");
    await s.card("semana que vem", "2026-11-02");
    await s.card("sem data", null);
    await s.card("excluído", "2026-10-28", { deletado: true });
    await s.card("ganho", "2026-10-28", { fase: "ganho" });
    await s.card("do Bruno", "2026-10-28", { resp: s.bruno.id });

    const { acoes } = await carregarItensDaSemana({ responsavelIds: [s.ana.id] }, SEMANA, { id: s.ana.id, papel: "VENDEDOR" });
    expect(acoes.map((a) => [a.titulo, a.dia, a.vencida])).toEqual([
      ["segunda", "2026-10-26", true],
      ["hoje", "2026-10-27", false],
      ["domingo", "2026-11-01", false],
    ]);
    expect(acoes[0]).toMatchObject({ acao: "ação segunda", empresa: "Padaria Central", fase: "Primeiro Contato", responsavel: { id: s.ana.id, nome: "Ana Vendas", fotoEm: null } });

    const time = await carregarItensDaSemana("time", SEMANA, { id: s.ana.id, papel: "VENDEDOR" });
    expect(time.acoes.map((a) => a.titulo)).toContain("do Bruno");
  });

  it("prazos: estados vencido/feito/pendente, card na lixeira esconde o prazo, excluído some, permissão por item", async () => {
    const s = await semear();
    const gil = { id: (await db.usuario.create({ data: { nome: "Gil", email: "gil@ij.test", papel: "GESTOR" } })).id, papel: "GESTOR" as const };
    const ana = { id: s.ana.id, papel: "VENDEDOR" as const };
    const vivo = await s.card("vivo", null);
    const lixo = await s.card("lixo", null);
    const mk = async (titulo: string, dia: string, resp = s.ana.id, cardId?: string) => {
      const r = await criarPrazo(gil, { titulo, dia, responsavelId: resp, projetoId: cardId ?? null });
      if (!r.ok) throw new Error(r.erro);
      return r.id;
    };
    await mk("vencido", "2026-10-26", s.ana.id, vivo.id);
    const feito = await mk("feito ontem", "2026-10-26");
    await marcarPrazoFeito(gil, feito, true);
    await mk("hoje", "2026-10-27");
    await mk("do Bruno", "2026-10-29", s.bruno.id);
    await mk("no lixo", "2026-10-29", s.ana.id, lixo.id);
    await mk("fora", "2026-11-02");
    await db.projeto.update({ where: { id: lixo.id }, data: { deletadoEm: new Date() } });

    const meu = await carregarItensDaSemana({ responsavelIds: [s.ana.id] }, SEMANA, ana);
    expect(meu.prazos.map((p) => [p.titulo, p.dia, p.estado])).toEqual([
      ["vencido", "2026-10-26", "vencido"],
      ["feito ontem", "2026-10-26", "feito"],
      ["hoje", "2026-10-27", "pendente"],
    ]);
    expect(meu.prazos[0].card).toEqual({ id: vivo.id, titulo: "vivo" });
    expect(meu.prazos.every((p) => p.podeMexer)).toBe(true);

    const time = await carregarItensDaSemana("time", SEMANA, ana);
    const doBruno = time.prazos.find((p) => p.titulo === "do Bruno")!;
    expect(doBruno.podeMexer).toBe(false);
    expect(time.prazos.map((p) => p.titulo)).not.toContain("no lixo");
  });
});

describe("limites da semana (meio-aberto) e fuso da sessão", () => {
  async function semearBordas() {
    const s = await semear();
    const gil = { id: (await db.usuario.create({ data: { nome: "Gil", email: "gil@ij.test", papel: "GESTOR" } })).id, papel: "GESTOR" as const };
    for (const [titulo, dia] of [["dom antes", "2026-10-25"], ["seg", "2026-10-26"], ["dom", "2026-11-01"], ["seg depois", "2026-11-02"]] as const) {
      await s.card(`ação ${titulo}`, dia);
      const r = await criarPrazo(gil, { titulo: `prazo ${titulo}`, dia, responsavelId: s.ana.id });
      if (!r.ok) throw new Error(r.erro);
    }
    return s;
  }

  it("prazos e ações de segunda 26/10 e domingo 01/11 entram; os vizinhos não", async () => {
    const s = await semearBordas();
    const r = await carregarItensDaSemana({ responsavelIds: [s.ana.id] }, SEMANA, { id: s.ana.id, papel: "VENDEDOR" });
    expect(r.prazos.map((p) => [p.titulo, p.dia])).toEqual([
      ["prazo seg", "2026-10-26"],
      ["prazo dom", "2026-11-01"],
    ]);
    expect(r.acoes.map((a) => a.titulo)).toEqual(["ação seg", "ação dom"]);
  });

  it("com a sessão em America/Sao_Paulo (SET LOCAL TIME ZONE) nada desloca de dia", async () => {
    const s = await semearBordas();
    const r = await db.$transaction(async (tx) => {
      await tx.$executeRawUnsafe("SET LOCAL TIME ZONE 'America/Sao_Paulo'");
      return carregarItensDaSemana({ responsavelIds: [s.ana.id] }, SEMANA, { id: s.ana.id, papel: "VENDEDOR" }, tx);
    });
    expect(r.prazos.map((p) => [p.titulo, p.dia])).toEqual([
      ["prazo seg", "2026-10-26"],
      ["prazo dom", "2026-11-01"],
    ]);
    expect(r.acoes.map((a) => [a.titulo, a.dia])).toEqual([
      ["ação seg", "2026-10-26"],
      ["ação dom", "2026-11-01"],
    ]);
  });

  it("carregarItens cobre um intervalo arbitrário de dias (inclusivo nas duas pontas)", async () => {
    const s = await semearBordas();
    const r = await carregarItens({ responsavelIds: [s.ana.id] }, { primeiroDia: "2026-11-01", ultimoDia: "2026-11-02", hoje: "2026-10-27" }, { id: s.ana.id, papel: "VENDEDOR" });
    expect(r.prazos.map((p) => p.titulo)).toEqual(["prazo dom", "prazo seg depois"]);
    expect(r.acoes.map((a) => a.titulo)).toEqual(["ação dom", "ação seg depois"]);
  });
});

describe("resolverVisao (GAB-98: ?ver= e ?pessoa= forjados não furam)", () => {
  const eu = (id: string, papel: Papel, area: Area | null = null) => ({ id, papel, area, cargos: [] as Cargo[] });

  async function pessoas() {
    const s = await semear();
    const criar = (nome: string, papel: Papel, area: Area | null = null) => db.usuario.create({ data: { nome, email: `${nome.split(" ")[0].toLowerCase()}@ij.test`, papel, area } });
    await db.usuario.update({ where: { id: s.ana.id }, data: { papel: "VENDEDOR", area: "VENDAS" } });
    await db.usuario.update({ where: { id: s.bruno.id }, data: { papel: "VENDEDOR", area: "VENDAS" } });
    return { s, pam: await criar("Pam Projetos", "PROJETOS", "PROJETOS"), gv: await criar("Gil Vendas", "GESTOR", "VENDAS"), gp: await criar("Gui Projetos", "GESTOR", "PROJETOS"), dir: await criar("Dora Diretora", "GESTOR"), adm: await criar("Alice Admin", "ADMIN"), vera: await criar("Vera Visual", "VISUALIZADOR") };
  }

  it("membro: só a própria agenda; time e pessoa forjados viram Meu, sem seletor", async () => {
    const { s, pam } = await pessoas();
    for (const ator of [eu(s.ana.id, "VENDEDOR", "VENDAS"), eu(pam.id, "PROJETOS", "PROJETOS")]) {
      for (const params of [{}, { ver: "time" }, { pessoa: s.bruno.id }, { pessoa: pam.id, ver: "time" }]) {
        const v = await resolverVisao(ator, params);
        expect(v).toMatchObject({ modo: "meu", pessoa: null, opcoes: [], podeTrocar: false, filtro: { responsavelIds: [ator.id], comPrazosDosCards: true } });
      }
    }
  });

  it("gestor com área: time e pessoas do mesmo lado; de outro lado volta para Meu", async () => {
    const { s, pam, gv, gp, dir } = await pessoas();
    const ator = eu(gv.id, "GESTOR", "VENDAS");
    const time = await resolverVisao(ator, { ver: "time" });
    expect(time.modo).toBe("time");
    expect(time.opcoes.map((o) => o.nome)).toEqual(["Ana Vendas", "Bruno Lima", "Gil Vendas"]);
    expect(time.filtro).toMatchObject({ responsavelIds: expect.arrayContaining([s.ana.id, s.bruno.id, gv.id]) });
    expect(await resolverVisao(ator, { pessoa: s.bruno.id })).toMatchObject({ modo: "pessoa", pessoa: { id: s.bruno.id } });
    for (const forjada of [pam.id, gp.id, dir.id, s.ivo.id, "lixo"]) expect((await resolverVisao(ator, { pessoa: forjada })).modo).toBe("meu");
    expect((await resolverVisao(eu(gp.id, "GESTOR", "PROJETOS"), { pessoa: s.ana.id })).modo).toBe("meu");
    expect((await resolverVisao(eu(gp.id, "GESTOR", "PROJETOS"), { pessoa: pam.id })).modo).toBe("pessoa");
  });

  it("gestor sem área e admin: todos; inativo volta para Meu", async () => {
    const { s, pam, dir, adm, vera } = await pessoas();
    for (const ator of [eu(dir.id, "GESTOR"), eu(adm.id, "ADMIN")]) {
      expect(await resolverVisao(ator, { ver: "time" })).toMatchObject({ modo: "time", filtro: "time", podeTrocar: true });
      expect((await resolverVisao(ator, { pessoa: pam.id })).modo).toBe("pessoa");
      expect((await resolverVisao(ator, { pessoa: s.ana.id })).modo).toBe("pessoa");
      expect((await resolverVisao(ator, { pessoa: s.ivo.id })).modo).toBe("meu");
      expect((await resolverVisao(ator, {})).opcoes.map((o) => o.id)).not.toContain(vera.id);
    }
  });

  it("VISUALIZADOR que chegue aqui não vê o time nem ninguém", async () => {
    const { s, vera } = await pessoas();
    for (const params of [{}, { ver: "time" }, { pessoa: s.ana.id }]) {
      expect(await resolverVisao(eu(vera.id, "VISUALIZADOR"), params)).toMatchObject({ modo: "meu", opcoes: [], podeTrocar: false, filtro: { responsavelIds: [vera.id] } });
    }
  });

  it("atribuído: o Calendário traz o prazo de outra pessoa no MEU card; a Minha Semana (sem a opção) não", async () => {
    const s = await semear();
    const c = await s.card("meu card", null);
    await db.prazo.create({ data: { titulo: "do outro no meu card", data: instanteDoPrazo("2026-10-29"), responsavelId: s.bruno.id, projetoId: c.id, criadoPorId: s.bruno.id } });
    const ator = { id: s.ana.id, papel: "VENDEDOR" as const };
    const intervalo = { primeiroDia: "2026-10-26", ultimoDia: "2026-11-01", hoje: "2026-10-27" };
    const cal = await carregarItens({ responsavelIds: [s.ana.id], comPrazosDosCards: true }, intervalo, ator);
    expect(cal.prazos.map((p) => p.titulo)).toContain("do outro no meu card");
    const semana = await carregarItens({ responsavelIds: [s.ana.id] }, intervalo, ator);
    expect(semana.prazos.map((p) => p.titulo)).not.toContain("do outro no meu card");
  });
});

describe("limites do mês e dos 15 dias (Calendário por período)", () => {
  it("mês: 01/10 e 31/10 entram; 30/09 e 01/11 não (ações por instante de SP, prazos pela coluna DATE)", async () => {
    const s = await semear();
    const gil = { id: (await db.usuario.create({ data: { nome: "Gil", email: "gil@ij.test", papel: "GESTOR" } })).id, papel: "GESTOR" as const };
    for (const dia of ["2026-09-30", "2026-10-01", "2026-10-31", "2026-11-01"]) {
      await s.card(`ação ${dia}`, dia);
      const r = await criarPrazo(gil, { titulo: `prazo ${dia}`, dia, responsavelId: s.ana.id });
      if (!r.ok) throw new Error(r.erro);
    }
    const ator = { id: s.ana.id, papel: "VENDEDOR" as const };
    const mes = resolverPeriodo("mes", undefined, AGORA);
    const r = await carregarItens({ responsavelIds: [s.ana.id] }, { primeiroDia: mes.primeiroDia, ultimoDia: mes.ultimoDia, hoje: mes.hoje }, ator);
    expect(r.acoes.map((a) => a.dia)).toEqual(["2026-10-01", "2026-10-31"]);
    expect(r.prazos.map((p) => p.dia)).toEqual(["2026-10-01", "2026-10-31"]);

    const q = resolverPeriodo("15d", "2026-10-17", AGORA); // 17/10 a 31/10
    const r15 = await carregarItens({ responsavelIds: [s.ana.id] }, { primeiroDia: q.primeiroDia, ultimoDia: q.ultimoDia, hoje: q.hoje }, ator);
    expect(r15.acoes.map((a) => a.dia)).toEqual(["2026-10-31"]);
    expect(r15.prazos.map((p) => p.dia)).toEqual(["2026-10-31"]);
  });
});
