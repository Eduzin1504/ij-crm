/**
 * Extração de texto no upload (GAB-84, spec fase 2 §4.7), sem LLM e sem
 * dependência nativa:
 *
 * - PDF: `unpdf` (pdf.js empacotado para servidor, JS puro, sem worker nem
 *   canvas). Sem camada de texto (escaneado) → `texto: null`, que vira "sem
 *   texto" e espera o OCR (GAB-90). PDF com senha também fica sem texto.
 * - .docx: `fflate` abre o zip; o texto sai do `word/document.xml` (`<w:t>`,
 *   com parágrafo/quebra/tab). O tamanho DECLARADO no diretório central é
 *   conferido antes de descompactar e o buffer de saída tem esse tamanho:
 *   zip bomb não passa de `DOCX_XML_MAX` em memória.
 * - .md/.txt: o próprio conteúdo decodificado (./tipos.ts).
 * - Imagens: sempre sem texto.
 *
 * NUL some do resultado (Postgres não guarda `\0` em TEXT) e o texto é cortado
 * em `TEXTO_MAX`.
 */
import type { TipoAnexo } from "@prisma/client";
import { unzipSync } from "fflate";
import { decodificarTexto } from "./tipos";

/** ~1 milhão de caracteres: uma proposta longa tem dezenas de milhares. */
export const TEXTO_MAX = 1_000_000;
/** Teto do XML descompactado de um .docx. */
const DOCX_XML_MAX = 30 * 1024 * 1024;
/** Abaixo disto (caracteres visíveis por página, em média) o PDF conta como escaneado. */
const PDF_MIN_POR_PAGINA = 10;

export type Extracao = { ok: true; texto: string | null } | { ok: false; erro: "CORROMPIDO" | "TIPO_INVALIDO" };

class NaoEDocx extends Error {}

function finalizar(texto: string | null): Extracao {
  if (texto === null) return { ok: true, texto: null };
  const limpo = texto.replace(/\u0000/g, "").trim();
  return { ok: true, texto: limpo ? limpo.slice(0, TEXTO_MAX) : null };
}

const visiveis = (s: string) => s.replace(/\s/g, "").length;

async function textoDoPdf(bytes: Uint8Array): Promise<Extracao> {
  const { extractText, getDocumentProxy } = await import("unpdf");
  let doc: Awaited<ReturnType<typeof getDocumentProxy>>;
  try {
    // Cópia: o pdf.js pode transferir (detach) o buffer recebido.
    doc = await getDocumentProxy(new Uint8Array(bytes));
  } catch (e) {
    if (e instanceof Error && e.name === "PasswordException") return { ok: true, texto: null };
    return { ok: false, erro: "CORROMPIDO" };
  }
  try {
    const { totalPages, text } = await extractText(doc, { mergePages: false });
    const paginas = text.map((t) => t.trim());
    const total = paginas.reduce((n, t) => n + visiveis(t), 0);
    if (totalPages === 0 || total / totalPages < PDF_MIN_POR_PAGINA) return { ok: true, texto: null };
    return finalizar(paginas.filter(Boolean).join("\n\n"));
  } catch {
    return { ok: false, erro: "CORROMPIDO" };
  } finally {
    await doc.loadingTask.destroy().catch(() => {});
  }
}

const ENTIDADES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };

function decodificarEntidades(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (todo, e: string) => {
    if (e[0] !== "#") return ENTIDADES[e.toLowerCase()] ?? todo;
    const cp = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
    return cp > 0 && cp <= 0x10ffff ? String.fromCodePoint(cp) : "";
  });
}

/** Texto visível do `word/document.xml`: `<w:t>`, `<w:tab/>`, `<w:br/>`/`<w:cr/>` e fim de parágrafo. */
function textoDoXmlWord(xml: string): string {
  const partes: string[] = [];
  const token = /<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>|<w:tab\/>|<w:(?:br|cr)(?:\s[^>]*)?\/>|<\/w:p>/g;
  for (const m of xml.matchAll(token)) {
    if (m[1] !== undefined) partes.push(decodificarEntidades(m[1]));
    else if (m[0] === "<w:tab/>") partes.push("\t");
    else partes.push("\n");
  }
  return partes.join("").replace(/[ \t]+\n/g, "\n");
}

function textoDoDocx(bytes: Uint8Array): Extracao {
  const nomes = new Set<string>();
  let arquivos: Record<string, Uint8Array>;
  try {
    arquivos = unzipSync(bytes, {
      filter: (f) => {
        nomes.add(f.name);
        if (f.name !== "word/document.xml") return false;
        if (f.originalSize > DOCX_XML_MAX) throw new NaoEDocx("document.xml grande demais");
        return true;
      },
    });
  } catch {
    return { ok: false, erro: "CORROMPIDO" };
  }
  const xml = arquivos["word/document.xml"];
  if (!nomes.has("[Content_Types].xml") || !xml) return { ok: false, erro: "TIPO_INVALIDO" };
  let texto: string;
  try {
    texto = new TextDecoder("utf-8", { fatal: true }).decode(xml);
  } catch {
    return { ok: false, erro: "CORROMPIDO" };
  }
  return finalizar(textoDoXmlWord(texto));
}

export async function extrairTexto(tipo: TipoAnexo, bytes: Uint8Array): Promise<Extracao> {
  switch (tipo) {
    case "PDF":
      return textoDoPdf(bytes);
    case "DOCX":
      return textoDoDocx(bytes);
    case "TEXTO":
    case "MARKDOWN": {
      const texto = decodificarTexto(bytes);
      return texto === null ? { ok: false, erro: "TIPO_INVALIDO" } : finalizar(texto);
    }
    case "PNG":
    case "JPEG":
    case "WEBP":
      return { ok: true, texto: null };
  }
}
