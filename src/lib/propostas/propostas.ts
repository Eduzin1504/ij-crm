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
 * Caneta e pingue-pongue (GAB-87): só o dono da caneta grava o rascunho e
 * salva versão; passar, devolver, concordar, pegar, reabrir e inviável seguem
 * a máquina de estados pura de `./caneta.ts`, aplicada AQUI, dentro da
 * transação, sob o lock da linha da proposta — vale para a tela e o MCP.
 * Cada passagem vai para a Timeline e abre/fecha um período em
 * `proposta_caneta` (tempo com a caneta por pessoa). Avisos: `./avisos.ts`.
 *
 * Permissão: com o usuário RELIDO do banco (papel/área/cargos/ativo atuais —
 * rebaixado ou trocado de lado na Gestão vale na hora, tela e MCP).
 */
import { Prisma, type Area, type Papel, type StatusProposta } from "@prisma/client";
import { ladoDe } from "@/lib/auth/areas";
import { emViaMcp } from "@/lib/canal";
import { db } from "@/lib/db";
import { SELECAO_NOME_EXIBIDO, nomeExibido } from "@/lib/entidades/vinculo";
import { travarPipelines } from "@/lib/fases/fases";
import { ErroDeRegra, MENSAGEM_ERRO_PROJETO } from "@/lib/projetos/erros";
import { registrarMovimento } from "@/lib/projetos/projetos";
import { PIPELINE_VENDAS } from "@/lib/projetos/terminal-regras";
import { avisarCaneta, type EventoCaneta } from "./avisos";
import {
  ladoDaCaneta,
  MOTIVO_INVIAVEL_MAX,
  outroLado,
  podeAtuarNaCaneta,
  podeEditarProposta,
  recusaDaAcao,
  STATUS_COM_CANETA,
  statusAoReceber,
  type AcaoCaneta,
  type EstadoCaneta,
  type Pessoa,
} from "./caneta";
import { diffEstruturado, diffMarkdown, type LinhaDiff, type MudancaCampo } from "./diff";
import { lerDocumento, MARKDOWN_MAX } from "./documento";
import { interpretarEstruturado, lerEstruturadoGravado, mesmoEstruturado, type Estruturado } from "./estruturado";
import { documentoParaMarkdown, markdownParaDocumento } from "./markdown";
import { MENSAGEM_ERRO_PROPOSTA, mensagemConflito, NOTA_VERSAO_MAX, podeCriarProposta, type ErroProposta } from "./regras";

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
  /** Regra do Projeto ao movê-lo (inviável → Perdido): `mensagem` já em português. */
  | { ok: false; erro: "REGRA_PROJETO"; mensagem: string }
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
    if (e instanceof ErroDeRegra) return { ok: false, erro: "REGRA_PROJETO", mensagem: MENSAGEM_ERRO_PROJETO[e.erro] };
    // Duas criações ao mesmo tempo: o único em `oportunidade_id` decide (a versão é serializada pelo FOR UPDATE).
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002" && JSON.stringify(e.meta?.target ?? "").includes("oportunidade_id")) {
      return { ok: false, erro: "PROPOSTA_JA_EXISTE" };
    }
    throw e;
  }
}

const SELECAO_PESSOA = { id: true, nome: true, papel: true, area: true, cargos: true, ativo: true } satisfies Prisma.UsuarioSelect;
type PessoaLida = Pessoa & { nome: string };

/** Usuário RELIDO do banco (papel/área/cargos/ativo de agora). */
async function lerPessoa(tx: Tx | typeof db, id: string): Promise<PessoaLida | null> {
  return tx.usuario.findUnique({ where: { id }, select: SELECAO_PESSOA });
}

/** Uma versão por vez e uma passagem de caneta por vez: trava a linha da proposta. */
async function travarProposta(tx: Tx, projetoId: string) {
  await tx.$queryRaw`SELECT id FROM proposta WHERE oportunidade_id = ${projetoId} FOR UPDATE`;
}

