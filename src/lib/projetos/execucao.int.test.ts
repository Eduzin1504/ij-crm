// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Area, Cargo, Papel } from "@prisma/client";
import { lembrarCheckinsAtrasados } from "@/lib/avisos/checkin";
import { invalidarCachePipelines } from "@/lib/fases/cache";
import { removerFase, reordenarFases } from "@/lib/fases/fases";
import { excluirCard, restaurarCard } from "@/lib/lixeira/cards";
import { dbTeste, limparBanco } from "@/test/db";
import { timelineSemProposta } from "@/lib/propostas/acesso";
import { adicionarEntrega, ajustarDataEntrega, cancelarEntrega, copiarCronogramaDaProposta, cronogramaSemProposta, desmarcarEntrega, marcarEntregaFeita, obterCronograma, registrarCheckin } from "./execucao";
import { moverParaExecucao } from "./handoff";
import { listarQuadro, moverCard } from "./projetos";

const db = dbTeste();

const ENTREGAS_V2 = [
  { titulo: "Diagnóstico", dia: "2026-11-20", valor: "1000.00" },
  { titulo: "Entrega final", dia: "2026-12-10", valor: null },
];

async function semear() {
  const projetos = await db.pipeline.create({
    data: {
      chave: "projetos",
      nome: "Projetos",
      ordem: 1,
      fases: {
        create: [
          { chave: "handoff", nome: "Handoff", ordem: 0, marco: "HANDOFF" },
          { chave: "preparacao", nome: "Preparação", ordem: 1 },
          { chave: "em_execucao", nome: "Em execução", ordem: 2, marco: "EXECUCAO" },
          { chave: "conclusao", nome: "Conclusão", ordem: 3 },
          { chave: "finalizado", nome: "Finalizado", ordem: 4, isTerminal: true, tipoTerminal: "GANHO", marco: "FINALIZADO" },
          { chave: "perdido", nome: "Perdido", ordem: 5, isTerminal: true, tipoTerminal: "PERDIDO" },
        ],
      },
    },
    include: { fases: true },
  });
  const pessoa = (nome: string, papel: Papel, extra: { area?: Area; cargos?: Cargo[]; ativo?: boolean } = {}) => db.usuario.create({ data: { nome, email: `${nome.toLowerCase()}@ij.test`, papel, ...extra } });
  const gp = await pessoa("Pedro", "PROJETOS", { area: "PROJETOS" });
  const par = await pessoa("Paula", "PROJETOS", { area: "PROJETOS", cargos: ["GP"] });
  const ana = await pessoa("Ana", "VENDEDOR", { area: "VENDAS" });
  const gil = await pessoa("Gil", "GESTOR");
  const gv = await pessoa("Guto", "GESTOR", { area: "VENDAS" });
  const adm = await pessoa("Ada", "ADMIN");
  const vera = await pessoa("Vera", "VISUALIZADOR");
  const f = (chave: string) => projetos.fases.find((x) => x.chave === chave)!.id;

  /** Card isento (a trava tem testes próprios): GP designado e, se pedido, proposta aceita na v2. */
  const card = async (o: { fase?: string; proposta?: boolean; comGp?: boolean; responsavelId?: string; execucaoDesde?: Date | null } = {}) => {
    const c = await db.projeto.create({
      data: {
        pipelineId: projetos.id,
        faseId: f(o.fase ?? "handoff"),
        titulo: "Site",
        responsavelId: o.responsavelId ?? gp.id,
        criadoVia: "UI",
        isentoTravaContrato: true,
        isentoTravaHandoff: true,
        execucaoDesde: o.execucaoDesde ?? null,
      },
    });
    if (o.comGp !== false) await db.projetoHandoff.create({ data: { projetoId: c.id, gpProjetoId: gp.id } });
    if (o.proposta) {
      const p = await db.proposta.create({ data: { projetoId: c.id, status: "ACEITA", criadoPorId: ana.id, versaoEnviada: 2 } });
      await db.propostaVersao.create({ data: { propostaId: p.id, numero: 1, conteudoMd: "v1", estruturado: { entregas: [{ titulo: "Antiga", dia: "2026-01-01", valor: null }] }, autorId: ana.id } });
      await db.propostaVersao.create({ data: { propostaId: p.id, numero: 2, conteudoMd: "v2", estruturado: { entregas: ENTREGAS_V2 }, autorId: ana.id } });
      await db.propostaVersao.create({ data: { propostaId: p.id, numero: 3, conteudoMd: "v3 depois do aceite", estruturado: { entregas: [{ titulo: "Não vale", dia: "2026-02-02", valor: null }] }, autorId: ana.id } });
    }
    return c.id;
  };
  const entregas = (id: string) => db.projetoEntrega.findMany({ where: { projetoId: id }, orderBy: { ordem: "asc" } });
  const eventos = async (id: string) => (await db.timeline.findMany({ where: { projetoId: id, tipo: "EXECUCAO" }, orderBy: [{ em: "asc" }, { id: "asc" }] })).map((t) => (t.payload as { evento: string }).evento);
  return { projetos, gp, par, ana, gil, gv, adm, vera, f, card, entregas, eventos };
}

let s: Awaited<ReturnType<typeof semear>>;

beforeEach(async () => {
  await limparBanco(["aviso", "proposta", "projeto_handoff", "transicao_fase", "timeline", "oportunidade", "fase", "pipeline", "usuario"]);
  invalidarCachePipelines();
  delete process.env.NOTIFICATIONS_ENABLED;
  vi.spyOn(console, "info").mockImplementation(() => {});
  s = await semear();
});

const dia = (d: Date | null) => d?.toISOString().slice(0, 10) ?? null;

