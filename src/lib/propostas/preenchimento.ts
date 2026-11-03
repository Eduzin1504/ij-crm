/**
 * Preenchimento da proposta a partir de um anexo do Projeto (GAB-90, spec
 * fase 2 §4.7). A tela (server action) e o MCP chamam ESTA função.
 *
 * Só SUGERE: lê o arquivo e devolve texto + parte estruturada para a pessoa
 * revisar. Nada é gravado aqui. Aplicar passa pelo caminho de escrita de
 * sempre (`salvarRascunho`: permissão + revisão otimista) — então falha do LLM
 * nunca toca o rascunho, e aplicar sobre uma revisão velha é CONFLITO.
 *
 * - Permissão: a mesma de editar o rascunho — estar com a caneta, com o
 *   pingue-pongue em curso (`podeEditarProposta` de `caneta.ts`, usuário
 *   relido do banco), conferida ANTES de gastar com o LLM.
 * - PDF digital/.docx/.md/.txt: o texto extraído no upload (GAB-84) vira o
 *   texto do rascunho; o LLM só preenche a parte estruturada.
 * - PDF escaneado/imagem (`semTexto`): o arquivo vai ao modelo do app com
 *   visão, que transcreve e preenche numa chamada. Sem OCR no servidor.
 * - Nada do resultado do LLM é guardado (só a linha de custo em `log_llm`,
 *   sem texto): a retenção de 90 dias do JSON da LLM fica satisfeita por
 *   construção. O que a pessoa aplica vira rascunho comum da proposta.
 * - Falha do LLM: mensagem em português + `ref`; o log do servidor tem a causa
 *   com a mesma ref (e `log_llm` a linha `<ref>:<anexo>`). Sem crédito avisa
 *   a operação pelo alerta de sempre (GAB-46).
 * - Memória (VPS com `mem_limit` 512m): no máximo `LEITURAS_MAX` leituras ao
 *   mesmo tempo no processo e `LEITURAS_MAX_POR_PESSOA` por pessoa (cada uma
 *   monta dezenas de MB de string: arquivo em base64 + corpo da requisição);
 *   acima disso recusa com mensagem clara. PDF escaneado acima de
 *   `PAGINAS_MAX` páginas é recusado antes do LLM (contadas no processo filho
 *   do GAB-84, com os mesmos tetos de tempo/memória).
 * - Visão: UMA tentativa (sem retentativa em timeout/5xx): uma cobrança, uma espera.
 */
import type { TipoAnexo } from "@prisma/client";
import { lerArquivo } from "@/lib/anexos/armazenamento";
import { contarPaginasPdf } from "@/lib/anexos/pdf-processo";
import { db } from "@/lib/db";
import { registrarErro } from "@/lib/erros/registrar";
import { alertarSeSemCredito, marcarCreditoOk } from "@/lib/llm/alerta-credito";
import { lerPropostaDeArquivo, type EntradaLeitura } from "@/lib/llm/proposta-arquivo";
import { ErroLlm, type ArquivoLlm, type ProvedorLlm } from "@/lib/llm/tipos";
import { MARKDOWN_MAX } from "./documento";
import { documentoParaMarkdown, markdownParaDocumento } from "./markdown";
import { podeEditarProposta, STATUS_COM_CANETA } from "./caneta";
import { pessoaDaCaneta } from "./propostas";
import { MENSAGEM_ERRO_PROPOSTA } from "./regras";
import { interpretarLeitura, type Sugestao } from "./sugestao";

type Ator = { id: string };

export type ErroPreenchimento =
  | "PROJETO_NAO_ENCONTRADO"
  | "PROPOSTA_NAO_ENCONTRADA"
  /** Caneta (GAB-87): só o dono, com o pingue-pongue em curso, edita — e só ele usa arquivo como base. */
  | "SEM_CANETA"
  | "PROPOSTA_PRONTA"
  | "PROPOSTA_ENCERRADA"
  | "ANEXO_NAO_ENCONTRADO"
  | "SEM_CONTEUDO"
  | "LONGO_DEMAIS"
  | "PAGINAS_DEMAIS"
  | "OCUPADO"
  /** O arquivo do anexo não está no disco (ENOENT) ou o PDF não abre para contar páginas. */
  | "ARQUIVO_INDISPONIVEL"
  | "FALHA_LEITURA";

export const LEITURAS_MAX = 2;
export const LEITURAS_MAX_POR_PESSOA = 1;
export const PAGINAS_MAX = 30;

export type ResultadoSugestao = { ok: true; sugestao: Sugestao } | { ok: false; erro: ErroPreenchimento; mensagem: string; ref?: string };

const NAO_ALTERADO = "O rascunho não foi alterado.";

type ErroFixo = Exclude<ErroPreenchimento, "FALHA_LEITURA" | "PAGINAS_DEMAIS" | "ARQUIVO_INDISPONIVEL">;