/** Projeto vivo + quem age (relido) + proposta com o estado da caneta e a última versão. */
async function contexto(tx: Tx, projetoId: string, ator: Ator) {
  const projeto = await tx.projeto.findFirst({ where: { id: projetoId, deletadoEm: null }, select: { id: true, responsavelId: true } });
  if (!projeto) falhar("PROJETO_NAO_ENCONTRADO");
  const pessoa = await lerPessoa(tx, ator.id);
  const proposta = await tx.proposta.findUnique({
    where: { projetoId },
    select: {
      id: true,
      status: true,
      revisao: true,
      conteudoMd: true,
      estruturado: true,
      canetaComId: true,
      canetaLado: true,
      versoes: { orderBy: { numero: "desc" }, take: 1, select: { numero: true, autorId: true, autorLado: true, conteudoMd: true, estruturado: true } },
    },
  });
  const ultima = proposta?.versoes[0] ?? null;
  const estado: EstadoCaneta | null = proposta
    ? { status: proposta.status, canetaComId: proposta.canetaComId, canetaLado: proposta.canetaLado, ultimaVersaoLado: ultima ? ultima.autorLado : undefined }
    : null;
  return { projeto, pessoa, proposta, ultima, estado };
}

/** Por que não edita o rascunho (null = edita). */
function recusaDeEdicao(pessoa: Pessoa | null, estado: EstadoCaneta): ErroProposta | null {
  if (estado.status === "PRONTA_PARA_ENVIO") return "PROPOSTA_PRONTA";
  if (!STATUS_COM_CANETA.includes(estado.status)) return "PROPOSTA_ENCERRADA";
  return pessoa && podeEditarProposta(pessoa, estado) ? null : "SEM_CANETA";
}

/** Recusa da máquina de estados → falha (sem pessoa = não age em nada). */
function exigirAcao(acao: AcaoCaneta, pessoa: Pessoa | null, estado: EstadoCaneta, alvo?: Pessoa | null) {
  const r = pessoa ? recusaDaAcao(acao, pessoa, estado, alvo) : "SEM_CANETA";
  if (r) falhar(r);
}

/**
 * Troca quem está com a caneta: fecha o período aberto e abre o de `para`
 * (null = ninguém). Pressupõe o lock da proposta.
 */