describe("cópia da proposta final", () => {
  it("o arraste copia a versão final (não a última salva nem a primeira), com previsto original e atual iguais", async () => {
    const id = await s.card({ proposta: true });
    expect(await moverCard(id, s.f("em_execucao"), s.ana)).toMatchObject({ ok: true });
    const es = await s.entregas(id);
    expect(es.map((e) => [e.titulo, dia(e.previstoOriginal), dia(e.previstoAtual), e.valor?.toFixed(2) ?? null, e.origem, e.propostaVersao])).toEqual([
      ["Diagnóstico", "2026-11-20", "2026-11-20", "1000.00", "PROPOSTA", 2],
      ["Entrega final", "2026-12-10", "2026-12-10", null, "PROPOSTA", 2],
    ]);
    expect(await s.eventos(id)).toEqual(["cronograma_copiado"]);
    const movimento = await db.timeline.findFirstOrThrow({ where: { projetoId: id, tipo: "MOVIMENTACAO" } });
    const copia = await db.timeline.findFirstOrThrow({ where: { projetoId: id, tipo: "EXECUCAO" } });
    expect(copia.em.getTime()).toBeGreaterThan(movimento.em.getTime());
    expect(copia.usuarioId).toBe(s.ana.id);
  });

  it("mover_para_execucao e subfase além do marco copiam igual; andar lá dentro não duplica", async () => {
    const a = await s.card({ proposta: true });
    expect(await moverParaExecucao(a, s.gp)).toMatchObject({ ok: true });
    expect(await s.entregas(a)).toHaveLength(2);

    const b = await s.card({ proposta: true });
    expect(await moverCard(b, s.f("conclusao"), s.gp)).toMatchObject({ ok: true });
    expect(await s.entregas(b)).toHaveLength(2);
    expect(await moverCard(b, s.f("em_execucao"), s.gp)).toMatchObject({ ok: true });
    expect(await moverCard(b, s.f("conclusao"), s.gp)).toMatchObject({ ok: true });
    expect(await s.entregas(b)).toHaveLength(2);
    expect(await s.eventos(b)).toEqual(["cronograma_copiado"]);
  });

  it("sair e voltar não recopia nem apaga: ajuste e entrega feita continuam", async () => {
    const id = await s.card({ proposta: true });
    await moverCard(id, s.f("em_execucao"), s.gp);
    const [d1, d2] = await s.entregas(id);
    await ajustarDataEntrega(id, d1.id, { dia: "2026-11-27", motivo: "Cliente atrasou" }, s.gp);
    await marcarEntregaFeita(id, d2.id, "2026-11-01", s.gp, new Date("2026-11-04T15:00:00Z"));
    expect(await moverCard(id, s.f("handoff"), s.gp)).toMatchObject({ ok: true });
    expect(await s.entregas(id)).toHaveLength(2);
    expect(await moverCard(id, s.f("em_execucao"), s.gp)).toMatchObject({ ok: true });
    const es = await s.entregas(id);
    expect(es).toHaveLength(2);
    expect(es.map((e) => dia(e.previstoOriginal))).toEqual(["2026-11-20", "2026-12-10"]);
    expect(dia(es[0].previstoAtual)).toBe("2026-11-27");
    expect(dia(es[1].realizadoEm)).toBe("2026-11-01");
  });

  it("perdido e reaberto, finalizado e reaberto: sem duplicar", async () => {
    const id = await s.card({ proposta: true });
    await moverCard(id, s.f("em_execucao"), s.gp);
    await moverCard(id, s.f("perdido"), s.gp, { dadosTerminal: { motivo: "preco" } });
    await moverCard(id, s.f("em_execucao"), s.gp);
    await moverCard(id, s.f("finalizado"), s.gp);
    await moverCard(id, s.f("em_execucao"), s.gp);
    expect(await s.entregas(id)).toHaveLength(2);
    expect(await s.eventos(id)).toEqual(["cronograma_copiado"]);
  });

  it("lixeira: quem estava em Execução volta sem duplicar", async () => {
    const id = await s.card({ proposta: true });
    await moverCard(id, s.f("em_execucao"), s.gp);
    await excluirCard(id, s.gp);
    expect(await restaurarCard(id, s.gil)).toMatchObject({ ok: true });
    expect(await s.entregas(id)).toHaveLength(2);
    expect(await s.eventos(id)).toEqual(["cronograma_copiado"]);
  });

  it("lixeira: a fase virou posterior a Execução com o card na lixeira, então restaurar é entrar e copia", async () => {
    const id = await s.card({ proposta: true, fase: "preparacao" });
    await excluirCard(id, s.gp);
    const ordem = ["handoff", "em_execucao", "preparacao", "conclusao", "finalizado", "perdido"].map(s.f);
    expect(await reordenarFases(s.projetos.id, ordem)).toEqual({ ok: true });
    expect(await restaurarCard(id, s.gil)).toMatchObject({ ok: true });
    expect(await s.entregas(id)).toHaveLength(2);
    expect((await db.projeto.findUniqueOrThrow({ where: { id } })).execucaoDesde).not.toBeNull();
  });

  it("Gestão de fases: migrar a subfase para Execução e reordenar para depois dela entram sem movimento", async () => {
    const a = await s.card({ proposta: true, fase: "preparacao" });
    const ordem = ["handoff", "em_execucao", "preparacao", "conclusao", "finalizado", "perdido"].map(s.f);
    expect(await reordenarFases(s.projetos.id, ordem)).toEqual({ ok: true });
    expect(await s.entregas(a)).toHaveLength(2);
    expect((await db.projeto.findUniqueOrThrow({ where: { id: a } })).execucaoDesde).not.toBeNull();
    // Voltou para antes e migra para Execução: já tem entregas, não recopia.
    expect(await reordenarFases(s.projetos.id, ["handoff", "preparacao", "em_execucao", "conclusao", "finalizado", "perdido"].map(s.f))).toEqual({ ok: true });
    const b = await s.card({ proposta: true, fase: "preparacao" });
    expect(await removerFase(s.f("preparacao"), { destinoFaseId: s.f("em_execucao") }, s.gil)).toMatchObject({ ok: true });
    expect(await s.entregas(a)).toHaveLength(2);
    expect(await s.entregas(b)).toHaveLength(2);
  });

  it("Perdido e Handoff não copiam; proposta não aceita também não", async () => {
    const a = await s.card({ proposta: true });
    await moverCard(a, s.f("perdido"), s.gp, { dadosTerminal: { motivo: "preco" } });
    expect(await s.entregas(a)).toHaveLength(0);

    const b = await s.card();
    await db.proposta.create({ data: { projetoId: b, status: "ENVIADA", criadoPorId: s.ana.id, versaoEnviada: 1 } });
    await moverCard(b, s.f("em_execucao"), s.gp);
    expect(await s.entregas(b)).toHaveLength(0);
  });

  it("linha estranha no snapshot não barra o movimento", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const id = await s.card();
    const p = await db.proposta.create({ data: { projetoId: id, status: "ACEITA", criadoPorId: s.ana.id, versaoEnviada: 1 } });
    await db.propostaVersao.create({ data: { propostaId: p.id, numero: 1, conteudoMd: "", estruturado: { entregas: [{ titulo: "Boa", dia: "2026-11-20" }, { titulo: "Ruim", dia: "20/11/2026" }] }, autorId: s.ana.id } });
    expect(await moverCard(id, s.f("em_execucao"), s.gp)).toMatchObject({ ok: true });
    expect((await s.entregas(id)).map((e) => e.titulo)).toEqual(["Boa"]);
  });

  it("valor inválido vira null com warn, data inválida entra em `ignoradas` e fica fora de `copiaveis`", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const id = await s.card({ fase: "em_execucao" });
    const p = await db.proposta.create({ data: { projetoId: id, status: "ACEITA", criadoPorId: s.ana.id, versaoEnviada: 1 } });
    const estruturado = {
      entregas: [
        { titulo: "Valor ruim", dia: "2026-11-20", valor: "doze reais" },
        { titulo: "Valor grande", dia: "2026-11-21", valor: "9999999999999.00" },
        { titulo: "Boa", dia: "2026-11-22", valor: "10.50" },
        { titulo: "Data ruim", dia: "2026-02-30", valor: "1.00" },
      ],
    };
    await db.propostaVersao.create({ data: { propostaId: p.id, numero: 1, conteudoMd: "", estruturado, autorId: s.ana.id } });
    expect((await obterCronograma(id))?.copiaveis).toBe(3);
    await moverCard(id, s.f("handoff"), s.gp);
    await moverCard(id, s.f("em_execucao"), s.gp);
    expect((await s.entregas(id)).map((e) => [e.titulo, e.valor?.toFixed(2) ?? null])).toEqual([
      ["Valor ruim", null],
      ["Valor grande", null],
      ["Boa", "10.50"],
    ]);
    expect(warn).toHaveBeenCalled();
    const t = await db.timeline.findFirstOrThrow({ where: { projetoId: id, tipo: "EXECUCAO" } });
    expect(t.payload).toMatchObject({ evento: "cronograma_copiado", versao: 1, entregas: 3, ignoradas: 1 });
  });

  it("proposta só com data inválida: nada a copiar", async () => {
    const id = await s.card({ fase: "em_execucao" });
    const p = await db.proposta.create({ data: { projetoId: id, status: "ACEITA", criadoPorId: s.ana.id, versaoEnviada: 1 } });
    await db.propostaVersao.create({ data: { propostaId: p.id, numero: 1, conteudoMd: "", estruturado: { entregas: [{ titulo: "Ruim", dia: "ontem" }] }, autorId: s.ana.id } });
    expect((await obterCronograma(id))?.copiaveis).toBe(0);
  });

  it("card já em Execução no deploy: a tela copia uma vez, e não por cima do que existe", async () => {
    const id = await s.card({ proposta: true, fase: "em_execucao" });
    expect((await obterCronograma(id))?.copiaveis).toBe(2);
    expect(await copiarCronogramaDaProposta(id, s.gp)).toEqual({ ok: true, entregas: 2 });
    expect(await copiarCronogramaDaProposta(id, s.gp)).toEqual({ ok: false, erro: "CRONOGRAMA_JA_EXISTE" });
    expect((await obterCronograma(id))?.copiaveis).toBe(0);
    const sem = await s.card({ fase: "em_execucao" });
    expect(await copiarCronogramaDaProposta(sem, s.gp)).toEqual({ ok: false, erro: "PROPOSTA_SEM_CRONOGRAMA" });
  });

  it("andar entre subfases não copia; o botão continua valendo; sair e voltar é nova entrada", async () => {
    const id = await s.card({ proposta: true, fase: "em_execucao" });
    expect(await moverCard(id, s.f("conclusao"), s.gp)).toMatchObject({ ok: true });
    expect(await s.entregas(id)).toHaveLength(0);
    expect((await db.projeto.findUniqueOrThrow({ where: { id } })).execucaoDesde).toBeNull();
    expect((await obterCronograma(id))?.copiaveis).toBe(2);
    expect(await copiarCronogramaDaProposta(id, s.gp)).toEqual({ ok: true, entregas: 2 });

    const outro = await s.card({ proposta: true, fase: "em_execucao" });
    await moverCard(outro, s.f("handoff"), s.gp);
    expect(await s.entregas(outro)).toHaveLength(0);
    await moverCard(outro, s.f("em_execucao"), s.gp);
    expect(await s.entregas(outro)).toHaveLength(2);
  });

  it("lixeira: quem já estava em Execução, sem cronograma, volta sem copiar; o botão resolve", async () => {
    const id = await s.card({ proposta: true, fase: "em_execucao" });
    await excluirCard(id, s.gp);
    expect(await restaurarCard(id, s.gil)).toMatchObject({ ok: true });
    expect(await s.entregas(id)).toHaveLength(0);
    expect((await obterCronograma(id))?.copiaveis).toBe(2);
  });
});

