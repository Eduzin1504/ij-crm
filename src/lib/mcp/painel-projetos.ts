/**
 * Ferramentas MCP do painel de projetos (GAB-96): uma por indicador, só leitura, com os mesmos
 * números da tela `/painel/projetos`, porque chamam o mesmo serviço. A execução é aberta a todos,
 * como `ver_cronograma`; o tempo com a caneta vem das propostas e tem guarda.
 */
import { z } from "zod";
import { DEFINICOES_PROJETOS, VISIBILIDADE_PAINEL_PROJETOS, type IndicadorProjetos } from "@/lib/painel/definicoes";
import { carregarCanetaPara, carregarExecucaoProjetos, pessoaDoFiltro, type FiltroProjetos } from "@/lib/painel/projetos-servico";
import { resolverPeriodo } from "@/lib/ranking/periodo";
import type { Ferramenta, Resposta } from "./ferramentas";
import { canetaDoPainelVisivel } from "./guardas";
import type { UsuarioMcp } from "./oauth";
import { urlBase } from "./url";

type Forma = z.ZodRawShape;
const ferramenta = <F extends Forma>(f: Ferramenta<F>) => f as unknown as Ferramenta;
const ok = (dados: unknown): Resposta => ({ ok: true, dados });

const PERIODO = {
  periodo: z.enum(["semana", "mes"]).optional().describe("padrão: mes"),
  ref: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "use AAAA-MM-DD").optional().describe("um dia (AAAA-MM-DD) do período; padrão: hoje"),
};
const pessoaId = z.string().min(1).max(64);
const ENTRADA = { ...PERIODO, gp_id: pessoaId.optional().describe('id do GP do projeto, ou "eu"') };

type ArgsFiltro = { periodo?: "semana" | "mes"; ref?: string };

/** Período e pessoa do pedido. Pessoa desconhecida vira erro aqui; na tela, some o filtro. */
async function lerFiltro(a: ArgsFiltro, id: string | undefined, eu: UsuarioMcp, agora: Date): Promise<{ ok: true; filtro: FiltroProjetos } | { ok: false; resposta: Resposta }> {
  const gpId = id === "eu" ? eu.id : (id ?? null);
  if (gpId && !(await pessoaDoFiltro(gpId))) return { ok: false, resposta: { ok: false, erro: "Pessoa não encontrada. Use listar_responsaveis para ver os ids." } };
  return { ok: true, filtro: { periodo: resolverPeriodo(a.periodo ?? "mes", a.ref, agora), gpId } };
}

/** O que vai em toda resposta: o período, a fórmula do indicador e o link da mesma visão na tela. */
function moldura({ periodo, gpId }: FiltroProjetos, indicador: IndicadorProjetos) {
  const q = new URLSearchParams({ periodo: periodo.tipo, ref: periodo.primeiroDia, ...(gpId ? { gp: gpId } : {}) });
  return {
    periodo: { tipo: periodo.tipo, rotulo: periodo.rotulo, primeiroDia: periodo.primeiroDia, ultimoDia: periodo.ultimoDia, atual: periodo.atual },
    definicoes: { [indicador]: DEFINICOES_PROJETOS[indicador], visibilidade: VISIBILIDADE_PAINEL_PROJETOS },
    tela: `${urlBase()}/painel/projetos?${q.toString()}`,
  };
}

const consultarExecucao = ferramenta({
  nome: "consultar_execucao_projetos",
  titulo: "Consultar a execução dos projetos",
  descricao:
    "O projeto está andando de acordo com a proposta? Os MESMOS números da tela /painel/projetos: para cada projeto em execução, entregas previstas × feitas no período, atrasadas, atraso acumulado em dias frente ao previsto original, ajustes e status do último check-in. Projeto migrado sem cronograma vem com semPrevisto=true. Finalizados e perdidos no período só aparecem em encerrados, fora das contas. Filtro opcional por GP (id ou \"eu\"). Sem valor da proposta. A resposta traz `definicoes` com as fórmulas.",
  escrita: false,
  entrada: ENTRADA,
  executar: async (a, eu) => {
    const agora = new Date();
    const f = await lerFiltro(a, a.gp_id, eu, agora);
    if (!f.ok) return f.resposta;
    const e = await carregarExecucaoProjetos(f.filtro, agora);
    return ok({ totais: e.totais, projetos: e.projetos, encerrados: e.encerrados, gps: e.gps, ...moldura(f.filtro, "execucao") });
  },
});