async function trocarCaneta(tx: Tx, propostaId: string, para: { id: string } | null, lado: Area, agora: Date, extra: Prisma.PropostaUpdateInput = {}) {
  await tx.propostaCaneta.updateMany({ where: { propostaId, fim: null }, data: { fim: agora } });
  if (para) await tx.propostaCaneta.create({ data: { propostaId, usuarioId: para.id, lado, inicio: agora } });
  await tx.proposta.update({
    where: { id: propostaId },
    data: { canetaCom: para ? { connect: { id: para.id } } : { disconnect: true }, canetaLado: lado, atualizadoEm: agora, ...extra },
  });
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
          canetaComId: true,
          canetaLado: true,
          canetaCom: { select: { id: true, nome: true } },
          motivoInviavel: true,
          periodosCaneta: { where: { fim: null }, take: 1, select: { inicio: true } },
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
    proposta: proposta
      ? (() => {
          const { periodosCaneta, ...p } = proposta;
          const estado: EstadoCaneta = { status: p.status, canetaComId: p.canetaComId, canetaLado: p.canetaLado, ultimaVersaoLado: p.versoes[0] ? p.versoes[0].autorLado : undefined };
          return { ...p, estruturado: lerEstruturadoGravado(p.estruturado), canetaDesde: periodosCaneta[0]?.inicio ?? null, estado };
        })()
      : null,
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
      canetaLado: true,
      canetaCom: { select: { id: true, nome: true } },
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

export async function criarProposta(projetoId: string, ator: Ator): Promise<Resultado<{ id: string; revisao: number; canetaComId: string | null }>> {
  return emTransacao(async (tx) => {
    const { projeto, pessoa, proposta } = await contexto(tx, projetoId, ator);
    if (!pessoa || !pessoa.ativo || !podeCriarProposta(pessoa, projeto)) falhar("SEM_PERMISSAO");
    if (proposta) falhar("PROPOSTA_JA_EXISTE");
    const agora = new Date();
    // O pingue-pongue começa com vendas: a caneta vai para o responsável (se é de vendas), senão
    // para quem criou (se é de vendas); gestão sem lado cria, mas não fica com a caneta.
    const resp = await lerPessoa(tx, projeto.responsavelId);
    const dono = [resp, pessoa].find((u): u is PessoaLida => !!u && podeAtuarNaCaneta(u) && ladoDe(u) === "VENDAS") ?? null;
    const p = await tx.proposta.create({
      data: {
        projetoId,
        conteudoMd: MODELO_INICIAL,
        estruturado: lerEstruturadoGravado({}),
        criadoPorId: ator.id,
        rascunhoPorId: ator.id,
        rascunhoEm: agora,
        rascunhoViaMcp: emViaMcp(),
        canetaComId: dono?.id ?? null,
        canetaLado: "VENDAS",
        ...(dono ? { periodosCaneta: { create: { usuarioId: dono.id, lado: "VENDAS", inicio: agora } } } : {}),
      },
      select: { id: true, revisao: true },
    });
    await tx.timeline.create({
      data: { projetoId, tipo: "PROPOSTA", payload: { evento: "criada", propostaId: p.id, canetaComId: dono?.id ?? null, canetaComNome: dono?.nome ?? null }, usuarioId: ator.id, em: agora },
    });
    return { ok: true as const, id: p.id, revisao: p.revisao, canetaComId: dono?.id ?? null };
  });
}

type MudancaRascunho = { revisao: number; conteudo?: ConteudoEntrada; estruturado?: unknown };

/**
 * Núcleo do rascunho, dentro da transação: valida, compara com o atual e grava
 * só se mudou, condicionado à revisão lida (`updateMany … where revisao`).
 * Nada mudou → ok sem tocar na revisão, MAS só se a base for a atual. Base
 * velha é sempre CONFLITO, mesmo sem mudança: senão quem leu antes "pega" a
 * revisão nova sem ter visto o que mudou (ex.: outra pessoa trocou o valor) e a
 * próxima gravação dele desfaz a mudança em silêncio (lost update).
 */
async function aplicarRascunho(tx: Tx, projetoId: string, m: MudancaRascunho, ator: Ator) {
  const { pessoa, proposta: atual, estado } = await contexto(tx, projetoId, ator);
  if (!atual || !estado) falhar("PROPOSTA_NAO_ENCONTRADA");
  // Caneta: só o dono grava (tela e MCP), conferido aqui — o caminho de toda escrita do rascunho.
  const recusa = recusaDeEdicao(pessoa, estado);
  if (recusa) falhar(recusa);
  const md = m.conteudo ? conteudoParaMarkdown(m.conteudo) : atual.conteudoMd;
  const estAtual = lerEstruturadoGravado(atual.estruturado);
  const est = m.estruturado !== undefined ? lerEstruturado(m.estruturado) : estAtual;
  if (m.revisao !== atual.revisao) {
    const p = await tx.proposta.findUniqueOrThrow({ where: { id: atual.id }, select: SELECAO_CONFLITO });
    throw new ErroDeProposta({ ok: false, erro: "CONFLITO", conflito: paraConflito(p) });
  }
  if (md === atual.conteudoMd && mesmoEstruturado(est, estAtual)) {
    return { id: atual.id, revisao: atual.revisao, mudou: false, markdown: md, estruturado: est };
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
  return { id: atual.id, revisao: m.revisao + 1, mudou: true, markdown: md, estruturado: est };
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
    await travarProposta(tx, projetoId);
    // Base velha já é CONFLITO em `aplicarRascunho`: a versão é do conteúdo que quem pediu viu.
    const r = await aplicarRascunho(tx, projetoId, m, ator);
    const ultima = await ultimaVersao(tx, r.id);
    if (ultima && mesmoConteudo(ultima, r)) falhar("SEM_MUDANCAS");
    const numero = await gravarVersao(tx, projetoId, r, ultima, nota, ator, new Date());
    return { ok: true as const, numero, revisao: r.revisao };
  });
}