describe("previsto original", () => {
  it("o banco recusa mudar o original; ajuste muda só o atual, com histórico e Timeline", async () => {
    const id = await s.card({ proposta: true });
    await moverCard(id, s.f("em_execucao"), s.gp);
    const [e] = await s.entregas(id);
    await expect(db.projetoEntrega.update({ where: { id: e.id }, data: { previstoOriginal: new Date("2030-01-01") } })).rejects.toThrow();

    expect(await ajustarDataEntrega(id, e.id, { dia: "2026-11-27", motivo: "  Cliente\n atrasou " }, s.gp)).toEqual({ ok: true, mudou: true });
    expect(await ajustarDataEntrega(id, e.id, { dia: "2026-12-04", motivo: "De novo" }, s.gil)).toEqual({ ok: true, mudou: true });
    expect(await ajustarDataEntrega(id, e.id, { dia: "2026-12-04", motivo: "Igual" }, s.gp)).toEqual({ ok: true, mudou: false });
    const v = (await obterCronograma(id))!.entregas[0];
    expect(v).toMatchObject({ previstoOriginal: "2026-11-20", previsto: "2026-12-04" });
    expect(v.ajustes.map((a) => [a.de, a.para, a.motivo, a.por])).toEqual([
      ["2026-11-20", "2026-11-27", "Cliente atrasou", "Pedro"],
      ["2026-11-27", "2026-12-04", "De novo", "Gil"],
    ]);
    await expect(db.entregaAjuste.updateMany({ data: { motivo: "mexi" } })).rejects.toThrow();
    const t = await db.timeline.findMany({ where: { projetoId: id, tipo: "EXECUCAO" }, orderBy: [{ em: "asc" }, { id: "asc" }] });
    expect(t.at(-1)?.payload).toMatchObject({ evento: "data_ajustada", de: "2026-11-27", para: "2026-12-04", motivo: "De novo" });
    expect(t.at(-1)?.usuarioId).toBe(s.gil.id);
  });

  it("ajuste exige motivo e data válida, e entrega feita precisa ser desmarcada antes", async () => {
    const id = await s.card({ fase: "em_execucao" });
    const r = await adicionarEntrega(id, { titulo: "A", dia: "2026-11-20" }, s.gp);
    if (!r.ok) throw new Error(r.erro);
    expect(await ajustarDataEntrega(id, r.entregaId, { dia: "2026-11-27", motivo: "  " }, s.gp)).toEqual({ ok: false, erro: "MOTIVO_INVALIDO" });
    expect(await ajustarDataEntrega(id, r.entregaId, { dia: "2026-02-30", motivo: "x" }, s.gp)).toEqual({ ok: false, erro: "DIA_INVALIDO" });
    await marcarEntregaFeita(id, r.entregaId, null, s.gp);
    expect(await ajustarDataEntrega(id, r.entregaId, { dia: "2026-11-27", motivo: "x" }, s.gp)).toEqual({ ok: false, erro: "ENTREGA_JA_FEITA" });
    expect(await ajustarDataEntrega(id, "outra", { dia: "2026-11-27", motivo: "x" }, s.gp)).toEqual({ ok: false, erro: "ENTREGA_NAO_ENCONTRADA" });
  });
});

