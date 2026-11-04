// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { invalidarCachePipelines } from "@/lib/fases/cache";
import { dbTeste, limparBanco } from "@/test/db";
import { executarFerramenta, FERRAMENTAS, SO_LEITURA } from "./ferramentas";
import type { UsuarioMcp } from "./oauth";

const db = dbTeste();
const texto = (r: { content: unknown[] }) => (r.content[0] as { text: string }).text;
const dados = (r: { content: unknown[] }) => JSON.parse(texto(r));

async function semear() {
  const projetos = await db.pipeline.create({
    data: {
      chave: "projetos",
      nome: "Projetos",
      ordem: 1,
      fases: {
        create: [
          { chave: "handoff", nome: "Handoff", ordem: 0, marco: "HANDOFF" },
          { chave: "em_execucao", nome: "Em execução", ordem: 1, marco: "EXECUCAO" },
          { chave: "finalizado", nome: "Finalizado", ordem: 2, isTerminal: true, tipoTerminal: "GANHO", marco: "FINALIZADO" },
          { chave: "perdido", nome: "Perdido", ordem: 3, isTerminal: true, tipoTerminal: "PERDIDO" },
        ],
      },
    },
    include: { fases: true },
  });
  const pessoa = async (nome: string, papel: "PROJETOS" | "VENDEDOR" | "VISUALIZADOR", area?: "PROJETOS" | "VENDAS"): Promise<UsuarioMcp> => {
    const u = await db.usuario.create({ data: { nome, email: `${nome.toLowerCase()}@ij.test`, papel, area } });
    return { id: u.id, nome: u.nome, papel: u.papel, area: u.area, cargos: u.cargos };
  };
  const pedro = await pessoa("Pedro", "PROJETOS", "PROJETOS");
  const paula = await pessoa("Paula", "PROJETOS", "PROJETOS");
  const vera = await pessoa("Vera", "VISUALIZADOR");
  const c = await db.projeto.create({
    data: { pipelineId: projetos.id, faseId: projetos.fases.find((f) => f.chave === "handoff")!.id, titulo: "Site", responsavelId: pedro.id, criadoVia: "UI", isentoTravaContrato: true, isentoTravaHandoff: true },
  });
  const p = await db.proposta.create({ data: { projetoId: c.id, status: "ACEITA", criadoPorId: pedro.id, versaoEnviada: 1 } });
  await db.propostaVersao.create({ data: { propostaId: p.id, numero: 1, conteudoMd: "", estruturado: { entregas: [{ titulo: "Diagnóstico", dia: "2026-11-20", valor: null }] }, autorId: pedro.id } });
  return { id: c.id, pedro, paula, vera };
}

let s: Awaited<ReturnType<typeof semear>>;

beforeEach(async () => {
  await limparBanco(["aviso", "proposta", "projeto_handoff", "transicao_fase", "timeline", "oportunidade", "fase", "pipeline", "usuario"]);
  invalidarCachePipelines();
  vi.spyOn(console, "info").mockImplementation(() => {});
  s = await semear();
});