const MENSAGEM: Record<ErroFixo, string> = {
  PROJETO_NAO_ENCONTRADO: MENSAGEM_ERRO_PROPOSTA.PROJETO_NAO_ENCONTRADO,
  PROPOSTA_NAO_ENCONTRADA: "Crie a proposta antes de usar um arquivo como base.",
  SEM_CANETA: MENSAGEM_ERRO_PROPOSTA.SEM_CANETA,
  PROPOSTA_PRONTA: MENSAGEM_ERRO_PROPOSTA.PROPOSTA_PRONTA,
  PROPOSTA_ENCERRADA: MENSAGEM_ERRO_PROPOSTA.PROPOSTA_ENCERRADA,
  ANEXO_NAO_ENCONTRADO: "Anexo não encontrado neste projeto (pode ter sido excluído). Recarregue a página.",
  SEM_CONTEUDO: "Não há texto neste arquivo para usar como base.",
  LONGO_DEMAIS: "O texto deste arquivo passa do tamanho máximo da proposta (100 mil caracteres).",
  OCUPADO: `Já há ${LEITURAS_MAX} leituras de arquivo em andamento no CRM (limite para não sobrecarregar o servidor). Tente de novo em instantes.`,
};

const OCUPADO_PESSOA = "Você já tem uma leitura de arquivo em andamento. Espere ela terminar antes de pedir outra.";

// ---------------------------------------------------------------- vagas (concorrência no processo)

const g = globalThis as unknown as { __ijLeiturasProposta?: Map<string, number> };
const leituras = () => (g.__ijLeiturasProposta ??= new Map());

/** Reserva uma vaga de leitura; `null` = sem vaga (com o motivo). Liberar SEMPRE no `finally`. */
function reservarLeitura(usuarioId: string): { liberar: () => void } | { motivo: "PESSOA" | "TOTAL" } {
  const m = leituras();
  if ((m.get(usuarioId) ?? 0) >= LEITURAS_MAX_POR_PESSOA) return { motivo: "PESSOA" };
  let total = 0;
  for (const n of m.values()) total += n;
  if (total >= LEITURAS_MAX) return { motivo: "TOTAL" };
  m.set(usuarioId, (m.get(usuarioId) ?? 0) + 1);
  let liberada = false;
  return {
    liberar: () => {
      if (liberada) return;
      liberada = true;
      const n = (m.get(usuarioId) ?? 1) - 1;
      if (n <= 0) m.delete(usuarioId);
      else m.set(usuarioId, n);
    },
  };
}

/** Para testes: leituras em andamento agora. */
export function leiturasEmAndamento(): number {
  let total = 0;
  for (const n of leituras().values()) total += n;
  return total;
}

/** Tipos que o modelo lê como arquivo (visão). Os demais só têm o texto extraído. */
const MIME_VISAO: Partial<Record<TipoAnexo, ArquivoLlm["mime"]>> = {
  PDF: "application/pdf",
  PNG: "image/png",
  JPEG: "image/jpeg",
  WEBP: "image/webp",
};

function mensagemDaFalhaLlm(e: unknown): string {
  const c = e instanceof ErroLlm ? e.codigo : null;
  if (c === "SEM_CREDITO" || c === "COTA_DIARIA") return `A IA está sem crédito agora (a operação foi avisada). Tente mais tarde. ${NAO_ALTERADO}`;
  if (c === "TIMEOUT") return `A leitura do arquivo demorou demais. Tente de novo em instantes. ${NAO_ALTERADO}`;
  if (c === "TRUNCADA") return `O arquivo é longo demais para a IA ler de uma vez. ${NAO_ALTERADO}`;
  if (c === "RECUSA") return `A IA se recusou a ler este arquivo. ${NAO_ALTERADO}`;
  return `Não foi possível ler o arquivo com a IA. ${NAO_ALTERADO}`;
}

const falha = (erro: ErroFixo): ResultadoSugestao => ({ ok: false, erro, mensagem: MENSAGEM[erro] });

/** Markdown canônico do subconjunto do editor (o mesmo que `salvarRascunho` grava). */
const canonico = (md: string) => documentoParaMarkdown(markdownParaDocumento(md));