async function ultimaVersao(tx: Tx, propostaId: string) {
  return tx.propostaVersao.findFirst({ where: { propostaId }, orderBy: { numero: "desc" }, select: { numero: true, autorId: true, autorLado: true, conteudoMd: true, estruturado: true } });
}

function mesmoConteudo(v: { conteudoMd: string; estruturado: Prisma.JsonValue }, r: { markdown: string; estruturado: Estruturado }): boolean {
  return v.conteudoMd === r.markdown && mesmoEstruturado(lerEstruturadoGravado(v.estruturado), r.estruturado);
}

/** Snapshot imutável seguinte + Timeline `versao_salva`. Pressupõe o lock da proposta. */
async function gravarVersao(
  tx: Tx,
  projetoId: string,
  r: { id: string; markdown: string; estruturado: Estruturado },
  ultima: { numero: number } | null,
  nota: string | null,
  ator: Ator,
  agora: Date,
): Promise<number> {
  const pessoa = await tx.usuario.findUniqueOrThrow({ where: { id: ator.id }, select: { papel: true, area: true, cargos: true } });
  const numero = (ultima?.numero ?? 0) + 1;
  await tx.propostaVersao.create({
    data: { propostaId: r.id, numero, conteudoMd: r.markdown, estruturado: r.estruturado, nota, autorId: ator.id, autorLado: ladoDe(pessoa), viaMcp: emViaMcp(), criadoEm: agora },
  });
  await tx.proposta.update({ where: { id: r.id }, data: { atualizadoEm: agora } });
  await tx.timeline.create({
    data: { projetoId, tipo: "PROPOSTA", payload: { evento: "versao_salva", numero, ...(nota ? { nota } : {}) }, usuarioId: ator.id, em: agora },
  });
  return numero;
}

// ---------------------------------------------------------------- caneta e pingue-pongue (GAB-87)

type ResultadoCaneta = Resultado<{ status: StatusProposta; canetaComId: string | null; canetaComNome: string | null; numero?: number; revisao?: number }>;

/** Destino escolhido (relido): `null` = não existe. */
async function lerAlvo(tx: Tx, paraId: string): Promise<PessoaLida | null> {
  return typeof paraId === "string" && paraId ? lerPessoa(tx, paraId) : null;
}

async function registrarCaneta(tx: Tx, projetoId: string, ator: Ator, em: Date, payload: Record<string, unknown>) {
  await tx.timeline.create({ data: { projetoId, tipo: "PROPOSTA", payload: payload as Prisma.InputJsonObject, usuarioId: ator.id, em } });
}

/** Depois do commit: avisa (GAB-88 escuta) e devolve o resultado como veio. */
async function comAviso(r: ResultadoCaneta & { aviso?: EventoCaneta }): Promise<ResultadoCaneta> {
  if (!r.ok) return r;
  const { aviso, ...resto } = r;
  if (aviso) await avisarCaneta(aviso);
  return resto;
}

