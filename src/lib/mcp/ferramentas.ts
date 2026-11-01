/**
 * Ferramentas MCP de Projeto (GAB-83, spec fase 2 §4.13). Regra de construção:
 * cada ferramenta só traduz argumentos e chama a MESMA camada de serviço da
 * tela (`lib/projetos`, `lib/fases`) — nenhuma regra de negócio mora aqui.
 *
 * Permissão = a da tela: ferramenta de escrita recusa VISUALIZADOR antes de
 * chamar o serviço (como `exigirEscrita` nas actions), e o serviço ainda
 * confere o papel (`SEM_PERMISSAO`). Ficam SÓ na tela: deleção definitiva,
 * merge de contatos e configuração técnica (não há ferramenta para elas).
 *
 * Tudo roda dentro de `comViaMcp`: a Timeline gravada sai marcada "via MCP".
 * Erro de regra → texto em português para o Claude; exceção → log com `ref`
 * e a mesma `ref` na mensagem (padrão do repo: `registrarErro`).
 *
 * Próximas fatias (proposta, handoff…) acrescentam ferramentas a `FERRAMENTAS`.
 */
import { z } from "zod";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { podeEscrever } from "@/lib/auth/papeis";
import { comViaMcp } from "@/lib/canal";
import { mensagemInesperada, registrarErro } from "@/lib/erros/registrar";
import { listarPipelines } from "@/lib/fases/fases";
import { ROTULO_MARCO } from "@/lib/fases/marcos";
import { diaEmFuso } from "@/lib/projetos/aging";
import { CAMPOS_EDITAVEIS, descricaoSchema, interpretarCampo, type CampoEditavel } from "@/lib/projetos/campos";
import { MENSAGEM_ERRO_PROJETO } from "@/lib/projetos/erros";
import { adicionarNota, criarCard, editarCard, listarQuadro, listarResponsaveis, moverCard, obterCard, type PatchCard } from "@/lib/projetos/projetos";
import { MOTIVOS_PERDA, PIPELINE_PROJETOS, PIPELINE_VENDAS } from "@/lib/projetos/terminal-regras";
import type { UsuarioMcp } from "./oauth";
import { urlBase } from "./url";

export type Resposta = { ok: true; dados: unknown } | { ok: false; erro: string };

type Forma = z.ZodRawShape;

export type Ferramenta<F extends Forma = Forma> = {
  nome: string;
  titulo: string;
  descricao: string;
  /** Escreve no CRM: VISUALIZADOR (somente leitura) é recusado, como na tela. */
  escrita: boolean;
  entrada: F;
  executar: (args: z.infer<z.ZodObject<F>>, eu: UsuarioMcp) => Promise<Resposta>;
};

function ferramenta<F extends Forma>(f: Ferramenta<F>): Ferramenta {
  return f as unknown as Ferramenta;
}

export const SO_LEITURA = "Seu acesso no CRM é só de visualização: esta ação não é permitida para o seu papel.";

const id = z.string().min(1).max(64);
const quadro = z.enum([PIPELINE_VENDAS, PIPELINE_PROJETOS]);
const ok = (dados: unknown): Resposta => ({ ok: true, dados });
const erro = (texto: string): Resposta => ({ ok: false, erro: texto });
const urlProjeto = (pid: string) => `${urlBase()}/projetos/${pid}`;
const dia = (d: Date | null) => (d ? diaEmFuso(d) : null);

/** Texto sem acento e minúsculo, para a busca por texto. */
function normalizar(t: string): string {
  return t.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();
}

async function mapaDeFases() {
  const ps = await listarPipelines({ incluirArquivadas: true });
  return new Map(ps.flatMap((p) => p.fases.map((f) => [f.id, { nome: f.nome, quadro: p.chave }] as const)));
}

// ---------------------------------------------------------------- leitura

const listarFases = ferramenta({
  nome: "listar_fases",
  titulo: "Listar quadros e fases",
  descricao:
    "Lista os quadros do CRM (vendas e projetos) com as fases ativas em ordem: id, nome, marco do ciclo (Proposta, Montando contrato, Ganho, Perdido, Handoff, Execução, Finalizado) e se é terminal. Use os ids para filtrar, criar e mover projetos. Inclui os motivos de perda aceitos.",
  escrita: false,
  entrada: {},
  executar: async () => {
    const ps = await listarPipelines();
    return ok({
      quadros: ps.map((p) => ({
        quadro: p.chave,
        nome: p.nome,
        fases: p.fases.map((f) => ({ id: f.id, nome: f.nome, marco: f.marco ? ROTULO_MARCO[f.marco] : null, terminal: f.tipoTerminal })),
      })),
      motivosDePerda: MOTIVOS_PERDA.map((m) => ({ chave: m.chave, rotulo: m.rotulo })),
    });
  },
});

