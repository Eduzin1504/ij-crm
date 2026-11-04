/**
 * Painel de vendas (GAB-94), leitura no servidor. Uma consulta agregada por
 * indicador (rodam em paralelo; nada de N+1); o cálculo é puro (`calculo.ts`).
 * Tela (`/painel`) e MCP (`consultar_painel_vendas`) chamam ESTAS funções, então
 * os números são os mesmos.
 *
 * Cards considerados (como no ranking, GAB-44/GAB-81): vivos — fora da
 * lixeira (`deletado_em`) e que não são casca absorvida pelo ciclo único
 * (`absorvido_por_id`) — que estão em Vendas ou passaram por ele. Timestamps
 * comparados em UTC explícito (`utc`), sem depender da TimeZone da sessão.
 *
 * Visibilidade (decisão do usuário na revisão do PR #54): o painel segue a
 * regra do painel (`podeVerPainelCompleto`, "Mostrar ranking aos vendedores").
 * Quem o ranking esconde vê só as próprias linhas e os totais do time; pedir o
 * filtro de outra pessoa é recusado (`carregarPainelPara`) — tela e MCP.
 */
import type { Papel, PrismaClient } from "@prisma/client";
import { db } from "@/lib/db";
import { utc } from "@/lib/sql-utc";
import { FUSO_NEGOCIO } from "@/lib/projetos/aging";
import { avaliacoesPorVendedor } from "@/lib/projetos/avaliacao-consulta";
import { carregarDados, listarParticipantes, obterConfigRanking, podeVerPainelCompleto, QUADRO_VENDAS } from "@/lib/ranking/servico";
import type { Periodo } from "@/lib/ranking/periodo";
import {
  montarAcompanhamento,
  montarConversao,
  montarEngajamento,
  montarSatisfacao,
  type Acompanhamento,
  type CardAberto,
  type Conversao,
  type Engajamento,
  type FaseVendas,
  type LinhaFluxo,
  type LinhaInteracoes,
  type Pessoa,
  type Satisfacao,
} from "./calculo";

/** Quem pode rodar a consulta: o `db` ou uma transação (testes fixam o fuso da sessão nela). */
type Consultor = Pick<PrismaClient, "$queryRaw">;

export const INDICADORES = ["conversao", "engajamento", "acompanhamento", "satisfacao"] as const;
export type Indicador = (typeof INDICADORES)[number];

export type FiltroPainel = { periodo: Periodo; vendedorId: string | null };

/** Transições "de gente" (mesma regra do ranking: SISTEMA e IMPORT não contam como movimento). */
const ORIGENS_GENTE = ["UI", "WHATSAPP"];

/**
 * Fluxo por fase aberta de Vendas, por dono do card (vendedor que vendeu, se o
 * card já foi para Projetos; senão o responsável):
 * - ENTRADA: cards distintos que entraram na fase no período (criação conta);
 * - SAIDA: saídas da fase no período, classificadas pelo destino, e a duração
 *   da estadia (desde a transição imediatamente anterior, se ela entrou nesta
 *   mesma fase — `LAG` sobre o histórico do card).
 */