describe("marcar entrega", () => {
  it("padrão é hoje em São Paulo; futuro é recusado; marcar de novo corrige; desmarcar volta; tudo na Timeline", async () => {
    const id = await s.card({ fase: "em_execucao" });
    const r = await adicionarEntrega(id, { titulo: "A", dia: "2026-11-20", valor: "1.500,00" }, s.gp);
    if (!r.ok) throw new Error(r.erro);
    // 23h30 de domingo em São Paulo já é segunda em UTC.
    const agora = new Date("2026-11-09T02:30:00Z");
    expect(await marcarEntregaFeita(id, r.entregaId, null, s.gp, agora)).toEqual({ ok: true, mudou: true, dia: "2026-11-08" });
    expect(await marcarEntregaFeita(id, r.entregaId, "2026-11-09", s.gp, agora)).toEqual({ ok: false, erro: "DIA_NO_FUTURO" });
    expect(await marcarEntregaFeita(id, r.entregaId, "2026-11-08", s.gp, agora)).toEqual({ ok: true, mudou: false, dia: "2026-11-08" });
    expect(await marcarEntregaFeita(id, r.entregaId, "2026-11-07", s.gp, agora)).toEqual({ ok: true, mudou: true, dia: "2026-11-07" });
    expect(await desmarcarEntrega(id, r.entregaId, s.gp)).toEqual({ ok: true, mudou: true });
    expect(await desmarcarEntrega(id, r.entregaId, s.gp)).toEqual({ ok: true, mudou: false });
    expect(await s.eventos(id)).toEqual(["entrega_adicionada", "entrega_feita", "entrega_feita", "entrega_desmarcada"]);
    const [e] = await s.entregas(id);
    expect(e.realizadoEm).toBeNull();
    expect(e.valor?.toFixed(2)).toBe("1500.00");
    expect(e.origem).toBe("MANUAL");
  });

  it("atrasada: passou do previsto e não foi feita, em dias de São Paulo", async () => {
    const id = await s.card({ fase: "em_execucao" });
    await adicionarEntrega(id, { titulo: "A", dia: "2026-11-08" }, s.gp);
    expect((await obterCronograma(id, new Date("2026-11-09T02:30:00Z")))!.entregas[0].atrasada).toBe(false);
    expect((await obterCronograma(id, new Date("2026-11-09T03:00:00Z")))!.entregas[0].atrasada).toBe(true);
  });
});