/** Passar a caneta para outra pessoa do MESMO lado (sem versão). */
export async function passarCaneta(projetoId: string, paraId: string, ator: Ator): Promise<ResultadoCaneta> {
  const r = await emTransacao(async (tx) => {
    await travarProposta(tx, projetoId);
    const { pessoa, proposta, estado } = await contexto(tx, projetoId, ator);
    if (!proposta || !estado) falhar("PROPOSTA_NAO_ENCONTRADA");
    const alvo = await lerAlvo(tx, paraId);
    exigirAcao("passar", pessoa, estado, alvo);
    const lado = ladoDaCaneta(estado);
    const agora = new Date();
    await trocarCaneta(tx, proposta.id, alvo!, lado, agora);
    await registrarCaneta(tx, projetoId, ator, agora, { evento: "caneta_passada", paraId: alvo!.id, paraNome: alvo!.nome, lado });
    const aviso: EventoCaneta = { projetoId, propostaId: proposta.id, acao: "passou", porId: ator.id, paraId: alvo!.id, lado, status: proposta.status };
    return { ok: true as const, status: proposta.status, canetaComId: alvo!.id, canetaComNome: alvo!.nome, aviso };
  });
  return comAviso(r);
}

/**
 * Devolver: aplica o rascunho mandado junto (a tela manda o editor; o MCP só a
 * revisão lida), salva a versão e manda a caneta para alguém do OUTRO lado.
 * Sem mudança desde a última versão: se ela é do meu lado, só passa (já foi
 * salva); se veio do outro lado, é Concordar, não Devolver.
 */
export async function devolverProposta(projetoId: string, m: MudancaRascunho & { nota?: string; paraId: string }, ator: Ator): Promise<ResultadoCaneta> {
  const nota = m.nota?.trim() || null;
  if (nota && nota.length > NOTA_VERSAO_MAX) return { ok: false, erro: "NOTA_LONGA" };
  const r = await emTransacao(async (tx) => {
    await travarProposta(tx, projetoId);
    const { pessoa, proposta, estado } = await contexto(tx, projetoId, ator);
    if (!proposta || !estado) falhar("PROPOSTA_NAO_ENCONTRADA");
    const alvo = await lerAlvo(tx, m.paraId);
    exigirAcao("devolver", pessoa, estado, alvo);
    const meu = ladoDaCaneta(estado);
    const outro = outroLado(meu);
    const rasc = await aplicarRascunho(tx, projetoId, m, ator);
    const ultima = await ultimaVersao(tx, proposta.id);
    const agora = new Date();
    let numero: number;
    if (ultima && mesmoConteudo(ultima, rasc)) {
      if (ultima.autorLado === outro) falhar("DEVOLVER_SEM_MUDANCAS");
      numero = ultima.numero;
    } else {
      numero = await gravarVersao(tx, projetoId, rasc, ultima, nota, ator, agora);
    }
    const status = statusAoReceber(outro);
    await trocarCaneta(tx, proposta.id, alvo!, outro, agora, { status });
    await registrarCaneta(tx, projetoId, ator, new Date(agora.getTime() + 1), { evento: "devolvida", numero, paraId: alvo!.id, paraNome: alvo!.nome, lado: outro });
    const aviso: EventoCaneta = { projetoId, propostaId: proposta.id, acao: "devolveu", porId: ator.id, paraId: alvo!.id, lado: outro, status, numero };
    return { ok: true as const, status, canetaComId: alvo!.id, canetaComNome: alvo!.nome, numero, revisao: rasc.revisao, aviso };
  });
  return comAviso(r);
}

/**
 * Concordar com a última versão, que veio do OUTRO lado, sem editar: consenso
 * → Pronta para envio. `revisao` = a que quem concorda leu (o rascunho tem de
 * ser exatamente essa versão). A caneta fica com vendas (quem envia): com
 * quem concordou, se é de vendas; senão com quem salvou a versão (se ainda
 * pode), ou com ninguém — o GP de vendas pega.
 */
