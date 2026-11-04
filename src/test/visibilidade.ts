/**
 * Cenário dos testes de matriz papel × área (GAB-98): os dois quadros, uma pessoa de
 * cada tipo e um card de cada área, de responsáveis que não estão na matriz.
 */
import type { Area, Cargo, Papel } from "@prisma/client";
import { invalidarCachePipelines } from "@/lib/fases/cache";
import { dbTeste, limparBanco } from "./db";

export const TABELAS = ["aviso", "prazo", "anexo", "proposta_comentario", "proposta_caneta", "proposta_versao", "proposta", "transicao_fase", "timeline", "oportunidade", "fase", "pipeline", "empresa", "contato", "mcp_conexao", "oauth_cliente", "sessao", "usuario"];

export type Persona = { id: string; nome: string; papel: Papel; area: Area | null; cargos: Cargo[] };

export async function semearVisibilidade() {
  const db = dbTeste();
  await limparBanco(TABELAS);
  invalidarCachePipelines();
  const vendas = await db.pipeline.create({
    data: {
      chave: "vendas",
      nome: "Vendas",
      ordem: 0,
      fases: {
        create: [
          { chave: "primeiro_contato", nome: "Primeiro Contato", ordem: 0 },
          { chave: "em_negociacao", nome: "Em negociação", ordem: 1 },
          { chave: "montando", nome: "Montando contrato", ordem: 2, marco: "MONTANDO_CONTRATO" },
          { chave: "ganho", nome: "Ganho", ordem: 3, isTerminal: true, tipoTerminal: "GANHO", marco: "GANHO" },
          { chave: "perdido", nome: "Perdido", ordem: 4, isTerminal: true, tipoTerminal: "PERDIDO", marco: "PERDIDO" },
        ],
      },
    },
    include: { fases: { orderBy: { ordem: "asc" } } },
  });
  const projetos = await db.pipeline.create({
    data: {
      chave: "projetos",
      nome: "Projetos",
      ordem: 1,
      fases: {
        create: [
          { chave: "handoff", nome: "Handoff", ordem: 0, marco: "HANDOFF" },
          { chave: "execucao", nome: "Execução", ordem: 1 },
        ],
      },
    },
    include: { fases: { orderBy: { ordem: "asc" } } },
  });
  const pessoa = async (nome: string, papel: Papel, area: Area | null, cargos: Cargo[] = []): Promise<Persona> => {
    const u = await db.usuario.create({ data: { nome, email: `${nome.toLowerCase().replace(/\s/g, ".")}@ij.test`, papel, area, cargos } });
    return { id: u.id, nome: u.nome, papel: u.papel, area: u.area, cargos: u.cargos };
  };
  const p = {
    donoV: await pessoa("Dona Vendas", "VENDEDOR", "VENDAS"),
    donoP: await pessoa("Dono Projetos", "PROJETOS", "PROJETOS"),
    vendedor: await pessoa("Vendedor", "VENDEDOR", "VENDAS"),
    gpVendas: await pessoa("GP Vendas", "VENDEDOR", "VENDAS", ["GP"]),
    membroProjetos: await pessoa("Membro Projetos", "PROJETOS", "PROJETOS"),
    gpProjetos: await pessoa("GP Projetos", "PROJETOS", "PROJETOS", ["GP"]),
    gestorVendas: await pessoa("Gestor Vendas", "GESTOR", "VENDAS"),
    gestorProjetos: await pessoa("Gestor Projetos", "GESTOR", "PROJETOS"),
    gestorSemArea: await pessoa("Gestor Sem Area", "GESTOR", null),
    admin: await pessoa("Admin", "ADMIN", null),
    visualizador: await pessoa("Visualizador", "VISUALIZADOR", null),
  };
  const fase = (chave: string) => [...vendas.fases, ...projetos.fases].find((f) => f.chave === chave)!;
  const card = (titulo: string, quadro: "vendas" | "projetos", responsavelId: string, faseChave?: string) =>
    db.projeto.create({
      data: {
        titulo,
        pipelineId: quadro === "vendas" ? vendas.id : projetos.id,
        faseId: fase(faseChave ?? (quadro === "vendas" ? "primeiro_contato" : "handoff")).id,
        responsavelId,
        criadoVia: "UI",
      },
    });
  const cardV = await card("Card de Vendas", "vendas", p.donoV.id);
  const cardP = await card("Card de Projetos", "projetos", p.donoP.id);
  return { db, vendas, projetos, p, fase, card, cardV, cardP };
}

export type Mundo = Awaited<ReturnType<typeof semearVisibilidade>>;
export type NomePersona = keyof Mundo["p"];

/** O esperado de cada pessoa da matriz (fora os responsáveis, testados à parte). */
export const MATRIZ: { nome: NomePersona; escreve: boolean; editaVendas: boolean; editaProjetos: boolean; veTabela: boolean; veAgendas: boolean; todasPropostas: boolean }[] = [
  { nome: "vendedor", escreve: true, editaVendas: true, editaProjetos: false, veTabela: true, veAgendas: false, todasPropostas: false },
  { nome: "gpVendas", escreve: true, editaVendas: true, editaProjetos: false, veTabela: true, veAgendas: false, todasPropostas: true },
  { nome: "membroProjetos", escreve: true, editaVendas: false, editaProjetos: true, veTabela: false, veAgendas: false, todasPropostas: false },
  { nome: "gpProjetos", escreve: true, editaVendas: false, editaProjetos: true, veTabela: false, veAgendas: false, todasPropostas: true },
  { nome: "gestorVendas", escreve: true, editaVendas: true, editaProjetos: false, veTabela: true, veAgendas: true, todasPropostas: true },
  { nome: "gestorProjetos", escreve: true, editaVendas: false, editaProjetos: true, veTabela: false, veAgendas: true, todasPropostas: true },
  { nome: "gestorSemArea", escreve: true, editaVendas: true, editaProjetos: true, veTabela: true, veAgendas: true, todasPropostas: true },
  { nome: "admin", escreve: true, editaVendas: true, editaProjetos: true, veTabela: true, veAgendas: true, todasPropostas: true },
  { nome: "visualizador", escreve: false, editaVendas: false, editaProjetos: false, veTabela: false, veAgendas: false, todasPropostas: false },
];
