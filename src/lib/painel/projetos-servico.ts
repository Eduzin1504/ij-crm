/**
 * Painel de projetos (GAB-96), leitura no servidor. Tela (`/painel/projetos`) e MCP
 * (`mcp/painel-projetos.ts`) chamam ESTAS funções, então os números são os mesmos.
 * Poucas consultas, nada de N+1; o cálculo é puro (`projetos-calculo.ts`).
 *
 * Quem vê o quê:
 * - `carregarExecucaoProjetos`: aberta a todos, como o cronograma (`obterCronograma`). Não lê valor
 *   nem versão da proposta; título, datas e check-in estão no card, que todos veem.
 * - `carregarCanetaPara`: vem das propostas. O filtro é o das propostas visíveis
 *   (`filtroPropostasVisiveis`), aplicado na consulta; a visão, `visaoDaCanetaNoPainel`.
 *
 * Cards vivos: fora da lixeira (`deletado_em`) e não absorvidos (`absorvido_por_id`).
 */
import type { Prisma } from "@prisma/client";
import { visaoDaCanetaNoPainel, type PessoaComId, type VisaoDaCaneta } from "@/lib/auth/visibilidade";
import { db } from "@/lib/db";
import { ENTREGA_ATIVA } from "@/lib/projetos/execucao";
import { gpDoProjeto } from "@/lib/projetos/execucao-regras";
import { colunaParaDia, diaParaColuna, inicioDoAcompanhamento } from "@/lib/projetos/execucao-semana";
import { PIPELINE_PROJETOS, PIPELINE_VENDAS } from "@/lib/projetos/terminal-regras";
import { faseDeExecucaoAberta } from "@/lib/projetos/trava-handoff";
import { filtroPropostasVisiveis } from "@/lib/propostas/acesso";
import { obterConfigRanking, podeVerPainelCompleto } from "@/lib/ranking/servico";
import type { Periodo } from "@/lib/ranking/periodo";
import type { Pessoa } from "./calculo";
import { esperasDoCliente, EVENTOS_DE_ENVIO, montarCaneta, montarExecucao, propostaParada, STATUS_PARADOS, type ExecucaoProjetos, type TempoCaneta } from "./projetos-calculo";

export type FiltroProjetos = { periodo: Periodo; /** GP na execução; a pessoa, no tempo com a caneta. */ gpId: string | null };

const CARD_VIVO = { deletadoEm: null, absorvidoPorId: null } as const satisfies Prisma.ProjetoWhereInput;

const SELECAO_GP = {
  responsavelId: true,
  responsavel: { select: { id: true, nome: true, ativo: true } },
  handoff: { select: { gpProjeto: { select: { id: true, nome: true, ativo: true, papel: true, area: true, cargos: true } } } },
} as const satisfies Prisma.ProjetoSelect;

type ComGp = Prisma.ProjetoGetPayload<{ select: typeof SELECAO_GP }>;

/** Quem responde pela execução: o GP designado que ainda vale, senão o responsável. */
function gpDe(c: ComGp): Pessoa {
  const designado = c.handoff?.gpProjeto;
  const id = gpDoProjeto({ responsavelId: c.responsavelId, gpDesignado: designado });
  return designado && designado.id === id ? { id: designado.id, nome: designado.nome, ativo: designado.ativo } : c.responsavel;
}

/** A pessoa do filtro: id desconhecido = null, para a tela ignorar e o MCP recusar. `\0` nem chega ao Postgres, que o recusaria com erro. */
export async function pessoaDoFiltro(id: string): Promise<Pessoa | null> {
  if (id.includes("\0")) return null;
  return db.usuario.findUnique({ where: { id }, select: { id: true, nome: true, ativo: true } });
}