const listarPessoas = ferramenta({
  nome: "listar_responsaveis",
  titulo: "Listar responsáveis",
  descricao: "Lista as pessoas ativas que podem ser responsáveis por um projeto (id e nome). Também diz quem é você.",
  escrita: false,
  entrada: {},
  executar: async (_args, eu) => ok({ voce: { id: eu.id, nome: eu.nome, papel: eu.papel }, responsaveis: await listarResponsaveis() }),
});

const LIMITE_PADRAO = 50;

const buscarProjetos = ferramenta({
  nome: "buscar_projetos",
  titulo: "Buscar projetos",
  descricao:
    "Lista/busca projetos (cards do Kanban) vivos. Filtros opcionais: quadro (vendas|projetos), fase_id, responsavel_id (ou \"eu\") e texto (no título ou na empresa, sem diferenciar acento). Mais recentes na fase primeiro.",
  escrita: false,
  entrada: {
    quadro: quadro.optional().describe("vendas ou projetos; sem ele, os dois"),
    fase_id: id.optional(),
    responsavel_id: id.optional().describe('id da pessoa, ou "eu"'),
    texto: z.string().max(200).optional(),
    limite: z.number().int().min(1).max(200).optional().describe(`padrão ${LIMITE_PADRAO}`),
  },
  executar: async (a, eu) => {
    const chaves = a.quadro ? [a.quadro] : [PIPELINE_VENDAS, PIPELINE_PROJETOS];
    const quadros = (await Promise.all(chaves.map((q) => listarQuadro(q)))).filter((q) => q !== null);
    const responsavel = a.responsavel_id === "eu" ? eu.id : a.responsavel_id;
    const texto = a.texto?.trim() ? normalizar(a.texto.trim()) : null;
    const achados = quadros.flatMap((q) =>
      q.cards
        .filter((c) => !a.fase_id || c.faseId === a.fase_id)
        .filter((c) => !responsavel || c.responsavel.id === responsavel)
        .filter((c) => !texto || normalizar(`${c.titulo} ${c.empresa?.nome ?? ""}`).includes(texto))
        .map((c) => ({
          id: c.id,
          titulo: c.titulo,
          quadro: q.pipeline.chave,
          fase: q.fases.find((f) => f.id === c.faseId)?.nome ?? null,
          faseId: c.faseId,
          naFaseDesde: c.faseDesde.toISOString(),
          responsavel: { id: c.responsavel.id, nome: c.responsavel.nome },
          empresa: c.empresa?.nome ?? null,
          proximaAcao: c.proximaAcao,
          proximaAcaoEm: dia(c.proximaAcaoEm),
          revisar: c.revisar,
          url: urlProjeto(c.id),
        })),
    );
    const limite = a.limite ?? LIMITE_PADRAO;
    return ok({ total: achados.length, mostrando: Math.min(limite, achados.length), projetos: achados.slice(0, limite) });
  },
});

const TIMELINE_PADRAO = 20;

