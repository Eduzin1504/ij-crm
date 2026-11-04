/**
 * Calendário (GAB-51), leitura: o que já existe no CRM (próximas ações dos
 * cards abertos) + prazos, só da semana visível. Duas queries (ações e
 * prazos), sem N+1. Usado pela aba Calendário e pela Minha Semana.
 *
 * Etapa 2 (Google Calendar, reuniões) entra como uma terceira fonte aqui:
 * `carregarItensDaSemana` devolve listas por tipo e a grade agrupa por dia.
 */
import type { Papel, Prisma } from "@prisma/client";
import { QUEM_ATUA } from "@/lib/auth/papeis";
import { alcanceDaAgenda, podeVerAgendaDe, veOutrasAgendas, type PessoaComId } from "@/lib/auth/visibilidade";
import { db } from "@/lib/db";
import { diaEmFuso } from "@/lib/projetos/aging";
import { inicioDoDia } from "@/lib/projetos/campos";
import { somarDias } from "@/lib/projetos/proxima-acao";
import { SELECAO_NOME_EXIBIDO, nomeExibido } from "@/lib/entidades/vinculo";
import { compararPrazos, paraPrazoItem, PRAZO_VIVO, SELECAO_PRAZO, type PessoaItem, type PrazoItem } from "@/lib/prazos/prazos";
import { instanteDoPrazo, type SemanaCalendario } from "./semana";

type Ator = { id: string; papel: Papel };

export type AcaoItem = {
  cardId: string;
  titulo: string;
  /** Texto da próxima ação (pode faltar: só a data foi definida). */
  acao: string | null;
  dia: string;
  empresa: string | null;
  fase: string;
  quadro: string;
  responsavel: PessoaItem;
  /** Dia antes de hoje (o card está aberto: só abertos entram). */
  vencida: boolean;
};

export type ItensDaSemana = { acoes: AcaoItem[]; prazos: PrazoItem[] };

/**
 * De quem: lista de responsáveis ou o time todo. `comPrazosDosCards` (Calendário,
 * §4.7): entra também o prazo de outra pessoa em card de que a lista é responsável.
 * A Minha Semana não usa: lá continua só o prazo da própria pessoa.
 */
export type FiltroPessoas = { responsavelIds: string[]; comPrazosDosCards?: boolean } | "time";

/** Leitura com um cliente qualquer (o `db` ou uma transação — ex.: teste com fuso de sessão). */
type Cliente = Pick<Prisma.TransactionClient, "projeto" | "prazo">;

/** Dias civis `YYYY-MM-DD` (SP), inclusivos nas duas pontas; `hoje` decide "vencida". */
export type IntervaloDias = { primeiroDia: string; ultimoDia: string; hoje: string };

export async function carregarItensDaSemana(filtro: FiltroPessoas, semana: SemanaCalendario, ator: Ator, cliente: Cliente = db): Promise<ItensDaSemana> {
  return carregarItens(filtro, { primeiroDia: semana.segunda, ultimoDia: semana.domingo, hoje: semana.hoje }, ator, cliente);
}

/**
 * Ações e prazos de um intervalo de dias. Duas queries, ambas meio-abertas
 * [primeiro dia, dia seguinte ao último): ações por instante (00:00 de SP),
 * prazos pela coluna DATE (meia-noite UTC, sem fuso).
 */