describe("cronograma manual", () => {
  it("migrado sem proposta recebe entregas à mão, sem misturar depois com a proposta", async () => {
    const id = await s.card({ fase: "em_execucao", comGp: false });
    expect(await adicionarEntrega(id, { titulo: "  Fase   1 ", dia: "2026-11-20" }, s.gp)).toMatchObject({ ok: true });
    expect(await adicionarEntrega(id, { titulo: "", dia: "2026-11-20" }, s.gp)).toEqual({ ok: false, erro: "ENTREGA_INVALIDA" });
    expect(await adicionarEntrega(id, { titulo: "x", dia: "amanhã" }, s.gp)).toEqual({ ok: false, erro: "DIA_INVALIDO" });
    expect(await adicionarEntrega(id, { titulo: "x", dia: "2026-11-20", valor: "abc" }, s.gp)).toEqual({ ok: false, erro: "VALOR_INVALIDO" });
    const p = await db.proposta.create({ data: { projetoId: id, status: "ACEITA", criadoPorId: s.ana.id, versaoEnviada: 1 } });
    await db.propostaVersao.create({ data: { propostaId: p.id, numero: 1, conteudoMd: "", estruturado: { entregas: ENTREGAS_V2 }, autorId: s.ana.id } });
    await moverCard(id, s.f("conclusao"), s.gp);
    expect((await s.entregas(id)).map((e) => [e.ordem, e.titulo])).toEqual([[0, "Fase 1"]]);
    expect((await obterCronograma(id))?.gp).toEqual({ id: s.gp.id, nome: "Pedro" });
  });

  it("entrega nova entra no fim, mesmo depois da cópia", async () => {
    const id = await s.card({ proposta: true });
    await moverCard(id, s.f("em_execucao"), s.gp);
    await adicionarEntrega(id, { titulo: "Extra", dia: "2027-01-10" }, s.gp);
    expect((await s.entregas(id)).map((e) => [e.ordem, e.titulo, e.origem])).toEqual([
      [0, "Diagnóstico", "PROPOSTA"],
      [1, "Entrega final", "PROPOSTA"],
      [2, "Extra", "MANUAL"],
    ]);
  });
});

describe("cancelar entrega", () => {
  it("exige motivo; a linha fica, fora do cronograma ativo e da Timeline não some; não aceita mais nada", async () => {
    const id = await s.card({ fase: "em_execucao" });
    const a = await adicionarEntrega(id, { titulo: "A", dia: "2026-11-20", valor: "10,00" }, s.gp);
    const b = await adicionarEntrega(id, { titulo: "B", dia: "2026-11-21" }, s.gp);
    if (!a.ok || !b.ok) throw new Error("seed");
    expect(await cancelarEntrega(id, a.entregaId, { motivo: "  " }, s.gp)).toEqual({ ok: false, erro: "MOTIVO_INVALIDO" });
    expect(await cancelarEntrega(id, a.entregaId, { motivo: "x" }, s.par)).toEqual({ ok: false, erro: "SEM_PERMISSAO" });
    expect(await cancelarEntrega(id, "outra", { motivo: "x" }, s.gp)).toEqual({ ok: false, erro: "ENTREGA_NAO_ENCONTRADA" });
    expect(await cancelarEntrega(id, a.entregaId, { motivo: " Lançada\n por engano " }, s.gp)).toEqual({ ok: true, mudou: true });
    expect(await cancelarEntrega(id, a.entregaId, { motivo: "de novo" }, s.gp)).toEqual({ ok: true, mudou: false });
    expect(await s.entregas(id)).toHaveLength(2);
    const v = (await obterCronograma(id))!;
    expect(v.entregas.map((e) => e.titulo)).toEqual(["B"]);
    expect(v.canceladas).toMatchObject([{ titulo: "A", motivo: "Lançada por engano", valor: "10.00" }]);
    expect(await marcarEntregaFeita(id, a.entregaId, null, s.gp)).toEqual({ ok: false, erro: "ENTREGA_CANCELADA" });
    expect(await desmarcarEntrega(id, a.entregaId, s.gp)).toEqual({ ok: false, erro: "ENTREGA_CANCELADA" });
    expect(await ajustarDataEntrega(id, a.entregaId, { dia: "2026-12-01", motivo: "x" }, s.gp)).toEqual({ ok: false, erro: "ENTREGA_CANCELADA" });
    expect((await s.eventos(id)).at(-1)).toBe("entrega_cancelada");
    await marcarEntregaFeita(id, b.entregaId, "2026-01-01", s.gp);
    expect(await cancelarEntrega(id, b.entregaId, { motivo: "x" }, s.gp)).toEqual({ ok: false, erro: "ENTREGA_JA_FEITA" });
    expect(await db.projetoEntrega.count({ where: { projetoId: id, canceladaEm: null } })).toBe(1);
  });

  it("regra da cópia: manual cancelada não impede, e a ordem continua; cancelada da proposta não recopia", async () => {
    const id = await s.card({ fase: "em_execucao", proposta: true });
    const m = await adicionarEntrega(id, { titulo: "Engano", dia: "2026-11-20" }, s.gp);
    if (!m.ok) throw new Error("seed");
    expect((await obterCronograma(id))?.copiaveis).toBe(0);
    expect(await copiarCronogramaDaProposta(id, s.gp)).toEqual({ ok: false, erro: "CRONOGRAMA_JA_EXISTE" });
    await cancelarEntrega(id, m.entregaId, { motivo: "Engano" }, s.gp);
    expect((await obterCronograma(id))?.copiaveis).toBe(2);
    expect(await copiarCronogramaDaProposta(id, s.gp)).toEqual({ ok: true, entregas: 2 });
    expect((await s.entregas(id)).map((e) => [e.ordem, e.titulo])).toEqual([[0, "Engano"], [1, "Diagnóstico"], [2, "Entrega final"]]);

    for (const e of await s.entregas(id)) if (!e.canceladaEm) await cancelarEntrega(id, e.id, { motivo: "Saiu do escopo" }, s.gp);
    expect((await obterCronograma(id))?.copiaveis).toBe(0);
    await moverCard(id, s.f("handoff"), s.gp);
    await moverCard(id, s.f("em_execucao"), s.gp);
    expect(await s.entregas(id)).toHaveLength(3);
    expect((await obterCronograma(id))?.entregas).toEqual([]);
  });
});

