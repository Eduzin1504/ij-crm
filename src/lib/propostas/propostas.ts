/**
 * Serviço da proposta (GAB-86, spec fase 2 §4.3/§4.5). A tela (server
 * actions) e o conector MCP chamam ESTAS funções — nenhuma regra mora fora.
 *
 * - Uma proposta por Projeto (único no banco; corrida → PROPOSTA_JA_EXISTE).
 * - Rascunho (texto + parte estruturada) com controle otimista: quem grava
 *   manda a `revisao` que leu; se outra aba/pessoa/o MCP gravou antes, volta
 *   CONFLITO com o estado atual e NADA é sobrescrito.
 * - "Salvar versão" grava um snapshot imutável (v1, v2…) do rascunho, com nota
 *   opcional, autor, lado do autor e se foi via MCP. Autosave não é versão.
 * - Timeline do Projeto: criação da proposta e cada versão salva (via MCP
 *   quando dentro de `comViaMcp`, pelo `db`).
 *
 * Permissão: `podeEditarProposta` (regras.ts) com o usuário RELIDO do banco
 * (papel/área atuais — rebaixado na Gestão vale na hora, tela e MCP).
 */
import { Prisma, type Papel, type StatusProposta } from "@prisma/client";
import { ladoDe } from "@/lib/auth/areas";
import { emViaMcp } from "@/lib/canal";
import { db } from "@/lib/db";
import { SELECAO_NOME_EXIBIDO, nomeExibido } from "@/lib/entidades/vinculo";
import { lerDocumento, MARKDOWN_MAX } from "./documento";
import { interpretarEstruturado, lerEstruturadoGravado, mesmoEstruturado, type Estruturado } from "./estruturado";
import { documentoParaMarkdown, markdownParaDocumento } from "./markdown";
import { MENSAGEM_ERRO_PROPOSTA, mensagemConflito, NOTA_VERSAO_MAX, podeEditarProposta, type ErroProposta } from "./regras";

type Tx = Prisma.TransactionClient;
export type Ator = { id: string; papel: Papel };

/** Esqueleto da proposta nova: só títulos, para orientar (o Markdown canônico do subconjunto). */
export const MODELO_INICIAL = "## Contexto\n\n## Objetivo\n\n## Escopo\n\n## Entregas\n\n## Investimento";

export type Conflito = {
  revisao: number;
  por: string | null;
  viaMcp: boolean;
  em: Date | null;
  markdown: string;
  estruturado: Estruturado;
};

export type Falha =
  | { ok: false; erro: ErroProposta }
  /** Parte estruturada inválida: `mensagem` já em português (qual campo/entrega). */
  | { ok: false; erro: "ESTRUTURADO_INVALIDO"; mensagem: string }
  | { ok: false; erro: "CONFLITO"; conflito: Conflito };

export type Resultado<T> = ({ ok: true } & T) | Falha;

/** Conteúdo novo do rascunho: Markdown (MCP) ou o JSON do editor (tela). */
export type ConteudoEntrada = { markdown: string } | { documento: unknown };

class ErroDeProposta extends Error {
  constructor(readonly falha: Falha) {
    super(falha.erro);
  }
}

function falhar(erro: ErroProposta): never {
  throw new ErroDeProposta({ ok: false, erro });
}

async function emTransacao<T>(corpo: (tx: Tx) => Promise<T>): Promise<T | Falha> {
  try {
    return await db.$transaction(corpo);
  } catch (e) {
    if (e instanceof ErroDeProposta) return e.falha;
    // Duas criações ao mesmo tempo: o único em `oportunidade_id` decide (a versão é serializada pelo FOR UPDATE).
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002" && JSON.stringify(e.meta?.target ?? "").includes("oportunidade_id")) {
      return { ok: false, erro: "PROPOSTA_JA_EXISTE" };
    }
    throw e;
  }
}

/** Projeto vivo + quem está agindo (relido) + permissão de edição. */
async function contexto(tx: Tx, projetoId: string, ator: Ator) {
  const projeto = await tx.projeto.findFirst({ where: { id: projetoId, deletadoEm: null }, select: { id: true, responsavelId: true } });
  if (!projeto) falhar("PROJETO_NAO_ENCONTRADO");
  const pessoa = await tx.usuario.findUnique({ where: { id: ator.id }, select: { id: true, papel: true, area: true, cargos: true, ativo: true } });
  const pode = !!pessoa && pessoa.ativo && podeEditarProposta(pessoa, projeto);
  return { projeto, pessoa, pode };
}