describe("ferramentas de execução (GAB-95)", () => {
  it("estão no catálogo; ver_cronograma é leitura, as outras escrevem", () => {
    const por = new Map(FERRAMENTAS.map((f) => [f.nome, f]));
    expect(por.get("ver_cronograma")?.escrita).toBe(false);
    for (const n of ["marcar_entrega", "ajustar_data_entrega", "adicionar_entrega", "copiar_cronograma_proposta", "registrar_checkin", "cancelar_entrega"]) expect(por.get(n)?.escrita).toBe(true);
  });

  it("mover_para_execucao copia; ver, marcar, ajustar e check-in usam o mesmo serviço e saem via MCP na Timeline", async () => {
    expect((await executarFerramenta("mover_para_execucao", { id: s.id }, s.pedro)).isError).toBeUndefined();
    const v = dados(await executarFerramenta("ver_cronograma", { id: s.id }, s.pedro));
    expect(v).toMatchObject({ em_execucao: true, pode_operar: true, gp: { nome: "Pedro" }, gp_designado: false, copiaveis: 0 });
    expect(v.entregas).toMatchObject([{ titulo: "Diagnóstico", previsto_original: "2026-11-20", previsto: "2026-11-20", realizado: null, origem: "PROPOSTA", proposta_versao: 1 }]);
    const entrega_id = v.entregas[0].id;

    expect(dados(await executarFerramenta("ajustar_data_entrega", { id: s.id, entrega_id, dia: "2026-11-27", motivo: "Atraso" }, s.pedro))).toEqual({ mudou: true });
    expect(dados(await executarFerramenta("marcar_entrega", { id: s.id, entrega_id, dia: "2026-11-02" }, s.pedro))).toEqual({ mudou: true, realizado: "2026-11-02" });
    expect(dados(await executarFerramenta("marcar_entrega", { id: s.id, entrega_id, feita: false }, s.pedro))).toEqual({ mudou: true, realizado: null });
    expect(dados(await executarFerramenta("registrar_checkin", { id: s.id, status: "AMARELO", motivo: "Atenção ao prazo" }, s.pedro))).toMatchObject({ semana: expect.any(String) });
    expect(dados(await executarFerramenta("adicionar_entrega", { id: s.id, titulo: "Extra", dia: "2026-12-01", valor: "10,00" }, s.pedro))).toMatchObject({ entrega_id: expect.any(String) });

    const depois = dados(await executarFerramenta("ver_cronograma", { id: s.id }, s.paula));
    expect(depois.pode_operar).toBe(false);
    expect(depois.entregas[0]).toMatchObject({ previsto_original: "2026-11-20", previsto: "2026-11-27", ajustes: [{ de: "2026-11-20", para: "2026-11-27", motivo: "Atraso", por: "Pedro" }] });
    expect(depois.checkins).toMatchObject([{ status: "AMARELO", motivo: "Atenção ao prazo", por: "Pedro" }]);

    const t = await db.timeline.findMany({ where: { projetoId: s.id, tipo: "EXECUCAO" }, orderBy: [{ em: "asc" }, { id: "asc" }] });
    expect(t.map((x) => (x.payload as { evento: string }).evento)).toEqual(["cronograma_copiado", "data_ajustada", "entrega_feita", "entrega_desmarcada", "checkin", "entrega_adicionada"]);
    expect(t.every((x) => x.viaMcp)).toBe(true);
  });

  it("copiar_cronograma_proposta copia uma vez para quem já está em Execução", async () => {
    const ex = await db.fase.findUniqueOrThrow({ where: { marco: "EXECUCAO" } });
    await db.projeto.update({ where: { id: s.id }, data: { faseId: ex.id } });
    expect(dados(await executarFerramenta("ver_cronograma", { id: s.id }, s.pedro)).copiaveis).toBe(1);
    expect(dados(await executarFerramenta("copiar_cronograma_proposta", { id: s.id }, s.pedro))).toEqual({ entregas: 1 });
    const de_novo = await executarFerramenta("copiar_cronograma_proposta", { id: s.id }, s.pedro);
    expect(de_novo.isError).toBe(true);
    expect(texto(de_novo)).toContain("já tem cronograma");
  });

  it("permissão é a da tela: colega lê e não opera; visualizador lê e é barrado antes do serviço", async () => {
    await executarFerramenta("mover_para_execucao", { id: s.id }, s.pedro);
    const r = await executarFerramenta("registrar_checkin", { id: s.id, status: "VERDE", motivo: "ok" }, s.paula);
    expect(r.isError).toBe(true);
    expect(texto(r)).toContain("Só o GP do projeto");
    expect(dados(await executarFerramenta("ver_cronograma", { id: s.id }, s.vera)).pode_operar).toBe(false);
    const v = await executarFerramenta("registrar_checkin", { id: s.id, status: "VERDE", motivo: "ok" }, s.vera);
    expect(texto(v)).toBe(SO_LEITURA);
    expect(await db.projetoCheckin.count()).toBe(0);
  });

  it("quem não vê a proposta: título e datas abertos; valor, versão, copiaveis e a cópia, não", async () => {
    const ex = await db.fase.findUniqueOrThrow({ where: { marco: "EXECUCAO" } });
    await db.projeto.update({ where: { id: s.id }, data: { faseId: ex.id } });
    // Paula é da área, mas não está escalada; Pedro é o responsável.
    const antes = dados(await executarFerramenta("ver_cronograma", { id: s.id }, s.paula));
    expect(antes.copiaveis).toBe(0);
    const recusa = await executarFerramenta("copiar_cronograma_proposta", { id: s.id }, s.paula);
    expect(texto(recusa)).toContain("não tem acesso a esta proposta");
    expect(dados(await executarFerramenta("ver_cronograma", { id: s.id }, s.pedro)).copiaveis).toBe(1);
    await db.propostaVersao.deleteMany();
    const p = await db.proposta.findUniqueOrThrow({ where: { projetoId: s.id } });
    await db.propostaVersao.create({ data: { propostaId: p.id, numero: 1, conteudoMd: "", estruturado: { entregas: [{ titulo: "Diagnóstico", dia: "2026-11-20", valor: "1000.00" }] }, autorId: s.pedro.id } });
    await executarFerramenta("copiar_cronograma_proposta", { id: s.id }, s.pedro);

    const dono = dados(await executarFerramenta("ver_cronograma", { id: s.id }, s.pedro));
    expect(dono.entregas[0]).toMatchObject({ valor: "1000.00", proposta_versao: 1 });
    const fora = dados(await executarFerramenta("ver_cronograma", { id: s.id }, s.paula));
    expect(fora.entregas[0]).toMatchObject({ titulo: "Diagnóstico", previsto_original: "2026-11-20", valor: null, proposta_versao: null });

    const timelineDe = async (eu: UsuarioMcp) => dados(await executarFerramenta("ler_projeto", { id: s.id }, eu)).timeline as { tipo: string; payload?: { evento?: string; versao?: number; entregas?: number } }[];
    const copia = (l: Awaited<ReturnType<typeof timelineDe>>) => JSON.stringify(l.filter((t) => JSON.stringify(t).includes("cronograma_copiado")));
    expect(copia(await timelineDe(s.pedro))).toContain('"versao":1');
    const vista = copia(await timelineDe(s.paula));
    expect(vista).toContain("cronograma_copiado");
    expect(vista).not.toContain("versao");
  });

  it("cancelar_entrega: fora do cronograma ativo, na Timeline via MCP; não volta", async () => {
    await executarFerramenta("mover_para_execucao", { id: s.id }, s.pedro);
    const v = dados(await executarFerramenta("ver_cronograma", { id: s.id }, s.pedro));
    const entrega_id = v.entregas[0].id;
    expect(dados(await executarFerramenta("cancelar_entrega", { id: s.id, entrega_id, motivo: "Fora do combinado" }, s.pedro))).toEqual({ mudou: true });
    const depois = dados(await executarFerramenta("ver_cronograma", { id: s.id }, s.pedro));
    expect(depois.entregas).toEqual([]);
    expect(depois.canceladas).toMatchObject([{ titulo: "Diagnóstico", motivo: "Fora do combinado" }]);
    expect(depois.copiaveis).toBe(0);
    const r = await executarFerramenta("marcar_entrega", { id: s.id, entrega_id }, s.pedro);
    expect(texto(r)).toContain("foi cancelada");
    const t = await db.timeline.findFirstOrThrow({ where: { projetoId: s.id, tipo: "EXECUCAO" }, orderBy: [{ em: "desc" }, { id: "desc" }] });
    expect(t).toMatchObject({ viaMcp: true, payload: { evento: "entrega_cancelada", motivo: "Fora do combinado" } });
  });

  it("argumento inválido é recusado pela porta única", async () => {
    const r = await executarFerramenta("registrar_checkin", { id: s.id, status: "AZUL", motivo: "ok" }, s.pedro);
    expect(r.isError).toBe(true);
    expect(texto(r)).toContain("status");
  });
});