/** Aberta a todos. O filtro por GP é aplicado depois da consulta: quem é o GP depende de o designado ainda valer. */
export async function carregarExecucaoProjetos({ periodo, gpId }: FiltroProjetos, agora: Date): Promise<ExecucaoProjetos> {
  const fases = await db.fase.findMany({ where: { pipeline: { chave: PIPELINE_PROJETOS } } });
  const execucao = fases.find((f) => f.marco === "EXECUCAO") ?? null;
  const abertas = fases.filter((f) => faseDeExecucaoAberta(f, PIPELINE_PROJETOS, execucao)).map((f) => f.id);
  const terminais = fases.filter((f) => f.isTerminal).map((f) => f.id);
  const diasDoPeriodo = { gte: diaParaColuna(periodo.primeiroDia), lte: diaParaColuna(periodo.ultimoDia) };

  const [cards, encerrados] = await Promise.all([
    db.projeto.findMany({
      where: { faseId: { in: abertas }, ...CARD_VIVO },
      select: {
        id: true,
        titulo: true,
        execucaoDesde: true,
        fase: { select: { nome: true } },
        ...SELECAO_GP,
        // Só o cronograma ativo: entrega cancelada, e os ajustes dela, não entram em nenhuma conta.
        entregas: { where: ENTREGA_ATIVA, select: { previstoOriginal: true, previstoAtual: true, realizadoEm: true, criadoEm: true, _count: { select: { ajustes: true } } } },
        checkins: { orderBy: [{ em: "desc" }, { id: "desc" }], take: 1, select: { status: true, motivo: true, semana: true, em: true } },
        _count: { select: { lembretesCheckin: true } },
      },
    }),
    db.projeto.findMany({
      where: {
        faseId: { in: terminais },
        ...CARD_VIVO,
        // Encerrou no período, ou tem entrega nele: é o que mantém previstas e feitas de um mês passado estáveis.
        OR: [{ faseDesde: { gte: periodo.inicio, lt: periodo.fim } }, { entregas: { some: { ...ENTREGA_ATIVA, OR: [{ previstoOriginal: diasDoPeriodo }, { realizadoEm: diasDoPeriodo }] } } }],
        // Perdido antes de começar (de Handoff, sem nada de execução) não foi projeto em execução.
        NOT: { fase: { tipoTerminal: "PERDIDO" }, execucaoDesde: null, entregas: { none: {} }, checkins: { none: {} } },
      },
      select: { id: true, titulo: true, faseDesde: true, fase: { select: { nome: true, tipoTerminal: true } }, ...SELECAO_GP, entregas: { where: ENTREGA_ATIVA, select: { previstoOriginal: true, realizadoEm: true } } },
    }),
  ]);

  // Só card sem `execucao_desde` precisa do primeiro check-in, e só para saber desde quando cobrar.
  const semInicio = cards.filter((c) => !c.execucaoDesde).map((c) => c.id);
  const primeiros = semInicio.length ? await db.projetoCheckin.groupBy({ by: ["projetoId"], where: { projetoId: { in: semInicio } }, _min: { em: true } }) : [];
  const primeiroCheckin = new Map(primeiros.map((p) => [p.projetoId, p._min.em]));

  return montarExecucao(
    cards.map((c) => {
      const ultimo = c.checkins[0];
      return {
        id: c.id,
        titulo: c.titulo,
        fase: c.fase.nome,
        gp: gpDe(c),
        entregas: c.entregas.map((e) => ({
          previstoOriginal: colunaParaDia(e.previstoOriginal),
          previstoAtual: colunaParaDia(e.previstoAtual),
          realizado: e.realizadoEm ? colunaParaDia(e.realizadoEm) : null,
          ajustes: e._count.ajustes,
        })),
        ultimoCheckin: ultimo ? { status: ultimo.status, motivo: ultimo.motivo, semana: colunaParaDia(ultimo.semana), em: ultimo.em } : null,
        inicioAcompanhamento: inicioDoAcompanhamento(c.execucaoDesde, [...c.entregas.map((e) => e.criadoEm), primeiroCheckin.get(c.id)]),
        semanasCobradas: c._count.lembretesCheckin,
      };
    }),
    encerrados.map((c) => ({
      id: c.id,
      titulo: c.titulo,
      fase: c.fase.nome,
      tipo: c.fase.tipoTerminal === "PERDIDO" ? ("PERDIDO" as const) : ("FINALIZADO" as const),
      gp: gpDe(c),
      encerradoEm: c.faseDesde,
      entregas: c.entregas.map((e) => ({ previstoOriginal: colunaParaDia(e.previstoOriginal), realizado: e.realizadoEm ? colunaParaDia(e.realizadoEm) : null })),
    })),
    periodo,
    gpId,
    agora,
  );
}