function conteudoParaMarkdown(c: ConteudoEntrada): string {
  if ("markdown" in c) {
    if (typeof c.markdown !== "string") falhar("CONTEUDO_INVALIDO");
    if (c.markdown.length > MARKDOWN_MAX) falhar("CONTEUDO_LONGO");
    return documentoParaMarkdown(markdownParaDocumento(c.markdown));
  }
  const doc = lerDocumento(c.documento);
  if (!doc) falhar("CONTEUDO_INVALIDO");
  const md = documentoParaMarkdown(doc);
  if (md.length > MARKDOWN_MAX) falhar("CONTEUDO_LONGO");
  return md;
}

function lerEstruturado(bruto: unknown): Estruturado {
  const r = interpretarEstruturado(bruto);
  if (!r.ok) throw new ErroDeProposta({ ok: false, erro: "ESTRUTURADO_INVALIDO", mensagem: r.erro });
  return r.valor;
}

const SELECAO_CONFLITO = {
  revisao: true,
  conteudoMd: true,
  estruturado: true,
  rascunhoEm: true,
  rascunhoViaMcp: true,
  rascunhoPor: { select: { nome: true } },
} satisfies Prisma.PropostaSelect;

function paraConflito(p: Prisma.PropostaGetPayload<{ select: typeof SELECAO_CONFLITO }>): Conflito {
  return {
    revisao: p.revisao,
    por: p.rascunhoPor?.nome ?? null,
    viaMcp: p.rascunhoViaMcp,
    em: p.rascunhoEm,
    markdown: p.conteudoMd,
    estruturado: lerEstruturadoGravado(p.estruturado),
  };
}

// ---------------------------------------------------------------- leitura

const SELECAO_VERSAO_RESUMO = {
  numero: true,
  nota: true,
  criadoEm: true,
  viaMcp: true,
  autorLado: true,
  autor: { select: { id: true, nome: true } },
} satisfies Prisma.PropostaVersaoSelect;

/** Projeto (vivo) e a proposta dele, se houver — para a página do Projeto e o MCP. */
export async function obterPropostaDoProjeto(projetoId: string) {
  const projeto = await db.projeto.findFirst({
    where: { id: projetoId, deletadoEm: null },
    select: {
      id: true,
      titulo: true,
      responsavelId: true,
      responsavel: { select: { id: true, nome: true } },
      empresa: { select: SELECAO_NOME_EXIBIDO },
      pipeline: { select: { chave: true, nome: true } },
      fase: { select: { nome: true } },
      proposta: {
        select: {
          id: true,
          status: true,
          conteudoMd: true,
          estruturado: true,
          revisao: true,
          rascunhoEm: true,
          rascunhoViaMcp: true,
          rascunhoPor: { select: { id: true, nome: true } },
          criadoEm: true,
          criadoPor: { select: { id: true, nome: true } },
          versoes: { orderBy: { numero: "desc" }, select: SELECAO_VERSAO_RESUMO },
        },
      },
    },
  });
  if (!projeto) return null;
  const { proposta, empresa, ...resto } = projeto;
  return {
    projeto: { ...resto, empresa: empresa ? nomeExibido(empresa) : null },
    proposta: proposta ? { ...proposta, estruturado: lerEstruturadoGravado(proposta.estruturado) } : null,
  };
}

export type PropostaDoProjeto = NonNullable<Awaited<ReturnType<typeof obterPropostaDoProjeto>>>;

export async function obterVersao(projetoId: string, numero: number) {
  const v = await db.propostaVersao.findFirst({
    where: { numero, proposta: { projetoId, projeto: { deletadoEm: null } } },
    select: { ...SELECAO_VERSAO_RESUMO, conteudoMd: true, estruturado: true },
  });
  return v ? { ...v, estruturado: lerEstruturadoGravado(v.estruturado) } : null;
}

export type FiltrosPropostas = { status?: StatusProposta; responsavelId?: string; texto?: string };