export async function concordarProposta(projetoId: string, revisao: number, ator: Ator): Promise<ResultadoCaneta> {
  const r = await emTransacao(async (tx) => {
    await travarProposta(tx, projetoId);
    const { pessoa, proposta, estado, ultima } = await contexto(tx, projetoId, ator);
    if (!proposta || !estado) falhar("PROPOSTA_NAO_ENCONTRADA");
    exigirAcao("concordar", pessoa, estado);
    if (revisao !== proposta.revisao) {
      const p = await tx.proposta.findUniqueOrThrow({ where: { id: proposta.id }, select: SELECAO_CONFLITO });
      throw new ErroDeProposta({ ok: false, erro: "CONFLITO", conflito: paraConflito(p) });
    }
    if (!ultima || !mesmoConteudo(ultima, { markdown: proposta.conteudoMd, estruturado: lerEstruturadoGravado(proposta.estruturado) })) falhar("CONCORDAR_RASCUNHO_ALTERADO");
    let dono: PessoaLida | null = pessoa;
    if (ladoDaCaneta(estado) !== "VENDAS") {
      const autor = await lerPessoa(tx, ultima.autorId);
      dono = autor && podeAtuarNaCaneta(autor) && ladoDe(autor) === "VENDAS" ? autor : null;
    }
    const agora = new Date();
    const status: StatusProposta = "PRONTA_PARA_ENVIO";
    await trocarCaneta(tx, proposta.id, dono, "VENDAS", agora, { status });
    await registrarCaneta(tx, projetoId, ator, agora, { evento: "concordou", numero: ultima.numero, lado: ladoDaCaneta(estado), paraId: dono?.id ?? null, paraNome: dono?.nome ?? null });
    const aviso: EventoCaneta = { projetoId, propostaId: proposta.id, acao: "concordou", porId: ator.id, paraId: dono?.id ?? null, lado: "VENDAS", status, numero: ultima.numero };
    return { ok: true as const, status, canetaComId: dono?.id ?? null, canetaComNome: dono?.nome ?? null, numero: ultima.numero, aviso };
  });
  return comAviso(r);
}

/** GP do lado da caneta pega para destravar (dono sumiu, de férias, ninguém com ela). */
export async function pegarCaneta(projetoId: string, ator: Ator): Promise<ResultadoCaneta> {
  const r = await emTransacao(async (tx) => {
    await travarProposta(tx, projetoId);
    const { pessoa, proposta, estado } = await contexto(tx, projetoId, ator);
    if (!proposta || !estado) falhar("PROPOSTA_NAO_ENCONTRADA");
    exigirAcao("pegar", pessoa, estado);
    const lado = ladoDaCaneta(estado);
    const de = estado.canetaComId ? await lerPessoa(tx, estado.canetaComId) : null;
    const agora = new Date();
    await trocarCaneta(tx, proposta.id, pessoa!, lado, agora);
    await registrarCaneta(tx, projetoId, ator, agora, { evento: "caneta_pega", deId: de?.id ?? null, deNome: de?.nome ?? null, lado });
    const aviso: EventoCaneta = { projetoId, propostaId: proposta.id, acao: "pegou", porId: ator.id, paraId: pessoa!.id, lado, status: proposta.status };
    return { ok: true as const, status: proposta.status, canetaComId: pessoa!.id, canetaComNome: pessoa!.nome, aviso };
  });
  return comAviso(r);
}

/** Pronta para envio → Em ajuste: vendas (dono) quer mexer antes de enviar; vai ter de passar por projetos de novo. */
export async function reabrirProposta(projetoId: string, ator: Ator): Promise<ResultadoCaneta> {
  const r = await emTransacao(async (tx) => {
    await travarProposta(tx, projetoId);
    const { pessoa, proposta, estado } = await contexto(tx, projetoId, ator);
    if (!proposta || !estado) falhar("PROPOSTA_NAO_ENCONTRADA");
    exigirAcao("reabrir", pessoa, estado);
    const status = statusAoReceber(ladoDaCaneta(estado));
    const agora = new Date();
    await tx.proposta.update({ where: { id: proposta.id }, data: { status, atualizadoEm: agora } });
    await registrarCaneta(tx, projetoId, ator, agora, { evento: "reaberta" });
    const aviso: EventoCaneta = { projetoId, propostaId: proposta.id, acao: "reabriu", porId: ator.id, paraId: pessoa!.id, lado: ladoDaCaneta(estado), status };
    return { ok: true as const, status, canetaComId: pessoa!.id, canetaComNome: pessoa!.nome, aviso };
  });
  return comAviso(r);
}