export async function carregarFluxo({ inicio, fim }: { inicio: Date; fim: Date }, cliente: Consultor = db): Promise<LinhaFluxo[]> {
  const ini = utc(inicio);
  const ate = utc(fim);
  return cliente.$queryRaw<LinhaFluxo[]>`
    WITH vendas AS (SELECT id FROM pipeline WHERE chave = ${QUADRO_VENDAS}),
    fv AS (SELECT id FROM fase WHERE pipeline_id IN (SELECT id FROM vendas)),
    vivos AS (
      SELECT o.id,
             CASE WHEN o.pipeline_id IN (SELECT id FROM vendas) THEN o.responsavel_id ELSE COALESCE(o.vendedor_id, o.responsavel_id) END AS dono
        FROM oportunidade o
       WHERE o.deletado_em IS NULL AND o.absorvido_por_id IS NULL
         AND (o.pipeline_id IN (SELECT id FROM vendas)
              OR EXISTS (SELECT 1 FROM transicao_fase t WHERE t.oportunidade_id = o.id AND t.para_fase_id IN (SELECT id FROM fv)))
    ),
    saidas AS (
      SELECT DISTINCT t.oportunidade_id FROM transicao_fase t JOIN vivos o ON o.id = t.oportunidade_id
       WHERE t.em >= ${ini} AND t.em < ${ate} AND t.de_fase_id IN (SELECT id FROM fv)
    ),
    seq AS (
      SELECT t.oportunidade_id, t.de_fase_id, t.para_fase_id, t.origem, t.em,
             LAG(t.para_fase_id) OVER w AS fase_anterior, LAG(t.em) OVER w AS entrou_em
        FROM transicao_fase t
       WHERE t.oportunidade_id IN (SELECT oportunidade_id FROM saidas) AND t.em < ${ate}
      WINDOW w AS (PARTITION BY t.oportunidade_id ORDER BY t.em, t.id)
    )
    SELECT 'SAIDA' AS tipo, df.id AS "faseId", df.nome AS "faseNome", df.ordem AS "faseOrdem", o.dono AS "donoId",
           0 AS entradas,
           COUNT(*) FILTER (WHERE pf.tipo_terminal IS DISTINCT FROM 'PERDIDO'
                              AND (pf.tipo_terminal = 'GANHO' OR pf.pipeline_id <> df.pipeline_id OR pf.ordem > df.ordem))::int AS avancos,
           COUNT(*) FILTER (WHERE pf.tipo_terminal = 'PERDIDO')::int AS perdas,
           COUNT(*) FILTER (WHERE pf.tipo_terminal IS NULL AND pf.pipeline_id = df.pipeline_id AND pf.ordem <= df.ordem)::int AS recuos,
           COALESCE(SUM(EXTRACT(EPOCH FROM s.em - s.entrou_em)) FILTER (WHERE s.fase_anterior = s.de_fase_id), 0)::float8 / 86400 AS "somaDias",
           COUNT(*) FILTER (WHERE s.fase_anterior = s.de_fase_id)::int AS estadias
      FROM seq s JOIN vivos o ON o.id = s.oportunidade_id
      JOIN fase df ON df.id = s.de_fase_id JOIN fase pf ON pf.id = s.para_fase_id
     WHERE s.em >= ${ini} AND s.origem::text IN (${ORIGENS_GENTE[0]}, ${ORIGENS_GENTE[1]})
       AND df.id IN (SELECT id FROM fv) AND NOT df.is_terminal
     GROUP BY df.id, df.nome, df.ordem, o.dono
    UNION ALL
    SELECT 'ENTRADA', pf.id, pf.nome, pf.ordem, o.dono, COUNT(DISTINCT t.oportunidade_id)::int, 0, 0, 0, 0, 0
      FROM transicao_fase t JOIN vivos o ON o.id = t.oportunidade_id JOIN fase pf ON pf.id = t.para_fase_id
     WHERE t.em >= ${ini} AND t.em < ${ate} AND t.origem::text IN (${ORIGENS_GENTE[0]}, ${ORIGENS_GENTE[1]})
       AND pf.id IN (SELECT id FROM fv) AND NOT pf.is_terminal
     GROUP BY pf.id, pf.nome, pf.ordem, o.dono`;
}

/**
 * Interações e próximas ações feitas no período, por quem registrou, só
 * enquanto o card estava em Vendas (como as ações do ranking). Mensagem `#crm`
 * conta para quem MANDOU (`remetente_usuario_id`; cobre a "Resolver
 * manualmente"). "No prazo": dia (SP) em que foi marcada feita ≤ dia marcado.
 */
export async function carregarInteracoes({ inicio, fim }: { inicio: Date; fim: Date }, cliente: Consultor = db): Promise<LinhaInteracoes[]> {
  return cliente.$queryRaw<LinhaInteracoes[]>`
    WITH vendas AS (SELECT id FROM pipeline WHERE chave = ${QUADRO_VENDAS}),
    fv AS (SELECT id FROM fase WHERE pipeline_id IN (SELECT id FROM vendas)),
    vivos AS (
      SELECT o.id, (o.pipeline_id IN (SELECT id FROM vendas)) AS em_vendas,
             (SELECT min(t.em) FROM transicao_fase t WHERE t.oportunidade_id = o.id AND t.para_fase_id NOT IN (SELECT id FROM fv)) AS saiu_de_vendas
        FROM oportunidade o
       WHERE o.deletado_em IS NULL AND o.absorvido_por_id IS NULL
         AND (o.pipeline_id IN (SELECT id FROM vendas)
              OR EXISTS (SELECT 1 FROM transicao_fase t WHERE t.oportunidade_id = o.id AND t.para_fase_id IN (SELECT id FROM fv)))
    ),
    i AS (
      SELECT COALESCE(mb.remetente_usuario_id, t.usuario_id) AS usuario, t.tipo, t.via_mcp,
             (t.payload -> 'feito') IS NOT NULL AS feita,
             t.payload -> 'feito' ->> 'dia' AS prazo,
             to_char((t.em AT TIME ZONE 'UTC') AT TIME ZONE ${FUSO_NEGOCIO}, 'YYYY-MM-DD') AS dia
        FROM timeline t JOIN vivos o ON o.id = t.oportunidade_id
        LEFT JOIN mensagem_bruta mb ON mb.id = t.mensagem_bruta_id
       WHERE t.em >= ${utc(inicio)} AND t.em < ${utc(fim)} AND t.tipo IN ('NOTA', 'MENSAGEM_WHATSAPP')
         AND (o.em_vendas OR t.em < o.saiu_de_vendas)
    )
    SELECT usuario AS "usuarioId",
           COUNT(*) FILTER (WHERE tipo = 'MENSAGEM_WHATSAPP')::int          AS whatsapp,
           COUNT(*) FILTER (WHERE tipo = 'NOTA' AND NOT via_mcp)::int        AS tela,
           COUNT(*) FILTER (WHERE tipo = 'NOTA' AND via_mcp)::int            AS mcp,
           COUNT(*) FILTER (WHERE tipo = 'NOTA' AND feita)::int              AS "acoesFeitas",
           COUNT(*) FILTER (WHERE tipo = 'NOTA' AND feita AND prazo IS NOT NULL)::int AS "acoesComPrazo",
           COUNT(*) FILTER (WHERE tipo = 'NOTA' AND feita AND dia <= prazo)::int      AS "acoesNoPrazo"
      FROM i
     WHERE usuario IS NOT NULL
     GROUP BY usuario
     ORDER BY usuario`;
}