/** Aba Propostas: todas as propostas de Projetos vivos, mais recentes primeiro. */
export async function listarPropostas(f: FiltrosPropostas = {}) {
  const texto = f.texto?.trim();
  const linhas = await db.proposta.findMany({
    where: {
      ...(f.status ? { status: f.status } : {}),
      projeto: {
        deletadoEm: null,
        ...(f.responsavelId ? { responsavelId: f.responsavelId } : {}),
        ...(texto
          ? { OR: [{ titulo: { contains: texto, mode: "insensitive" } }, { empresa: { nome: { contains: texto, mode: "insensitive" } } }] }
          : {}),
      },
    },
    orderBy: [{ atualizadoEm: "desc" }, { id: "asc" }],
    select: {
      id: true,
      status: true,
      valor: true,
      rascunhoEm: true,
      criadoEm: true,
      atualizadoEm: true,
      projeto: {
        select: {
          id: true,
          titulo: true,
          responsavel: { select: { id: true, nome: true } },
          empresa: { select: SELECAO_NOME_EXIBIDO },
          fase: { select: { nome: true } },
          pipeline: { select: { chave: true } },
        },
      },
      versoes: { orderBy: { numero: "desc" }, take: 1, select: { numero: true, criadoEm: true } },
    },
  });
  return linhas.map(({ versoes, projeto, ...p }) => ({
    ...p,
    valor: p.valor?.toFixed(2) ?? null,
    ultimaVersao: versoes[0] ?? null,
    projeto: { ...projeto, empresa: projeto.empresa ? nomeExibido(projeto.empresa) : null },
  }));
}

// ---------------------------------------------------------------- escrita

export async function criarProposta(projetoId: string, ator: Ator): Promise<Resultado<{ id: string; revisao: number }>> {
  return emTransacao(async (tx) => {
    const { pode } = await contexto(tx, projetoId, ator);
    if (!pode) falhar("SEM_PERMISSAO");
    if (await tx.proposta.findUnique({ where: { projetoId }, select: { id: true } })) falhar("PROPOSTA_JA_EXISTE");
    const agora = new Date();
    const p = await tx.proposta.create({
      data: {
        projetoId,
        conteudoMd: MODELO_INICIAL,
        estruturado: lerEstruturadoGravado({}),
        criadoPorId: ator.id,
        rascunhoPorId: ator.id,
        rascunhoEm: agora,
        rascunhoViaMcp: emViaMcp(),
      },
      select: { id: true, revisao: true },
    });
    await tx.timeline.create({ data: { projetoId, tipo: "PROPOSTA", payload: { evento: "criada", propostaId: p.id }, usuarioId: ator.id, em: agora } });
    return { ok: true as const, id: p.id, revisao: p.revisao };
  });
}

type MudancaRascunho = { revisao: number; conteudo?: ConteudoEntrada; estruturado?: unknown };

/**
 * Núcleo do rascunho, dentro da transação: valida, compara com o atual e grava
 * só se mudou, condicionado à revisão lida (`updateMany … where revisao`).
 * Nada mudou → ok sem tocar na revisão (mesmo que a base esteja velha: o
 * conteúdo pedido já é o do servidor).
 */
async function aplicarRascunho(tx: Tx, projetoId: string, m: MudancaRascunho, ator: Ator) {
  const { pode } = await contexto(tx, projetoId, ator);
  const atual = await tx.proposta.findUnique({ where: { projetoId }, select: { id: true, conteudoMd: true, estruturado: true, revisao: true } });
  if (!atual) falhar("PROPOSTA_NAO_ENCONTRADA");
  if (!pode) falhar("SEM_PERMISSAO");
  const md = m.conteudo ? conteudoParaMarkdown(m.conteudo) : atual.conteudoMd;
  const estAtual = lerEstruturadoGravado(atual.estruturado);
  const est = m.estruturado !== undefined ? lerEstruturado(m.estruturado) : estAtual;
  if (md === atual.conteudoMd && mesmoEstruturado(est, estAtual)) {
    return { id: atual.id, revisao: atual.revisao, mudou: false, markdown: md, estruturado: est, baseValida: m.revisao === atual.revisao };
  }
  const n = await tx.proposta.updateMany({
    where: { id: atual.id, revisao: m.revisao },
    data: {
      conteudoMd: md,
      estruturado: est,
      valor: est.valor,
      revisao: { increment: 1 },
      rascunhoPorId: ator.id,
      rascunhoEm: new Date(),
      rascunhoViaMcp: emViaMcp(),
    },
  });
  if (n.count === 0) {
    const p = await tx.proposta.findUniqueOrThrow({ where: { id: atual.id }, select: SELECAO_CONFLITO });
    throw new ErroDeProposta({ ok: false, erro: "CONFLITO", conflito: paraConflito(p) });
  }
  return { id: atual.id, revisao: m.revisao + 1, mudou: true, markdown: md, estruturado: est, baseValida: true };
}