const lerProjeto = ferramenta({
  nome: "ler_projeto",
  titulo: "Ler projeto",
  descricao:
    "Lê um projeto: dados do card, quadro e fase, responsável, Empresa e Contato, próxima ação e a Timeline recente (mais nova primeiro; cada entrada com autor e se foi via MCP).",
  escrita: false,
  entrada: { id, timeline: z.number().int().min(0).max(200).optional().describe(`quantas entradas da Timeline (padrão ${TIMELINE_PADRAO})`) },
  executar: async (a) => {
    const c = await obterCard(a.id);
    if (!c) return erro(MENSAGEM_ERRO_PROJETO.CARD_NAO_ENCONTRADO);
    const fases = await mapaDeFases();
    const nomeFase = (v: unknown) => (typeof v === "string" ? (fases.get(v)?.nome ?? "fase removida") : undefined);
    const n = a.timeline ?? TIMELINE_PADRAO;
    // `slice(-0)` seria a lista inteira: 0 pede nenhuma entrada.
    const recentes = n === 0 ? [] : c.timeline.slice(-n).reverse();
    return ok({
      id: c.id,
      titulo: c.titulo,
      quadro: c.pipeline.chave,
      fase: { id: c.fase.id, nome: c.fase.nome, marco: c.fase.marco ? ROTULO_MARCO[c.fase.marco] : null, desde: c.faseDesde.toISOString() },
      responsavel: { id: c.responsavel.id, nome: c.responsavel.nome },
      empresa: c.empresa,
      contato: c.contato,
      proximaAcao: { texto: c.proximaAcao, data: dia(c.proximaAcaoEm) },
      campos: {
        origem: c.origem,
        dor: c.dor,
        descricao: c.descricao,
        orcamentoPrevisto: c.orcamentoPrevisto?.toFixed(2) ?? null,
        propostaUrl: c.propostaUrl,
        cidade: c.cidade,
        estado: c.estado,
        revisar: c.revisar,
        valorFechado: c.valorFechado?.toFixed(2) ?? null,
        motivoPerda: c.motivoPerda,
      },
      criadoEm: c.criadoEm.toISOString(),
      url: urlProjeto(c.id),
      timeline: recentes.map((t) => {
        const p = (t.payload && typeof t.payload === "object" && !Array.isArray(t.payload) ? t.payload : {}) as Record<string, unknown>;
        return {
          em: t.em.toISOString(),
          tipo: t.tipo,
          autor: t.usuario?.nome ?? "Sistema",
          viaMcp: t.viaMcp,
          ...(t.tipo === "MOVIMENTACAO" ? { de: nomeFase(p.deFaseId), para: nomeFase(p.paraFaseId) } : {}),
          dados: p,
        };
      }),
    });
  },
});

// ---------------------------------------------------------------- escrita

const criarProjeto = ferramenta({
  nome: "criar_projeto",
  titulo: "Criar projeto",
  descricao:
    "Cria um projeto (card) com você como responsável, como o + do Kanban. Sem fase_id, entra na primeira fase aberta do quadro. Não cria direto em fase de ganho/perdido (crie e depois mova).",
  escrita: true,
  entrada: {
    titulo: z.string().min(1).max(1000),
    quadro: quadro.optional().describe("padrão vendas"),
    fase_id: id.optional(),
    descricao: z.string().max(10_000).optional(),
  },
  executar: async (a, eu) => {
    const chave = a.quadro ?? PIPELINE_VENDAS;
    const p = (await listarPipelines()).find((x) => x.chave === chave);
    if (!p) return erro(MENSAGEM_ERRO_PROJETO.PIPELINE_NAO_ENCONTRADO);
    const faseId = a.fase_id ?? p.fases.find((f) => !f.isTerminal)?.id;
    if (!faseId) return erro(MENSAGEM_ERRO_PROJETO.FASE_NAO_ENCONTRADA);
    const d = descricaoSchema.safeParse(a.descricao);
    if (!d.success) return erro(d.error.issues[0].message);
    const r = await criarCard({ pipelineId: p.id, faseId, titulo: a.titulo, descricao: d.data }, eu);
    if (!r.ok) return erro(MENSAGEM_ERRO_PROJETO[r.erro]);
    return ok({ id: r.id, url: urlProjeto(r.id) });
  },
});

/** Campos que a tela edita inline, cada um como texto (o mesmo formato do formulário). */
const camposEntrada = Object.fromEntries(CAMPOS_EDITAVEIS.map((c) => [c, z.string().max(10_000).optional()])) as Record<CampoEditavel, z.ZodOptional<z.ZodString>>;

/** Interpreta cada campo como a tela (`interpretarCampo`) e aplica num `editarCard` só. */
async function aplicarCampos(projetoId: string, brutos: Partial<Record<CampoEditavel, string>>, eu: UsuarioMcp): Promise<Resposta> {
  const patch: PatchCard = {};
  for (const campo of CAMPOS_EDITAVEIS) {
    const bruto = brutos[campo];
    if (bruto === undefined) continue;
    const v = interpretarCampo(campo, bruto);
    if (!v.ok) return erro(v.erro);
    patch[campo] = v.valor;
  }
  if (Object.keys(patch).length === 0) return erro("Informe ao menos um campo para alterar.");
  const r = await editarCard(projetoId, patch, eu);
  if (!r.ok) return erro(MENSAGEM_ERRO_PROJETO[r.erro]);
  return ok({ alterados: r.alterados, url: urlProjeto(projetoId) });
}