describe("dados da proposta", () => {
  it("cronogramaSemProposta tira valor, versão e copiaveis, e mantém título e datas", async () => {
    const id = await s.card({ proposta: true });
    await moverCard(id, s.f("em_execucao"), s.gp);
    const [e] = await s.entregas(id);
    await cancelarEntrega(id, e.id, { motivo: "x" }, s.gp);
    const v = cronogramaSemProposta({ ...(await obterCronograma(id))!, copiaveis: 5 });
    expect(v.copiaveis).toBe(0);
    expect(v.entregas[0]).toMatchObject({ titulo: "Entrega final", previsto: "2026-12-10", valor: null, propostaVersao: null });
    expect(v.canceladas[0]).toMatchObject({ titulo: "Diagnóstico", previstoOriginal: "2026-11-20", valor: null, propostaVersao: null });
  });

  it("timelineSemProposta tira a versão da cópia e mantém o evento", () => {
    const [t] = timelineSemProposta([{ tipo: "EXECUCAO", payload: { evento: "cronograma_copiado", versao: 2, entregas: 3, ignoradas: 0 } }]);
    expect(t.payload).toEqual({ evento: "cronograma_copiado", entregas: 3, ignoradas: 0 });
  });
});

describe("quem pode", () => {
  it("GP, gestor sem área ou de projetos e admin operam; o resto não, e nada é gravado", async () => {
    const id = await s.card({ fase: "em_execucao" });
    const gestorDeProjetos = await db.usuario.create({ data: { nome: "Gabi", email: "gabi@ij.test", papel: "GESTOR", area: "PROJETOS" } });
    for (const quem of [s.gp, s.gil, s.adm, gestorDeProjetos]) expect(await registrarCheckin(id, { status: "VERDE", motivo: "ok" }, quem)).toMatchObject({ ok: true });
    const antes = await db.projetoCheckin.count();
    for (const quem of [s.par, s.ana, s.gv, s.vera]) {
      expect(await registrarCheckin(id, { status: "VERDE", motivo: "ok" }, quem)).toEqual({ ok: false, erro: "SEM_PERMISSAO" });
      expect(await adicionarEntrega(id, { titulo: "x", dia: "2026-11-20" }, quem)).toEqual({ ok: false, erro: "SEM_PERMISSAO" });
    }
    expect(await db.projetoCheckin.count()).toBe(antes);
    expect(await s.entregas(id)).toHaveLength(0);
  });

  it("sem GP válido, responde o responsável; trocar o campo Responsável não troca um GP válido", async () => {
    const semGp = await s.card({ fase: "em_execucao", comGp: false, responsavelId: s.ana.id });
    expect(await registrarCheckin(semGp, { status: "VERDE", motivo: "ok" }, s.ana)).toMatchObject({ ok: true });
    expect(await registrarCheckin(semGp, { status: "VERDE", motivo: "ok" }, s.gp)).toEqual({ ok: false, erro: "SEM_PERMISSAO" });

    const comGp = await s.card({ fase: "em_execucao", responsavelId: s.ana.id });
    expect(await registrarCheckin(comGp, { status: "VERDE", motivo: "ok" }, s.ana)).toEqual({ ok: false, erro: "SEM_PERMISSAO" });
    await db.usuario.update({ where: { id: s.gp.id }, data: { ativo: false } });
    expect(await registrarCheckin(comGp, { status: "VERDE", motivo: "ok" }, s.gp)).toEqual({ ok: false, erro: "SEM_PERMISSAO" });
    expect(await registrarCheckin(comGp, { status: "VERDE", motivo: "ok" }, s.ana)).toMatchObject({ ok: true });
  });

  it("papel é relido do banco, não vem da sessão", async () => {
    const id = await s.card({ fase: "em_execucao", comGp: false, responsavelId: s.vera.id });
    expect(await registrarCheckin(id, { status: "VERDE", motivo: "ok" }, { id: s.vera.id, papel: "ADMIN" })).toEqual({ ok: false, erro: "SEM_PERMISSAO" });
  });

  it("fora da Execução é só registro; card na lixeira não existe", async () => {
    const id = await s.card({ proposta: true });
    expect(await registrarCheckin(id, { status: "VERDE", motivo: "ok" }, s.gp)).toEqual({ ok: false, erro: "FORA_DA_EXECUCAO" });
    await moverCard(id, s.f("finalizado"), s.gp);
    const [e] = await s.entregas(id);
    expect(await marcarEntregaFeita(id, e.id, null, s.gp)).toEqual({ ok: false, erro: "FORA_DA_EXECUCAO" });
    const v = await obterCronograma(id);
    expect(v).toMatchObject({ emExecucao: false });
    expect(v?.entregas).toHaveLength(2);

    await moverCard(id, s.f("em_execucao"), s.gp);
    await excluirCard(id, s.gp);
    expect(await registrarCheckin(id, { status: "VERDE", motivo: "ok" }, s.gp)).toEqual({ ok: false, erro: "CARD_NAO_ENCONTRADO" });
    expect(await obterCronograma(id)).toBeNull();
  });
});