/** Cards abertos em Vendas AGORA, com o último contato (NOTA/#crm) de cada um — uma consulta. */
export async function carregarAbertos(cliente: Consultor = db): Promise<CardAberto[]> {
  return cliente.$queryRaw<CardAberto[]>`
    SELECT o.id, o.titulo, o.responsavel_id AS "responsavelId", f.nome AS "faseNome",
           o.proxima_acao_em AS "proximaAcaoEm", o.criado_em AS "criadoEm",
           (SELECT max(t.em) FROM timeline t WHERE t.oportunidade_id = o.id AND t.tipo IN ('NOTA', 'MENSAGEM_WHATSAPP') AND t.usuario_id IS NOT NULL) AS "ultimoContatoEm"
      FROM oportunidade o
      JOIN pipeline p ON p.id = o.pipeline_id
      JOIN fase f ON f.id = o.fase_id
     WHERE p.chave = ${QUADRO_VENDAS} AND NOT f.is_terminal
       AND o.deletado_em IS NULL AND o.absorvido_por_id IS NULL`;
}

async function fasesAbertasDeVendas(): Promise<FaseVendas[]> {
  return db.fase.findMany({
    where: { pipeline: { chave: QUADRO_VENDAS }, isTerminal: false, arquivadaEm: null },
    orderBy: { ordem: "asc" },
    select: { id: true, nome: true, ordem: true },
  });
}

/** Pessoas (≤ 15 usuários: todas de uma vez) e quem aparece mesmo zerado (participantes do ranking). */
export async function carregarPessoas(): Promise<{ pessoas: Map<string, Pessoa>; participantes: string[]; vendedores: Pessoa[] }> {
  const [todas, { participantes }] = await Promise.all([db.usuario.findMany({ select: { id: true, nome: true, ativo: true } }), listarParticipantes()]);
  const pessoas = new Map(todas.map((u) => [u.id, u]));
  return { pessoas, participantes: participantes.map((p) => p.id), vendedores: participantes.map((p) => pessoas.get(p.id)!).filter(Boolean) };
}

type Contexto = Awaited<ReturnType<typeof carregarPessoas>>;

export async function carregarConversao({ periodo, vendedorId }: FiltroPainel, cliente: Consultor = db): Promise<Conversao> {
  const [fases, fluxo, fechamentos] = await Promise.all([fasesAbertasDeVendas(), carregarFluxo(periodo, cliente), carregarDados(periodo, cliente)]);
  return montarConversao(fases, fluxo, fechamentos, periodo, vendedorId);
}

export async function carregarEngajamento({ periodo, vendedorId }: FiltroPainel, ctx: Contexto, cliente: Consultor = db): Promise<Engajamento> {
  return montarEngajamento(await carregarInteracoes(periodo, cliente), ctx.pessoas, ctx.participantes, vendedorId);
}

/** `restritoA`: visão restrita — os mais parados saem só dos cards dessa pessoa (antes do corte). */
export async function carregarAcompanhamento({ vendedorId }: FiltroPainel, ctx: Contexto, agora: Date, cliente: Consultor = db, restritoA?: string): Promise<Acompanhamento> {
  return montarAcompanhamento(await carregarAbertos(cliente), ctx.pessoas, ctx.participantes, vendedorId, agora, { paradosDe: restritoA });
}

export async function carregarSatisfacao({ periodo, vendedorId }: FiltroPainel, ctx: Contexto, cliente: Consultor = db): Promise<Satisfacao> {
  return montarSatisfacao(await avaliacoesPorVendedor({ de: periodo.inicio, ate: periodo.fim }, cliente, { soVendas: true }), ctx.pessoas, ctx.participantes, vendedorId);
}