/** Autosave da tela / `editar_proposta` do MCP. Não é versão e não vai para a Timeline. */
export async function salvarRascunho(
  projetoId: string,
  m: MudancaRascunho,
  ator: Ator,
): Promise<Resultado<{ revisao: number; mudou: boolean; markdown: string; estruturado: Estruturado }>> {
  return emTransacao(async (tx) => {
    const r = await aplicarRascunho(tx, projetoId, m, ator);
    return { ok: true as const, revisao: r.revisao, mudou: r.mudou, markdown: r.markdown, estruturado: r.estruturado };
  });
}

/**
 * "Salvar versão": aplica o rascunho mandado junto (a tela manda o que está no
 * editor) e grava o snapshot imutável seguinte. Sem conteúdo junto (MCP), a
 * revisão lida tem de ser a atual — a versão é do que quem pediu viu.
 */
export async function salvarVersao(
  projetoId: string,
  m: MudancaRascunho & { nota?: string },
  ator: Ator,
): Promise<Resultado<{ numero: number; revisao: number }>> {
  const nota = m.nota?.trim() || null;
  if (nota && nota.length > NOTA_VERSAO_MAX) return { ok: false, erro: "NOTA_LONGA" };
  return emTransacao(async (tx) => {
    // Uma versão por vez por proposta: trava a linha (o número sai do máximo atual).
    await tx.$queryRaw`SELECT id FROM proposta WHERE oportunidade_id = ${projetoId} FOR UPDATE`;
    const r = await aplicarRascunho(tx, projetoId, m, ator);
    if (!r.baseValida) {
      const p = await tx.proposta.findUniqueOrThrow({ where: { id: r.id }, select: SELECAO_CONFLITO });
      throw new ErroDeProposta({ ok: false, erro: "CONFLITO", conflito: paraConflito(p) });
    }
    const ultima = await tx.propostaVersao.findFirst({ where: { propostaId: r.id }, orderBy: { numero: "desc" }, select: { numero: true, conteudoMd: true, estruturado: true } });
    if (ultima && ultima.conteudoMd === r.markdown && mesmoEstruturado(lerEstruturadoGravado(ultima.estruturado), r.estruturado)) falhar("SEM_MUDANCAS");
    const pessoa = await tx.usuario.findUniqueOrThrow({ where: { id: ator.id }, select: { papel: true, area: true, cargos: true } });
    const numero = (ultima?.numero ?? 0) + 1;
    const agora = new Date();
    await tx.propostaVersao.create({
      data: { propostaId: r.id, numero, conteudoMd: r.markdown, estruturado: r.estruturado, nota, autorId: ator.id, autorLado: ladoDe(pessoa), viaMcp: emViaMcp(), criadoEm: agora },
    });
    await tx.proposta.update({ where: { id: r.id }, data: { atualizadoEm: agora } });
    await tx.timeline.create({
      data: { projetoId, tipo: "PROPOSTA", payload: { evento: "versao_salva", numero, ...(nota ? { nota } : {}) }, usuarioId: ator.id, em: agora },
    });
    return { ok: true as const, numero, revisao: r.revisao };
  });
}

/** Falha → texto em português (o mesmo na tela e no MCP). */
export function mensagemDaFalha(f: Falha): string {
  if (f.erro === "ESTRUTURADO_INVALIDO") return f.mensagem;
  if (f.erro === "CONFLITO") return mensagemConflito(f.conflito);
  return MENSAGEM_ERRO_PROPOSTA[f.erro];
}