describe("check-in", () => {
  it("grava cor, motivo e semana de São Paulo, na Timeline; append-only; o último vale no quadro", async () => {
    const id = await s.card({ fase: "em_execucao" });
    expect(await registrarCheckin(id, { status: "VERDE", motivo: "No prazo" }, s.gp, new Date("2026-11-09T02:30:00Z"))).toMatchObject({ ok: true, semana: "2026-11-02" });
    expect(await registrarCheckin(id, { status: "VERMELHO", motivo: "  Cliente\nsumiu " }, s.gp, new Date("2026-11-09T03:00:00Z"))).toMatchObject({ ok: true, semana: "2026-11-09" });
    expect(await registrarCheckin(id, { status: "VERDE", motivo: "" }, s.gp)).toEqual({ ok: false, erro: "MOTIVO_INVALIDO" });
    expect(await db.projetoCheckin.count({ where: { projetoId: id } })).toBe(2);
    await expect(db.projetoCheckin.updateMany({ data: { motivo: "mexi" } })).rejects.toThrow();

    const t = await db.timeline.findMany({ where: { projetoId: id, tipo: "EXECUCAO" }, orderBy: { em: "asc" } });
    expect(t.at(-1)?.payload).toMatchObject({ evento: "checkin", status: "VERMELHO", motivo: "Cliente sumiu", semana: "2026-11-09" });

    const q = await listarQuadro("projetos");
    expect(q?.cards.find((c) => c.id === id)?.checkins).toMatchObject([{ status: "VERMELHO", motivo: "Cliente sumiu" }]);

    expect(q?.cards.find((c) => c.id === id)?.checkins[0].semana).toBe("2026-11-09");
    await moverCard(id, s.f("handoff"), s.gp);
    expect((await listarQuadro("projetos"))?.cards.find((c) => c.id === id)?.checkins).toEqual([]);
    await moverCard(id, s.f("finalizado"), s.gp);
    expect((await listarQuadro("projetos"))?.cards.find((c) => c.id === id)?.checkins).toEqual([]);
    await moverCard(id, s.f("conclusao"), s.gp);
    expect((await listarQuadro("projetos"))?.cards.find((c) => c.id === id)?.checkins).toHaveLength(1);

    const v = await obterCronograma(id, new Date("2026-11-10T12:00:00Z"));
    expect(v?.checkins.map((c) => c.status)).toEqual(["VERMELHO", "VERDE"]);
    expect(v?.checkinNaSemana).toBe(true);
    expect((await obterCronograma(id, new Date("2026-11-16T12:00:00Z")))?.checkinNaSemana).toBe(false);
  });
});

