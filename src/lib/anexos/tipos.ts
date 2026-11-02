/**
 * Regras puras dos anexos do Projeto (GAB-84, spec fase 2 §4.7): tipo pelo
 * conteúdo, nome sanitizado e cabeçalho de download. Sem banco nem disco.
 *
 * O tipo vem dos BYTES (magic number), nunca do `File.type`/MIME do cliente; a
 * extensão do nome só precisa CONFERIR com o conteúdo (PDF renomeado para .png
 * é recusado, HTML renomeado para .pdf também). .txt/.md não têm magic number:
 * valem se decodificarem como texto (UTF-8 ou Windows-1252) sem NUL. .docx é
 * um zip: aqui só o cabeçalho `PK`; a estrutura (word/document.xml) é
 * conferida na extração (./extrair.ts).
 */
import type { TipoAnexo } from "@prisma/client";

/** 10 MB: cabe com folga no `mem_limit` do app (o pdf.js parseia em memória). */
export const ANEXO_MAX_BYTES = 10 * 1024 * 1024;

export const MIME_ANEXO: Record<TipoAnexo, string> = {
  PDF: "application/pdf",
  DOCX: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  MARKDOWN: "text/markdown; charset=utf-8",
  TEXTO: "text/plain; charset=utf-8",
  PNG: "image/png",
  JPEG: "image/jpeg",
  WEBP: "image/webp",
};

export const ROTULO_TIPO_ANEXO: Record<TipoAnexo, string> = {
  PDF: "PDF",
  DOCX: "Word",
  MARKDOWN: "Markdown",
  TEXTO: "Texto",
  PNG: "Imagem",
  JPEG: "Imagem",
  WEBP: "Imagem",
};

const POR_EXTENSAO: Record<string, TipoAnexo> = {
  pdf: "PDF",
  docx: "DOCX",
  md: "MARKDOWN",
  markdown: "MARKDOWN",
  txt: "TEXTO",
  png: "PNG",
  jpg: "JPEG",
  jpeg: "JPEG",
  webp: "WEBP",
};

/** Para o `accept` do input (só conforto: quem decide é o servidor). */
export const EXTENSOES_ACEITAS = Object.keys(POR_EXTENSAO).map((e) => `.${e}`);

export type ErroAnexo =
  | "VAZIO"
  | "GRANDE_DEMAIS"
  | "TIPO_INVALIDO"
  | "EXTENSAO_NAO_CONFERE"
  | "CORROMPIDO"
  | "DUPLICADO"
  | "CARD_NAO_ENCONTRADO"
  | "ANEXO_NAO_ENCONTRADO"
  | "SEM_PERMISSAO";

const MB = (n: number) => (n / 1024 / 1024).toFixed(0);

export const MENSAGEM_ERRO_ANEXO: Record<ErroAnexo, string> = {
  VAZIO: "Arquivo vazio. Escolha outro.",
  GRANDE_DEMAIS: `Arquivo grande demais: o limite é ${MB(ANEXO_MAX_BYTES)} MB.`,
  TIPO_INVALIDO: "Tipo não aceito. Envie PDF, Word (.docx), Markdown (.md), texto (.txt) ou imagem (PNG, JPEG, WebP).",
  EXTENSAO_NAO_CONFERE: "O conteúdo do arquivo não confere com a extensão do nome. Confira se é o arquivo certo.",
  CORROMPIDO: "Arquivo corrompido ou num formato que não deu para ler. Tente exportar de novo.",
  DUPLICADO: "Esse arquivo já está anexado a este projeto.",
  CARD_NAO_ENCONTRADO: "Projeto não encontrado (pode ter sido excluído). Recarregue a página.",
  ANEXO_NAO_ENCONTRADO: "Anexo não encontrado (pode já ter sido excluído). Recarregue a página.",
  SEM_PERMISSAO: "Você não tem permissão para isso.",
};

export type Identificacao = { ok: true; tipo: TipoAnexo; mime: string } | { ok: false; erro: ErroAnexo };

type Magia = "PDF" | "PNG" | "JPEG" | "WEBP" | "ZIP";

function comeca(b: Uint8Array, bytes: number[], em = 0): boolean {
  if (b.length < em + bytes.length) return false;
  return bytes.every((x, i) => b[em + i] === x);
}

const ascii = (s: string) => [...s].map((c) => c.charCodeAt(0));