export async function carregarItens(filtro: FiltroPessoas, intervalo: IntervaloDias, ator: Ator, cliente: Cliente = db): Promise<ItensDaSemana> {
  const resp = filtro === "time" ? {} : { responsavelId: { in: filtro.responsavelIds } };
  const respPrazo: Prisma.PrazoWhereInput = filtro !== "time" && filtro.comPrazosDosCards ? { AND: [{ OR: [resp, { projeto: resp }] }] } : resp;
  const seguinte = somarDias(intervalo.ultimoDia, 1);
  const inicio = inicioDoDia(intervalo.primeiroDia)!;
  const fim = inicioDoDia(seguinte)!;
  const [cards, prazos] = await Promise.all([
    cliente.projeto.findMany({
      // Mesma fonte da Minha Semana: vivo e fora de fase terminal, em qualquer quadro.
      where: { ...resp, deletadoEm: null, fase: { isTerminal: false }, proximaAcaoEm: { gte: inicio, lt: fim } },
      select: {
        id: true,
        titulo: true,
        proximaAcao: true,
        proximaAcaoEm: true,
        fase: { select: { nome: true } },
        pipeline: { select: { chave: true } },
        empresa: { select: SELECAO_NOME_EXIBIDO },
        responsavel: { select: { id: true, nome: true, foto: { select: { atualizadoEm: true } } } },
      },
    }),
    cliente.prazo.findMany({
      where: { ...respPrazo, ...PRAZO_VIVO, data: { gte: instanteDoPrazo(intervalo.primeiroDia), lt: instanteDoPrazo(seguinte) } } satisfies Prisma.PrazoWhereInput,
      select: SELECAO_PRAZO,
    }),
  ]);

  const acoes = cards
    .map((c): AcaoItem => {
      const dia = diaEmFuso(c.proximaAcaoEm!);
      return {
        cardId: c.id,
        titulo: c.titulo,
        acao: c.proximaAcao,
        dia,
        empresa: c.empresa ? nomeExibido(c.empresa) : null,
        fase: c.fase.nome,
        quadro: c.pipeline.chave,
        responsavel: { id: c.responsavel.id, nome: c.responsavel.nome, fotoEm: c.responsavel.foto?.atualizadoEm.getTime() ?? null },
        vencida: dia < intervalo.hoje,
      };
    })
    .sort((a, b) => (a.dia !== b.dia ? (a.dia < b.dia ? -1 : 1) : a.responsavel.nome.localeCompare(b.responsavel.nome, "pt-BR") || a.titulo.localeCompare(b.titulo, "pt-BR")));

  return { acoes, prazos: prazos.map((p) => paraPrazoItem(p, ator, intervalo.hoje)).sort(compararPrazos) };
}

export type Visao = {
  modo: "meu" | "time" | "pessoa";
  /** Só em `pessoa`. */
  pessoa: { id: string; nome: string } | null;
  /** Quem o ator pode ver (seletor "Pessoa" e responsável do prazo). Vazio para quem só vê a própria agenda. */
  opcoes: { id: string; nome: string }[];
  /** Mostra "Time" e "Pessoa": gestão. */
  podeTrocar: boolean;
  filtro: FiltroPessoas;
};

/**
 * Pessoas ativas cuja agenda o ator pode ver (`podeVerAgendaDe`): a regra de quem
 * vê quem do Calendário e de `/semana?vendedor=`. Sem gestão: lista vazia.
 */
export async function pessoasComAgendaVisivel(ator: PessoaComId): Promise<{ id: string; nome: string }[]> {
  if (!veOutrasAgendas(ator)) return [];
  const us = await db.usuario.findMany({ where: { ativo: true, ...QUEM_ATUA }, orderBy: { nome: "asc" }, select: { id: true, nome: true, papel: true, area: true, cargos: true } });
  return us.filter((u) => podeVerAgendaDe(ator, u)).map(({ id, nome }) => ({ id, nome }));
}

/**
 * `?ver=time` ou `?pessoa=<id>` (da URL, não confiável). Membro: sempre a própria
 * agenda, com o que foi atribuído a ele. Gestor com área: o time e as pessoas são
 * os do mesmo `ladoDe`. Gestor sem área e admin: todos. Pessoa fora do alcance,
 * inativa ou inexistente → "Meu", sem erro. VISUALIZADOR não chega aqui: a rota
 * barra (`exigirItem("calendario")`); se chegar, vê a própria agenda, que é vazia.
 */
export async function resolverVisao(ator: PessoaComId, params: { ver?: string; pessoa?: string }): Promise<Visao> {
  const opcoes = await pessoasComAgendaVisivel(ator);
  const podeTrocar = veOutrasAgendas(ator);
  const de = (ids: string[]): FiltroPessoas => ({ responsavelIds: ids, comPrazosDosCards: true });
  if (podeTrocar && params.ver === "time") {
    const filtro = alcanceDaAgenda(ator) === "todos" ? "time" : de(opcoes.map((o) => o.id));
    return { modo: "time", pessoa: null, opcoes, podeTrocar, filtro };
  }
  const pessoa = params.pessoa && params.pessoa !== ator.id ? opcoes.find((o) => o.id === params.pessoa) : undefined;
  if (pessoa) return { modo: "pessoa", pessoa, opcoes, podeTrocar, filtro: de([pessoa.id]) };
  return { modo: "meu", pessoa: null, opcoes, podeTrocar, filtro: de([ator.id]) };
}
