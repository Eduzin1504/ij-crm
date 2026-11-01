/**
 * Extração de texto no upload (GAB-84, spec fase 2 §4.7), sem LLM e sem
 * dependência nativa:
 *
 * - PDF: `unpdf` (pdf.js empacotado para servidor, JS puro, sem worker nem
 *   canvas), num PROCESSO FILHO com teto de tempo e de memória
 *   (./pdf-processo.ts). Sem camada de texto (escaneado) → `texto: null`, que
 *   vira "sem texto" e espera o OCR (GAB-90). PDF com senha também. Filho
 *   morto por tempo/memória → sem texto, com `falha` para o log.
 * - .docx: o `word/document.xml` é achado pelo diretório central do zip e
 *   descompactado pelo zlib nativo com `maxOutputLength`: zip bomb para no
 *   teto (`DOCX_XML_MAX`), sem gastar CPU descompactando o resto, e o tamanho
 *   declarado no zip não importa. O texto sai dos `<w:t>` (com
 *   parágrafo/quebra/tab).
 * - .md/.txt: o próprio conteúdo decodificado (./tipos.ts).
 * - Imagens: sempre sem texto.
 *
 * NUL some do resultado (Postgres não guarda `\0` em TEXT) e o texto é cortado
 * em `TEXTO_MAX`.
 */
import { inflateRawSync } from "node:zlib";
import type { TipoAnexo } from "@prisma/client";
import { extrairPdfEmProcesso } from "./pdf-processo";
import { decodificarTexto } from "./tipos";

/** ~1 milhão de caracteres: uma proposta longa tem dezenas de milhares. */
export const TEXTO_MAX = 1_000_000;
/** Teto do XML descompactado de um .docx. */
export const DOCX_XML_MAX = 30 * 1024 * 1024;
/** Abaixo disto (caracteres visíveis por página, em média) o PDF conta como escaneado. */
const PDF_MIN_POR_PAGINA = 10;

/** `falha`: a extração não terminou (filho do PDF morto); o anexo segue sem texto e a causa vai para o log. */
export type Extracao = { ok: true; texto: string | null; falha?: string } | { ok: false; erro: "CORROMPIDO" | "TIPO_INVALIDO" };

function finalizar(texto: string | null): Extracao {
  if (texto === null) return { ok: true, texto: null };
  const limpo = texto.replace(/\u0000/g, "").trim();
  return { ok: true, texto: limpo ? limpo.slice(0, TEXTO_MAX) : null };
}

const visiveis = (s: string) => s.replace(/\s/g, "").length;

async function textoDoPdf(bytes: Uint8Array): Promise<Extracao> {
  const r = await extrairPdfEmProcesso(bytes, { textoMax: TEXTO_MAX });
  switch (r.tipo) {
    case "corrompido":
      return { ok: false, erro: "CORROMPIDO" };
    case "senha":
      return { ok: true, texto: null };
    case "falha":
      return { ok: true, texto: null, falha: r.motivo };
    case "texto": {
      const paginas = r.paginas.map((t) => t.trim());
      const total = paginas.reduce((n, t) => n + visiveis(t), 0);
      if (r.total === 0 || total / r.total < PDF_MIN_POR_PAGINA) return { ok: true, texto: null };
      return finalizar(paginas.filter(Boolean).join("\n\n"));
    }
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

class ZipInvalido extends Error {}

const u16 = (b: Buffer, i: number) => b.readUInt16LE(i);
const u32 = (b: Buffer, i: number) => b.readUInt32LE(i);

/**
 * Lê o diretório central do zip: nomes das entradas e onde está o
 * `word/document.xml` (sem descompactar nada). Zip64 e zip corrompido → erro.
 */
function lerZip(b: Buffer): { nomes: Set<string>; documento: { metodo: number; local: number; comprimido: number } | null } {
  // EOCD nos últimos 22 + 65535 bytes (comentário do zip).
  let eocd = -1;
  for (let i = b.length - 22; i >= Math.max(0, b.length - 22 - 0xffff); i--) {
    if (u32(b, i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new ZipInvalido("sem EOCD");
  const entradas = u16(b, eocd + 10);
  let p = u32(b, eocd + 16);
  const nomes = new Set<string>();
  let documento = null;
  for (let n = 0; n < entradas; n++) {
    if (p + 46 > b.length || u32(b, p) !== 0x02014b50) throw new ZipInvalido("diretório central");
    const metodo = u16(b, p + 10);
    const comprimido = u32(b, p + 20);
    const tamNome = u16(b, p + 28);
    const local = u32(b, p + 42);
    const nome = b.toString("utf8", p + 46, p + 46 + tamNome);
    nomes.add(nome);
    if (nome === "word/document.xml") {
      if (comprimido === 0xffffffff || local === 0xffffffff) throw new ZipInvalido("zip64");
      documento = { metodo, local, comprimido };
    }
    p += 46 + tamNome + u16(b, p + 30) + u16(b, p + 32);
  }
  return { nomes, documento };
}

function textoDoDocx(bytes: Uint8Array): Extracao {
  const b = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let xml: Buffer;
  try {
    const { nomes, documento } = lerZip(b);
    if (!nomes.has("[Content_Types].xml") || !documento) return { ok: false, erro: "TIPO_INVALIDO" };
    const { metodo, local, comprimido } = documento;
    if (local + 30 > b.length || u32(b, local) !== 0x04034b50) throw new ZipInvalido("cabeçalho local");
    const inicio = local + 30 + u16(b, local + 26) + u16(b, local + 28);
    if (inicio + comprimido > b.length) throw new ZipInvalido("dados truncados");
    const dados = b.subarray(inicio, inicio + comprimido);
    if (metodo === 0) {
      if (dados.length > DOCX_XML_MAX) throw new ZipInvalido("document.xml grande demais");
      xml = dados;
    } else if (metodo === 8) {
      // Estoura (RangeError) assim que passar do teto: não descompacta o resto.
      xml = inflateRawSync(dados, { maxOutputLength: DOCX_XML_MAX });
    } else {
      throw new ZipInvalido(`método ${metodo}`);
    }
  } catch {
    return { ok: false, erro: "CORROMPIDO" };
  }
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