function magia(b: Uint8Array): Magia | null {
  if (comeca(b, ascii("%PDF-"))) return "PDF";
  if (comeca(b, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "PNG";
  if (comeca(b, [0xff, 0xd8, 0xff])) return "JPEG";
  if (comeca(b, ascii("RIFF")) && comeca(b, ascii("WEBP"), 8)) return "WEBP";
  if (comeca(b, [0x50, 0x4b, 0x03, 0x04])) return "ZIP";
  return null;
}

function extensao(nome: string): string {
  const i = nome.lastIndexOf(".");
  return i > 0 ? nome.slice(i + 1).toLowerCase() : "";
}

/** C0 (menos tab/LF/FF/CR), DEL e C1: não aparecem em texto legítimo. */
const CONTROLE = /[\u0000-\u0008\u000b\u000e-\u001f\u007f-\u009f]/;

/**
 * Bytes → texto: UTF-8 (BOM opcional); se não for UTF-8 válido, Windows-1252
 * (Bloco de Notas antigo) sem caracteres de controle. NUL = binário → null.
 * Quebras de linha normalizadas para `\n`.
 */
export function decodificarTexto(bytes: Uint8Array): string | null {
  if (bytes.includes(0)) return null;
  const semBom = comeca(bytes, [0xef, 0xbb, 0xbf]) ? bytes.subarray(3) : bytes;
  let texto: string;
  try {
    texto = new TextDecoder("utf-8", { fatal: true }).decode(semBom);
  } catch {
    texto = new TextDecoder("windows-1252").decode(semBom);
    if (CONTROLE.test(texto)) return null;
  }
  return texto.replace(/\r\n?/g, "\n");
}

export function identificarTipo(bytes: Uint8Array, nome: string): Identificacao {
  if (bytes.length === 0) return { ok: false, erro: "VAZIO" };
  if (bytes.length > ANEXO_MAX_BYTES) return { ok: false, erro: "GRANDE_DEMAIS" };
  const esperado = POR_EXTENSAO[extensao(nome)];
  if (!esperado) return { ok: false, erro: "TIPO_INVALIDO" };
  const m = magia(bytes);
  const ok = (tipo: TipoAnexo): Identificacao => ({ ok: true, tipo, mime: MIME_ANEXO[tipo] });

  if (esperado === "TEXTO" || esperado === "MARKDOWN") {
    if (m) return { ok: false, erro: "EXTENSAO_NAO_CONFERE" };
    return decodificarTexto(bytes) === null ? { ok: false, erro: "TIPO_INVALIDO" } : ok(esperado);
  }
  if (esperado === "DOCX") return m === "ZIP" ? ok("DOCX") : { ok: false, erro: m ? "EXTENSAO_NAO_CONFERE" : "TIPO_INVALIDO" };
  if (m === esperado) return ok(esperado);
  return { ok: false, erro: m ? "EXTENSAO_NAO_CONFERE" : "TIPO_INVALIDO" };
}

const NOME_MAX = 150;
// Separadores de caminho e reservados do Windows viram "_"; controles e
// marcas bidi (U+202E inverte a extensão na tela: "fdp.exe") somem.
const RESERVADOS = /["*:<>?|\\/]/g;
const INVISIVEIS = /[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2066-\u2069\ufeff]/g;

/**
 * Nome exibido e devolvido no download. Só o último segmento do caminho (o
 * navegador às vezes manda `C:\fakepath\...`); nunca é usado como caminho no
 * disco (o arquivo é gravado pelo id, ./armazenamento.ts).
 */
export function sanitizarNome(original: string): string {
  const base = original.split(/[\\/]/).pop() ?? "";
  let nome = base.normalize("NFC").replace(INVISIVEIS, "").replace(RESERVADOS, "_").trim();
  nome = nome.replace(/^[.\s]+|[.\s]+$/g, "");
  if (!nome) return "anexo";
  if (nome.length > NOME_MAX) {
    const ext = extensao(nome);
    const sufixo = ext && ext.length <= 10 ? `.${ext}` : "";
    nome = nome.slice(0, NOME_MAX - sufixo.length).trimEnd() + sufixo;
  }
  return nome;
}

/**
 * `Content-Disposition: attachment` com `filename` ASCII (sem acento, sem
 * aspas/barra) e `filename*` (RFC 5987) com o nome real em UTF-8.
 */
export function cabecalhoDownload(nome: string): string {
  const asciiNome =
    nome
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^\x20-\x7e]/g, "_")
      .replace(/["\\]/g, "_") || "anexo";
  const utf8 = encodeURIComponent(nome).replace(/['()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
  return `attachment; filename="${asciiNome}"; filename*=UTF-8''${utf8}`;
}

/** Tamanho legível: "900 B", "1,5 KB", "340 KB", "1,3 MB". */
export function formatarTamanho(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const [valor, unidade] = bytes < 1024 * 1024 ? [bytes / 1024, "KB"] : [bytes / 1024 / 1024, "MB"];
  const casas = valor < 10 ? 1 : 0;
  return `${valor.toFixed(casas).replace(".", ",").replace(/,0$/, "")} ${unidade}`;
}