export type VisaoCaneta = { visao: Exclude<VisaoDaCaneta, "nenhuma">; caneta: TempoCaneta };

/** Tempo com a caneta do que a pessoa pode ver. null = ela não vê proposta nenhuma. */
export async function carregarCanetaPara(ator: PessoaComId, { periodo, gpId }: FiltroProjetos, agora: Date): Promise<VisaoCaneta | null> {
  const visao = visaoDaCanetaNoPainel(ator, podeVerPainelCompleto(ator, await obterConfigRanking()));
  if (visao === "nenhuma") return null;
  const visiveis = filtroPropostasVisiveis(ator);
  const [periodos, semDono] = await Promise.all([
    db.propostaCaneta.findMany({
      where: {
        proposta: { AND: [visiveis, { projeto: CARD_VIVO }] },
        ...(visao === "so_minhas" ? { usuarioId: ator.id } : {}),
        OR: [{ fim: null }, { inicio: { lt: periodo.fim }, fim: { gt: periodo.inicio } }],
      },
      select: {
        inicio: true,
        fim: true,
        lado: true,
        usuario: { select: { id: true, nome: true, ativo: true } },
        proposta: { select: { projetoId: true, status: true, enviadaEm: true, respondidaEm: true, rascunhoEm: true, projeto: { select: { titulo: true, faseDesde: true, pipeline: { select: { chave: true } }, fase: { select: { isTerminal: true } } } } } },
      },
    }),
    db.proposta.count({ where: { AND: [visiveis, { canetaComId: null, status: { in: [...STATUS_PARADOS] }, projeto: { ...CARD_VIVO, pipeline: { chave: PIPELINE_VENDAS }, fase: { isTerminal: false } } }] } }),
  ]);
  // Uma consulta só, e só de quem já foi enviada: os envios de cada proposta, em ordem.
  const comEnvio = [...new Set(periodos.filter((p) => p.proposta.enviadaEm).map((p) => p.proposta.projetoId))];
  const eventos = comEnvio.length
    ? await db.timeline.findMany({
        where: { projetoId: { in: comEnvio }, tipo: "PROPOSTA", OR: EVENTOS_DE_ENVIO.map((evento) => ({ payload: { path: ["evento"], equals: evento } })) },
        orderBy: [{ em: "asc" }, { id: "asc" }],
        select: { projetoId: true, em: true, payload: true },
      })
    : [];
  const eventosPorProjeto = Map.groupBy(
    eventos.map((e) => ({ projetoId: e.projetoId, em: e.em, evento: String((e.payload as { evento?: unknown } | null)?.evento) })),
    (e) => e.projetoId,
  );
  return {
    visao,
    caneta: montarCaneta(
      periodos.map((p) => ({
        projetoId: p.proposta.projetoId,
        titulo: p.proposta.projeto.titulo,
        usuario: p.usuario,
        lado: p.lado,
        status: p.proposta.status,
        inicio: p.inicio,
        fim: p.fim,
        parada: propostaParada({ status: p.proposta.status, quadro: p.proposta.projeto.pipeline.chave, faseTerminal: p.proposta.projeto.fase.isTerminal }),
        fimDoCard: p.proposta.projeto.pipeline.chave !== PIPELINE_VENDAS || p.proposta.projeto.fase.isTerminal ? p.proposta.projeto.faseDesde : null,
        esperas: esperasDoCliente(eventosPorProjeto.get(p.proposta.projetoId) ?? [], p.proposta),
        rascunhoEm: p.proposta.rascunhoEm,
      })),
      semDono,
      periodo,
      gpId,
      agora,
    ),
  };
}