/**
 * Inviável (GP de projetos, ou o dono da caneta do lado projetos), com motivo:
 * a proposta sai do pingue-pongue e o Projeto vai para o marco Perdido do
 * quadro de Vendas, pelo MESMO caminho do Kanban (`registrarMovimento`: lock
 * do quadro, TransicaoFase, Timeline e `motivo_perda` = "Outro: Proposta inviável: …").
 */
export async function marcarInviavel(projetoId: string, motivoBruto: string, ator: Ator): Promise<ResultadoCaneta> {
  const motivo = typeof motivoBruto === "string" ? motivoBruto.trim().replace(/\s+/g, " ") : "";
  if (!motivo) return { ok: false, erro: "MOTIVO_INVIAVEL_OBRIGATORIO" };
  if (motivo.length > MOTIVO_INVIAVEL_MAX) return { ok: false, erro: "MOTIVO_INVIAVEL_LONGO" };
  const r = await emTransacao(async (tx) => {
    const alvo = await tx.projeto.findFirst({ where: { id: projetoId, deletadoEm: null }, select: { pipelineId: true } });
    if (!alvo) falhar("PROJETO_NAO_ENCONTRADO");
    // Mesma ordem de locks do Kanban: o quadro primeiro, depois a linha da proposta.
    await travarPipelines(tx, [alvo.pipelineId]);
    await travarProposta(tx, projetoId);
    const { pessoa, proposta, estado } = await contexto(tx, projetoId, ator);
    if (!proposta || !estado) falhar("PROPOSTA_NAO_ENCONTRADA");
    exigirAcao("inviavel", pessoa, estado);
    const op = await tx.projeto.findUniqueOrThrow({ where: { id: projetoId }, select: { pipelineId: true, pipeline: { select: { chave: true } }, fase: true } });
    if (op.pipelineId !== alvo.pipelineId || op.pipeline.chave !== PIPELINE_VENDAS) falhar("PROJETO_FORA_DE_VENDAS");
    if (op.fase.isTerminal) falhar("PROJETO_ENCERRADO");
    const perdido = await tx.fase.findUnique({ where: { marco: "PERDIDO" } });
    if (!perdido || perdido.arquivadaEm || perdido.pipelineId !== op.pipelineId || perdido.tipoTerminal !== "PERDIDO") falhar("FASE_PERDIDO_INDISPONIVEL");
    const agora = new Date();
    const status: StatusProposta = "INVIAVEL";
    await trocarCaneta(tx, proposta.id, null, ladoDaCaneta(estado), agora, { status, motivoInviavel: motivo });
    await registrarCaneta(tx, projetoId, ator, agora, { evento: "inviavel", motivo });
    await registrarMovimento(tx, {
      projetoId,
      pipelineChave: op.pipeline.chave,
      origem: op.fase,
      destino: perdido,
      porId: ator.id,
      em: new Date(agora.getTime() + 1),
      origemTransicao: "UI",
      dadosTerminal: { motivo: "outro", detalhe: `Proposta inviável: ${motivo}` },
    });
    const aviso: EventoCaneta = { projetoId, propostaId: proposta.id, acao: "inviavel", porId: ator.id, paraId: null, lado: null, status };
    return { ok: true as const, status, canetaComId: null, canetaComNome: null, aviso };
  });
  return comAviso(r);
}

// ---------------------------------------------------------------- leitura da caneta

/** Pessoas que podem receber a caneta (ativas, que escrevem e têm lado), por lado. */
export async function listarPessoasDaCaneta(): Promise<{ id: string; nome: string; lado: Area; gp: boolean }[]> {
  const us = await db.usuario.findMany({ where: { ativo: true }, orderBy: { nome: "asc" }, select: SELECAO_PESSOA });
  return us.flatMap((u) => {
    const lado = ladoDe(u);
    return lado && podeAtuarNaCaneta(u) ? [{ id: u.id, nome: u.nome, lado, gp: u.cargos.includes("GP") }] : [];
  });
}

