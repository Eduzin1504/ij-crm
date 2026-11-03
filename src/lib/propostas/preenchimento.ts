/**
 * Preenchimento da proposta a partir de um anexo do Projeto (GAB-90, spec
 * fase 2 §4.7). A tela (server action) e o MCP chamam ESTA função.
 *
 * Só SUGERE: lê o arquivo e devolve texto + parte estruturada para a pessoa
 * revisar. Nada é gravado aqui. Aplicar passa pelo caminho de escrita de
 * sempre (`salvarRascunho`: permissão + revisão otimista) — então falha do LLM
 * nunca toca o rascunho, e aplicar sobre uma revisão velha é CONFLITO.
 *
 * - Permissão: a mesma de editar a proposta (`podeEditarProposta`, usuário
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
 */
import type { TipoAnexo } from "@prisma/client";
import { lerArquivo } from "@/lib/anexos/armazenamento";
import { db } from "@/lib/db";
import { registrarErro } from "@/lib/erros/registrar";
import { alertarSeSemCredito, marcarCreditoOk } from "@/lib/llm/alerta-credito";
import { lerPropostaDeArquivo, type EntradaLeitura } from "@/lib/llm/proposta-arquivo";
import { ErroLlm, type ArquivoLlm, type ProvedorLlm } from "@/lib/llm/tipos";
import { MARKDOWN_MAX } from "./documento";
import { documentoParaMarkdown, markdownParaDocumento } from "./markdown";
import { MENSAGEM_ERRO_PROPOSTA, podeEditarProposta } from "./regras";
import { interpretarLeitura, type Sugestao } from "./sugestao";

type Ator = { id: string };

export type ErroPreenchimento = "PROJETO_NAO_ENCONTRADO" | "PROPOSTA_NAO_ENCONTRADA" | "SEM_PERMISSAO" | "ANEXO_NAO_ENCONTRADO" | "SEM_CONTEUDO" | "LONGO_DEMAIS" | "FALHA_LEITURA";

export type ResultadoSugestao = { ok: true; sugestao: Sugestao } | { ok: false; erro: ErroPreenchimento; mensagem: string; ref?: string };

const NAO_ALTERADO = "O rascunho não foi alterado.";

const MENSAGEM: Record<Exclude<ErroPreenchimento, "FALHA_LEITURA">, string> = {
  PROJETO_NAO_ENCONTRADO: MENSAGEM_ERRO_PROPOSTA.PROJETO_NAO_ENCONTRADO,
  PROPOSTA_NAO_ENCONTRADA: "Crie a proposta antes de usar um arquivo como base.",
  SEM_PERMISSAO: MENSAGEM_ERRO_PROPOSTA.SEM_PERMISSAO,
  ANEXO_NAO_ENCONTRADO: "Anexo não encontrado neste projeto (pode ter sido excluído). Recarregue a página.",
  SEM_CONTEUDO: "Não há texto neste arquivo para usar como base.",
  LONGO_DEMAIS: "O texto deste arquivo passa do tamanho máximo da proposta (100 mil caracteres).",
};

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

const falha = (erro: Exclude<ErroPreenchimento, "FALHA_LEITURA">): ResultadoSugestao => ({ ok: false, erro, mensagem: MENSAGEM[erro] });

/** Markdown canônico do subconjunto do editor (o mesmo que `salvarRascunho` grava). */
const canonico = (md: string) => documentoParaMarkdown(markdownParaDocumento(md));

export async function sugerirDeAnexo(projetoId: string, anexoId: string, ator: Ator, opts: { provedor?: ProvedorLlm } = {}): Promise<ResultadoSugestao> {
  const projeto = await db.projeto.findFirst({ where: { id: projetoId, deletadoEm: null }, select: { id: true, responsavelId: true, proposta: { select: { id: true } } } });
  if (!projeto) return falha("PROJETO_NAO_ENCONTRADO");
  const pessoa = await db.usuario.findUnique({ where: { id: ator.id }, select: { id: true, papel: true, area: true, cargos: true, ativo: true } });
  if (!pessoa || !pessoa.ativo || !podeEditarProposta(pessoa, projeto)) return falha("SEM_PERMISSAO");
  if (!projeto.proposta) return falha("PROPOSTA_NAO_ENCONTRADA");
  const anexo = await db.anexo.findFirst({
    where: { id: anexoId, projetoId, deletadoEm: null },
    select: { id: true, nome: true, tipo: true, semTexto: true, texto: true },
  });
  if (!anexo) return falha("ANEXO_NAO_ENCONTRADO");

  const texto = anexo.texto?.trim() ? anexo.texto : null;
  const mime = MIME_VISAO[anexo.tipo];
  if (texto === null && !mime) return falha("SEM_CONTEUDO");
  if (texto !== null && texto.length > MARKDOWN_MAX) return falha("LONGO_DEMAIS");

  const ref = crypto.randomUUID().replace(/-/g, "").slice(0, 8);
  // `log_llm.ref`: a ref que a pessoa vê + o começo do id do anexo (custo por arquivo).
  const refLog = `${ref}:${anexo.id.slice(0, 12)}`;
  const modo = texto !== null ? "texto" : "arquivo";
  let leitura;
  try {
    const entrada: EntradaLeitura =
      texto !== null
        ? { modo: "texto", nomeArquivo: anexo.nome, texto }
        : { modo: "arquivo", nomeArquivo: anexo.nome, arquivo: { nome: anexo.nome, mime: mime!, base64: (await lerArquivo(anexo.id)).toString("base64") } };
    leitura = (await lerPropostaDeArquivo(entrada, { ref: refLog, provedor: opts.provedor })).leitura;
  } catch (e) {
    registrarErro(`proposta.preencher anexo=${anexo.id.slice(0, 12)} modo=${modo}`, e, ref);
    await alertarSeSemCredito(e, ref);
    return { ok: false, erro: "FALHA_LEITURA", mensagem: mensagemDaFalhaLlm(e), ref };
  }
  await marcarCreditoOk();

  const markdown = canonico(texto ?? leitura.markdown ?? "");
  if (!markdown.trim()) return { ok: false, erro: "SEM_CONTEUDO", mensagem: `A IA não encontrou texto legível neste arquivo. ${NAO_ALTERADO}` };
  if (markdown.length > MARKDOWN_MAX) return falha("LONGO_DEMAIS");
  const { campos, revisar } = interpretarLeitura(leitura);
  return { ok: true, sugestao: { origem: modo, anexo: { id: anexo.id, nome: anexo.nome }, markdown, campos, revisar } };
}