describe("lembrete de check-in", () => {
  /** Segunda 09/11/2026 de manhã em São Paulo: cobra a semana de 02/11. */
  const SEGUNDA = new Date("2026-11-09T12:00:00Z");
  const ANTES = new Date("2026-10-20T12:00:00Z");
  const avisos = () => db.aviso.findMany({ where: { tipo: "CHECKIN_ATRASADO" } });

  it("avisa só o GP, no app, uma vez por semana e por projeto, por mais rodadas que o cron dê", async () => {
    const id = await s.card({ fase: "em_execucao", execucaoDesde: ANTES });
    expect(await lembrarCheckinsAtrasados(SEGUNDA)).toEqual({ lembretes: 1, refs: [] });
    expect(await lembrarCheckinsAtrasados(new Date(SEGUNDA.getTime() + 600_000))).toEqual({ lembretes: 0, refs: [] });
    expect(await lembrarCheckinsAtrasados(new Date("2026-11-15T12:00:00Z"))).toEqual({ lembretes: 0, refs: [] });
    const [a, ...resto] = await avisos();
    expect(resto).toEqual([]);
    expect(a).toMatchObject({ usuarioId: s.gp.id, projetoId: id, whatsapp: null });
    expect(a.titulo).toContain("02/11/2026");
    // Semana seguinte, ainda sem check-in: um novo.
    expect(await lembrarCheckinsAtrasados(new Date("2026-11-16T12:00:00Z"))).toEqual({ lembretes: 1, refs: [] });
    expect(await avisos()).toHaveLength(2);
  });

  it("check-in na semana cobrada dispensa; check-in só nesta semana não", async () => {
    const com = await s.card({ fase: "em_execucao", execucaoDesde: ANTES });
    await registrarCheckin(com, { status: "VERDE", motivo: "ok" }, s.gp, new Date("2026-11-08T12:00:00Z"));
    const so = await s.card({ fase: "em_execucao", execucaoDesde: ANTES });
    await registrarCheckin(so, { status: "VERDE", motivo: "ok" }, s.gp, new Date("2026-11-09T04:00:00Z"));
    expect(await lembrarCheckinsAtrasados(SEGUNDA)).toEqual({ lembretes: 1, refs: [] });
    expect((await avisos()).map((a) => a.projetoId)).toEqual([so]);
  });

  it("sem spam: já em Execução no deploy só é cobrado depois de ter entrega ou check-in, e a semana da adoção não conta", async () => {
    const id = await s.card({ fase: "em_execucao", comGp: false });
    expect(await lembrarCheckinsAtrasados(SEGUNDA)).toEqual({ lembretes: 0, refs: [] });
    expect(await adicionarEntrega(id, { titulo: "A", dia: "2026-12-01" }, s.gp)).toMatchObject({ ok: true });
    // A adoção foi na quarta 11/11: a semana dela (09/11) não é cobrada, a seguinte (16/11) é.
    await db.projetoEntrega.updateMany({ where: { projetoId: id }, data: { criadoEm: new Date("2026-11-11T12:00:00Z") } });
    expect(await lembrarCheckinsAtrasados(new Date("2026-11-16T12:00:00Z"))).toEqual({ lembretes: 0, refs: [] });
    expect(await lembrarCheckinsAtrasados(new Date("2026-11-23T12:00:00Z"))).toEqual({ lembretes: 1, refs: [] });
    expect((await avisos())[0].usuarioId).toBe(s.gp.id);
  });

  it("a semana da entrada não é cobrada", async () => {
    await s.card({ fase: "em_execucao", execucaoDesde: new Date("2026-11-04T12:00:00Z") });
    expect(await lembrarCheckinsAtrasados(SEGUNDA)).toEqual({ lembretes: 0, refs: [] });
    expect(await lembrarCheckinsAtrasados(new Date("2026-11-16T12:00:00Z"))).toEqual({ lembretes: 1, refs: [] });
  });

  it("entrar pelo movimento conta; sair e voltar recomeça a conta; andar entre subfases não", async () => {
    const id = await s.card();
    await moverCard(id, s.f("em_execucao"), s.gp);
    const desde = (await db.projeto.findUniqueOrThrow({ where: { id } })).execucaoDesde;
    expect(desde).not.toBeNull();
    await db.projeto.update({ where: { id }, data: { execucaoDesde: ANTES } });
    await moverCard(id, s.f("conclusao"), s.gp);
    expect((await db.projeto.findUniqueOrThrow({ where: { id } })).execucaoDesde).toEqual(ANTES);
    await moverCard(id, s.f("handoff"), s.gp);
    await moverCard(id, s.f("em_execucao"), s.gp);
    expect((await db.projeto.findUniqueOrThrow({ where: { id } })).execucaoDesde?.getTime()).toBeGreaterThan(ANTES.getTime());
  });

  it("lixeira: o tempo lá não é cobrado, também para quem é acompanhado só por ter entrega ou check-in", async () => {
    const comEntrega = await s.card({ fase: "em_execucao" });
    await adicionarEntrega(comEntrega, { titulo: "A", dia: "2026-12-01" }, s.gp);
    await db.projetoEntrega.updateMany({ where: { projetoId: comEntrega }, data: { criadoEm: ANTES } });
    const comCheckin = await s.card({ fase: "em_execucao" });
    await registrarCheckin(comCheckin, { status: "VERDE", motivo: "ok" }, s.gp, ANTES);
    const nunca = await s.card({ fase: "em_execucao" });
    const soCancelada = await s.card({ fase: "em_execucao" });
    const c = await adicionarEntrega(soCancelada, { titulo: "Engano", dia: "2026-12-01" }, s.gp);
    if (!c.ok) throw new Error(c.erro);
    await cancelarEntrega(soCancelada, c.entregaId, { motivo: "Engano" }, s.gp);
    const comData = await s.card({ fase: "em_execucao", execucaoDesde: ANTES });
    for (const id of [comEntrega, comCheckin, nunca, soCancelada, comData]) {
      await excluirCard(id, s.gp);
      expect(await restaurarCard(id, s.gil)).toMatchObject({ ok: true });
    }
    const desde = async (id: string) => (await db.projeto.findUniqueOrThrow({ where: { id } })).execucaoDesde;
    for (const id of [comEntrega, comCheckin, comData]) expect((await desde(id))?.getTime()).toBeGreaterThan(ANTES.getTime());
    expect(await desde(nunca)).toBeNull();
    expect(await desde(soCancelada)).toBeNull();
    // Restaurados agora: a semana cobrada logo depois é a da restauração ou anterior, que não conta.
    const proximaSegunda = new Date(Date.now() + 7 * 24 * 3600_000);
    expect(await lembrarCheckinsAtrasados(proximaSegunda)).toEqual({ lembretes: 0, refs: [] });
    expect(await db.aviso.count({ where: { tipo: "CHECKIN_ATRASADO" } })).toBe(0);
  });

  it("entrega cancelada não conta como acompanhamento", async () => {
    const id = await s.card({ fase: "em_execucao" });
    const r = await adicionarEntrega(id, { titulo: "A", dia: "2026-12-01" }, s.gp);
    if (!r.ok) throw new Error("seed");
    await cancelarEntrega(id, r.entregaId, { motivo: "Engano" }, s.gp);
    await db.projetoEntrega.updateMany({ where: { projetoId: id }, data: { criadoEm: ANTES } });
    expect(await lembrarCheckinsAtrasados(SEGUNDA)).toEqual({ lembretes: 0, refs: [] });
  });

  it("fora de Execução, na lixeira ou em terminal não lembra", async () => {
    await s.card({ fase: "handoff", execucaoDesde: ANTES });
    await s.card({ fase: "finalizado", execucaoDesde: ANTES });
    const lixo = await s.card({ fase: "em_execucao", execucaoDesde: ANTES });
    await db.projeto.update({ where: { id: lixo }, data: { deletadoEm: new Date() } });
    expect(await lembrarCheckinsAtrasados(SEGUNDA)).toEqual({ lembretes: 0, refs: [] });
  });

  it("sem GP válido vai ao responsável; sem ninguém ativo não marca, e lembra quando houver", async () => {
    const id = await s.card({ fase: "em_execucao", execucaoDesde: ANTES, comGp: false, responsavelId: s.ana.id });
    await db.usuario.update({ where: { id: s.ana.id }, data: { ativo: false } });
    expect(await lembrarCheckinsAtrasados(SEGUNDA)).toEqual({ lembretes: 0, refs: [] });
    expect(await db.lembreteCheckin.count()).toBe(0);
    await db.usuario.update({ where: { id: s.ana.id }, data: { ativo: true } });
    expect(await lembrarCheckinsAtrasados(SEGUNDA)).toEqual({ lembretes: 1, refs: [] });
    expect((await avisos())[0]).toMatchObject({ usuarioId: s.ana.id, projetoId: id });
  });
});