export async function sugerirDeAnexo(projetoId: string, anexoId: string, ator: Ator, opts: { provedor?: ProvedorLlm } = {}): Promise<ResultadoSugestao> {
  const projeto = await db.projeto.findFirst({
    where: { id: projetoId, deletadoEm: null },
    select: { id: true, proposta: { select: { status: true, canetaComId: true, canetaLado: true } } },
  });
  if (!projeto) return falha("PROJETO_NAO_ENCONTRADO");
  const estado = projeto.proposta;
  if (!estado) return falha("PROPOSTA_NAO_ENCONTRADA");
  // Mesma regra do rascunho (`salvarRascunho`): o dono da caneta, pingue-pongue em curso.
  // Conferida ANTES da vaga e do LLM: quem não pode editar não gasta nem ocupa vaga.
  if (estado.status === "PRONTA_PARA_ENVIO") return falha("PROPOSTA_PRONTA");
  if (!STATUS_COM_CANETA.includes(estado.status)) return falha("PROPOSTA_ENCERRADA");
  const pessoa = await pessoaDaCaneta(ator.id);
  if (!pessoa || !podeEditarProposta(pessoa, estado)) return falha("SEM_CANETA");
  const anexo = await db.anexo.findFirst({
    where: { id: anexoId, projetoId, deletadoEm: null },
    select: { id: true, nome: true, tipo: true, semTexto: true, texto: true },
  });
  if (!anexo) return falha("ANEXO_NAO_ENCONTRADO");

  const texto = anexo.texto?.trim() ? anexo.texto : null;
  const mime = MIME_VISAO[anexo.tipo];
  if (texto === null && !mime) return falha("SEM_CONTEUDO");
  if (texto !== null && texto.length > MARKDOWN_MAX) return falha("LONGO_DEMAIS");

  const vaga = reservarLeitura(pessoa.id);
  if ("motivo" in vaga) return vaga.motivo === "PESSOA" ? { ok: false, erro: "OCUPADO", mensagem: OCUPADO_PESSOA } : falha("OCUPADO");
  try {
    return await ler(anexo, texto, mime, opts);
  } finally {
    vaga.liberar();
  }
}

async function ler(
  anexo: { id: string; nome: string; tipo: TipoAnexo },
  texto: string | null,
  mime: ArquivoLlm["mime"] | undefined,
  opts: { provedor?: ProvedorLlm },
): Promise<ResultadoSugestao> {
  const ref = crypto.randomUUID().replace(/-/g, "").slice(0, 8);
  const contexto = `proposta.preencher anexo=${anexo.id.slice(0, 12)}`;
  // `log_llm.ref`: a ref que a pessoa vê + o começo do id do anexo (custo por arquivo).
  const refLog = `${ref}:${anexo.id.slice(0, 12)}`;

  let entrada: EntradaLeitura;
  if (texto !== null) entrada = { modo: "texto", nomeArquivo: anexo.nome, texto };
  else {
    let bytes: Buffer;
    try {
      bytes = await lerArquivo(anexo.id);
    } catch (e) {
      registrarErro(contexto, e, ref);
      const sumiu = (e as NodeJS.ErrnoException).code === "ENOENT";
      return {
        ok: false,
        erro: "ARQUIVO_INDISPONIVEL",
        mensagem: sumiu ? `O arquivo deste anexo não foi encontrado no servidor. Envie-o de novo. ${NAO_ALTERADO}` : `Não foi possível abrir o arquivo deste anexo no servidor. ${NAO_ALTERADO}`,
        ref,
      };
    }
    if (anexo.tipo === "PDF") {
      const c = await contarPaginasPdf(bytes);
      if (c.tipo !== "texto") {
        registrarErro(contexto, new Error(`não deu para contar as páginas: ${c.tipo === "falha" ? c.motivo : c.tipo}`), ref);
        return { ok: false, erro: "ARQUIVO_INDISPONIVEL", mensagem: `Não foi possível abrir este PDF para a leitura (protegido por senha, corrompido ou pesado demais). ${NAO_ALTERADO}`, ref };
      }
      if (c.total > PAGINAS_MAX) {
        return { ok: false, erro: "PAGINAS_DEMAIS", mensagem: `Este PDF tem ${c.total} páginas; a leitura pela IA aceita até ${PAGINAS_MAX}. Envie só as páginas da proposta. ${NAO_ALTERADO}` };
      }
    }
    entrada = { modo: "arquivo", nomeArquivo: anexo.nome, arquivo: { nome: anexo.nome, mime: mime!, base64: bytes.toString("base64") } };
  }

  let leitura;
  try {
    leitura = (await lerPropostaDeArquivo(entrada, { ref: refLog, provedor: opts.provedor })).leitura;
  } catch (e) {
    registrarErro(`${contexto} modo=${entrada.modo}`, e, ref);
    await alertarSeSemCredito(e, ref);
    return { ok: false, erro: "FALHA_LEITURA", mensagem: mensagemDaFalhaLlm(e), ref };
  }
  await marcarCreditoOk();

  const markdown = canonico(texto ?? leitura.markdown ?? "");
  if (!markdown.trim()) return { ok: false, erro: "SEM_CONTEUDO", mensagem: `A IA não encontrou texto legível neste arquivo. ${NAO_ALTERADO}` };
  if (markdown.length > MARKDOWN_MAX) return falha("LONGO_DEMAIS");
  const { campos, revisar } = interpretarLeitura(leitura);
  return { ok: true, sugestao: { origem: entrada.modo, anexo: { id: anexo.id, nome: anexo.nome }, markdown, campos, revisar } };
}