/** O que a pessoa pode fazer na proposta agora (relida do banco): para a tela e o `ler_proposta`. */
export async function pessoaDaCaneta(usuarioId: string): Promise<Pessoa | null> {
  return lerPessoa(db, usuarioId);
}

/** Tempo com a caneta por pessoa (períodos fechados + o aberto até agora), em ms. */
export async function tempoComCaneta(projetoId: string, agora = new Date()) {
  const ps = await db.propostaCaneta.findMany({
    where: { proposta: { projetoId } },
    select: { inicio: true, fim: true, lado: true, usuario: { select: { id: true, nome: true } } },
  });
  const por = new Map<string, { id: string; nome: string; lado: Area; ms: number }>();
  for (const p of ps) {
    const atual = por.get(p.usuario.id) ?? { ...p.usuario, lado: p.lado, ms: 0 };
    atual.ms += Math.max(0, (p.fim ?? agora).getTime() - p.inicio.getTime());
    por.set(p.usuario.id, atual);
  }
  return [...por.values()].sort((a, b) => b.ms - a.ms);
}

export type DiffVersoes = {
  de: { numero: number; autor: string; lado: Area | null } | null;
  para: { numero: number; autor: string; lado: Area | null };
  texto: LinhaDiff[];
  estruturado: MudancaCampo[];
};

/**
 * Diff entre duas versões. Sem `de`: o que o lado de `quem` ENTREGOU por
 * último antes de `para` (o "que voltou" para quem recebe a caneta); se esse
 * lado nunca entregou, a versão anterior; se `para` é a v1, desde o vazio.
 * Sem `para`: a última. Versão inexistente → null.
 */
export async function diffDaProposta(projetoId: string, opts: { de?: number; para?: number; quem?: string } = {}): Promise<DiffVersoes | null> {
  const versoes = await db.propostaVersao.findMany({
    where: { proposta: { projetoId, projeto: { deletadoEm: null } } },
    orderBy: { numero: "asc" },
    select: { numero: true, autorLado: true, conteudoMd: true, estruturado: true, autor: { select: { nome: true } } },
  });
  if (versoes.length === 0) return null;
  const para = opts.para === undefined ? versoes.at(-1)! : versoes.find((v) => v.numero === opts.para);
  if (!para) return null;
  let de: (typeof versoes)[number] | null | undefined;
  if (opts.de !== undefined) {
    de = versoes.find((v) => v.numero === opts.de);
    if (!de) return null;
  } else {
    const antes = versoes.filter((v) => v.numero < para.numero);
    const pessoa = opts.quem ? await lerPessoa(db, opts.quem) : null;
    const meuLado = pessoa ? ladoDe(pessoa) : null;
    de = (meuLado ? antes.filter((v) => v.autorLado === meuLado).at(-1) : undefined) ?? antes.at(-1) ?? null;
  }
  const resumo = (v: (typeof versoes)[number]) => ({ numero: v.numero, autor: v.autor.nome, lado: v.autorLado });
  return {
    de: de ? resumo(de) : null,
    para: resumo(para),
    texto: diffMarkdown(de?.conteudoMd ?? "", para.conteudoMd),
    estruturado: diffEstruturado(de ? lerEstruturadoGravado(de.estruturado) : lerEstruturadoGravado({}), lerEstruturadoGravado(para.estruturado)),
  };
}

/** Falha → texto em português (o mesmo na tela e no MCP). */
export function mensagemDaFalha(f: Falha): string {
  if (f.erro === "ESTRUTURADO_INVALIDO" || f.erro === "REGRA_PROJETO") return f.mensagem;
  if (f.erro === "CONFLITO") return mensagemConflito(f.conflito);
  return MENSAGEM_ERRO_PROPOSTA[f.erro];
}