const atualizarProjeto = ferramenta({
  nome: "atualizar_projeto",
  titulo: "Atualizar campos do projeto",
  descricao:
    "Altera campos do projeto, no mesmo formato da tela: texto vazio limpa o campo. origem: COLD_CALL|RD|INDICACAO|EVENTO|OUTRO; orcamentoPrevisto em reais no formato BR (12.500,00); estado: sigla da UF; proximaAcaoEm: AAAA-MM-DD; responsavelId: id de listar_responsaveis; revisar: true|false. Cada mudança vai para a Timeline.",
  escrita: true,
  entrada: { id, campos: z.object(camposEntrada).strict() },
  executar: async (a, eu) => aplicarCampos(a.id, a.campos, eu),
});

const definirProximaAcao = ferramenta({
  nome: "definir_proxima_acao",
  titulo: "Definir próxima ação",
  descricao: "Define (ou limpa, com os dois vazios) a próxima ação do projeto e a data dela (AAAA-MM-DD).",
  escrita: true,
  entrada: { id, acao: z.string().max(1000), data: z.string().max(20) },
  executar: async (a, eu) => aplicarCampos(a.id, { proximaAcao: a.acao, proximaAcaoEm: a.data }, eu),
});

const moverProjeto = ferramenta({
  nome: "mover_projeto",
  titulo: "Mover projeto de fase",
  descricao:
    "Move o projeto para outra fase do MESMO quadro (as regras de marco valem como na tela). Ganho em vendas pede valor_fechado (12.500,00) e leva o card ao Handoff do quadro projetos; Perdido pede motivo_perda (chave de listar_fases) e, em \"outro\", detalhe_perda.",
  escrita: true,
  entrada: {
    id,
    fase_id: id,
    valor_fechado: z.string().max(50).optional(),
    motivo_perda: z.string().max(50).optional(),
    detalhe_perda: z.string().max(2000).optional(),
  },
  executar: async (a, eu) => {
    const dados = { valorFechado: a.valor_fechado, motivo: a.motivo_perda, detalhe: a.detalhe_perda };
    // Como a tela: sem diálogo de ganho/perda, `dadosTerminal` não vai.
    const temDados = Object.values(dados).some((v) => v !== undefined);
    const r = await moverCard(a.id, a.fase_id, eu, temDados ? { dadosTerminal: dados } : {});
    if (!r.ok) return erro(MENSAGEM_ERRO_PROJETO[r.erro]);
    return ok({ mudou: r.mudou, terminal: r.terminal, url: urlProjeto(a.id) });
  },
});

const registrarNota = ferramenta({
  nome: "registrar_nota",
  titulo: "Registrar nota",
  descricao: "Registra uma nota na Timeline do projeto (até 5000 caracteres).",
  escrita: true,
  entrada: { id, texto: z.string().max(10_000) },
  executar: async (a, eu) => {
    const r = await adicionarNota(a.id, a.texto, eu);
    if (!r.ok) return erro(MENSAGEM_ERRO_PROJETO[r.erro]);
    return ok({ registrada: true, url: urlProjeto(a.id) });
  },
});

export const FERRAMENTAS: readonly Ferramenta[] = [
  listarFases,
  listarPessoas,
  buscarProjetos,
  lerProjeto,
  criarProjeto,
  atualizarProjeto,
  definirProximaAcao,
  moverProjeto,
  registrarNota,
];

function resultado(r: Resposta): CallToolResult {
  if (!r.ok) return { isError: true, content: [{ type: "text", text: r.erro }] };
  return { content: [{ type: "text", text: JSON.stringify(r.dados, null, 2) }] };
}

/**
 * Porta única de execução (o servidor MCP e os testes passam por aqui):
 * valida argumentos, aplica a permissão do papel e marca "via MCP".
 */
export async function executarFerramenta(nome: string, args: unknown, eu: UsuarioMcp): Promise<CallToolResult> {
  const f = FERRAMENTAS.find((x) => x.nome === nome);
  if (!f) return resultado(erro(`Ferramenta desconhecida: ${nome}.`));
  if (f.escrita && !podeEscrever(eu.papel)) return resultado(erro(SO_LEITURA));
  const p = z.object(f.entrada).safeParse(args ?? {});
  if (!p.success) {
    const i = p.error.issues[0];
    return resultado(erro(`Argumento inválido${i.path.length ? ` em ${i.path.join(".")}` : ""}: ${i.message}`));
  }
  try {
    return resultado(await comViaMcp(() => f.executar(p.data, eu)));
  } catch (e) {
    const ref = registrarErro(`mcp.${nome}`, e);
    return resultado(erro(mensagemInesperada(ref)));
  }
}