const listarAtrasados = ferramenta({
  nome: "listar_projetos_atrasados",
  titulo: "Listar os projetos atrasados",
  descricao:
    "Quais projetos estão atrasados? Projetos em execução com entrega pendente vencida, do mais atrasado para o menos, com os mesmos números da tela /painel/projetos. semPrevisto conta à parte os migrados sem cronograma, que não têm como atrasar. Filtro opcional por GP (id ou \"eu\").",
  escrita: false,
  entrada: ENTRADA,
  executar: async (a, eu) => {
    const agora = new Date();
    const f = await lerFiltro(a, a.gp_id, eu, agora);
    if (!f.ok) return f.resposta;
    const e = await carregarExecucaoProjetos(f.filtro, agora);
    return ok({ comAtraso: e.totais.comAtraso, entregasAtrasadas: e.totais.atrasadas, atrasoDias: e.totais.atrasoDias, semPrevisto: e.totais.semPrevisto, atrasados: e.atrasados, ...moldura(f.filtro, "atrasados") });
  },
});

const listarEmAlerta = ferramenta({
  nome: "listar_projetos_em_alerta",
  titulo: "Listar os projetos em alerta",
  descricao:
    "Quais projetos estão no vermelho ou no amarelo, e quais estão sem check-in na semana? Pelo último check-in de cada projeto em execução e pela semana corrente (segunda a domingo de São Paulo), com os mesmos números da tela /painel/projetos. Filtro opcional por GP (id ou \"eu\").",
  escrita: false,
  entrada: ENTRADA,
  executar: async (a, eu) => {
    const agora = new Date();
    const f = await lerFiltro(a, a.gp_id, eu, agora);
    if (!f.ok) return f.resposta;
    const e = await carregarExecucaoProjetos(f.filtro, agora);
    return ok({ vermelhos: e.alertas.vermelhos, amarelos: e.alertas.amarelos, semCheckin: e.alertas.semCheckin, ...moldura(f.filtro, "alertas") });
  },
});

const consultarCaneta = ferramenta({
  nome: "consultar_tempo_caneta_proposta",
  titulo: "Consultar o tempo com a caneta",
  descricao:
    "Com quem a caneta das propostas está parada? Por pessoa: propostas paradas agora, a mais antiga e a média em dias, tempo com a caneta no período, e as mais paradas; também as propostas em curso sem ninguém com a caneta. Os mesmos números da tela /painel/projetos. Vem das propostas: GP, gestão e admin veem todas; os demais, só as propostas em que estão escalados e, com o ranking oculto, só as próprias linhas (`visao` diz qual). Filtro opcional por pessoa (id ou \"eu\").",
  escrita: false,
  guarda: canetaDoPainelVisivel,
  entrada: { ...PERIODO, pessoa_id: pessoaId.optional().describe('id da pessoa, ou "eu"') },
  executar: async (a, eu) => {
    const agora = new Date();
    const f = await lerFiltro(a, a.pessoa_id, eu, agora);
    if (!f.ok) return f.resposta;
    const v = await carregarCanetaPara(eu, f.filtro, agora);
    if (!v) return { ok: false, erro: "Você não tem acesso às propostas: o tempo com a caneta vem delas." };
    return ok({ visao: v.visao, ...v.caneta, ...moldura(f.filtro, "caneta") });
  },
});

export const FERRAMENTAS_PAINEL_PROJETOS: readonly Ferramenta[] = [consultarExecucao, listarAtrasados, listarEmAlerta, consultarCaneta];