export type Painel = {
  periodo: Periodo;
  vendedor: Pessoa | null;
  /** Opções do filtro por vendedor. */
  vendedores: Pessoa[];
  conversao?: Conversao;
  engajamento?: Engajamento;
  acompanhamento?: Acompanhamento;
  satisfacao?: Satisfacao;
};

/**
 * Carrega os indicadores pedidos (padrão: todos), em paralelo, SEM checar
 * visibilidade (a porta da tela e do MCP é `carregarPainelPara`). `vendedorId`
 * desconhecido → sem filtro e `vendedor: null`.
 */
export async function carregarPainel(
  pedido: FiltroPainel,
  agora: Date,
  indicadores: readonly Indicador[] = INDICADORES,
  cliente: Consultor = db,
  contexto?: Contexto,
  /** Visão restrita (ranking oculto): monta as listas por card a partir dos cards desta pessoa. */
  restritoA?: string,
): Promise<Painel> {
  const ctx = contexto ?? (await carregarPessoas());
  const vendedor = pedido.vendedorId ? (ctx.pessoas.get(pedido.vendedorId) ?? null) : null;
  const filtro = { ...pedido, vendedorId: vendedor?.id ?? null };
  const quer = (i: Indicador) => indicadores.includes(i);
  const [conversao, engajamento, acompanhamento, satisfacao] = await Promise.all([
    quer("conversao") ? carregarConversao(filtro, cliente) : undefined,
    quer("engajamento") ? carregarEngajamento(filtro, ctx, cliente) : undefined,
    quer("acompanhamento") ? carregarAcompanhamento(filtro, ctx, agora, cliente, restritoA) : undefined,
    quer("satisfacao") ? carregarSatisfacao(filtro, ctx, cliente) : undefined,
  ]);
  return {
    periodo: filtro.periodo,
    vendedor,
    vendedores: ctx.vendedores,
    ...(conversao && { conversao }),
    ...(engajamento && { engajamento }),
    ...(acompanhamento && { acompanhamento }),
    ...(satisfacao && { satisfacao }),
  };
}

/**
 * Visão restrita (ranking oculto): só as linhas da própria pessoa (a lista de
 * mais parados já vem montada só com os cards dela — `restritoA` em
 * `carregarPainel`, antes do corte de 10; o filtro aqui é só defesa); os totais
 * (`time`, KPIs, conversão por fase) continuam sendo do time. A lista dos
 * outros nunca sai do servidor.
 */
export function restringirAoProprio(p: Painel, id: string): Painel {
  return {
    ...p,
    vendedores: p.vendedores.filter((v) => v.id === id),
    ...(p.engajamento && { engajamento: { ...p.engajamento, porVendedor: p.engajamento.porVendedor.filter((l) => l.usuario.id === id) } }),
    ...(p.satisfacao && { satisfacao: { ...p.satisfacao, porVendedor: p.satisfacao.porVendedor.filter((l) => l.usuario.id === id) } }),
    ...(p.acompanhamento && {
      acompanhamento: {
        ...p.acompanhamento,
        porResponsavel: p.acompanhamento.porResponsavel.filter((l) => l.usuario.id === id),
        maisParados: p.acompanhamento.maisParados.filter((c) => c.responsavel?.id === id),
      },
    }),
  };
}

export type Ator = { id: string; papel: Papel };

export type VisaoPainel = { ok: true; modo: "completo" | "proprio"; painel: Painel } | { ok: false; erro: "VENDEDOR_DESCONHECIDO" | "SEM_PERMISSAO" };

/**
 * Porta da tela e do MCP: aplica a visibilidade do ranking. Valida o
 * `vendedorId` ANTES de calcular. Ranking oculto para o ator: filtro só por
 * ele mesmo (outro → `SEM_PERMISSAO`) e, sem filtro, `restringirAoProprio`.
 */
export async function carregarPainelPara(
  ator: Ator,
  pedido: FiltroPainel,
  agora: Date,
  indicadores: readonly Indicador[] = INDICADORES,
  cliente: Consultor = db,
): Promise<VisaoPainel> {
  const [config, ctx] = await Promise.all([obterConfigRanking(), carregarPessoas()]);
  if (pedido.vendedorId && !ctx.pessoas.has(pedido.vendedorId)) return { ok: false, erro: "VENDEDOR_DESCONHECIDO" };
  const completo = podeVerPainelCompleto(ator, config);
  if (!completo && pedido.vendedorId && pedido.vendedorId !== ator.id) return { ok: false, erro: "SEM_PERMISSAO" };
  const painel = await carregarPainel(pedido, agora, indicadores, cliente, ctx, completo ? undefined : ator.id);
  return completo ? { ok: true, modo: "completo", painel } : { ok: true, modo: "proprio", painel: restringirAoProprio(painel, ator.id) };
}
