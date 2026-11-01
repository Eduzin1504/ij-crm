/**
 * Arquivos mínimos e válidos para os testes de anexos (GAB-84), gerados em
 * memória: PDF com uma página de texto por item, .docx com parágrafos, e
 * cabeçalhos de imagem (só o magic number importa para a validação).
 */
import { strToU8, zipSync } from "fflate";

const enc = new TextEncoder();

/** PDF 1.4 com uma página por texto (Helvetica, ASCII). Lista vazia de textos = página em branco ("escaneado"). */
export function pdfDeTexto(paginas: string[]): Uint8Array {
  const conteudos = paginas.map((t) => (t ? `BT /F1 12 Tf 72 720 Td (${t}) Tj ET` : ""));
  const n = conteudos.length;
  // 1 catálogo, 2 páginas, 3 fonte, depois (página, conteúdo) para cada uma.
  const kids = conteudos.map((_, i) => `${4 + i * 2} 0 R`).join(" ");
  const objs = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    `<< /Type /Pages /Kids [${kids}] /Count ${n} >>`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    ...conteudos.flatMap((c, i) => [
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents ${5 + i * 2} 0 R /Resources << /Font << /F1 3 0 R >> >> >>`,
      `<< /Length ${c.length} >>\nstream\n${c}\nendstream`,
    ]),
  ];
  let out = "%PDF-1.4\n";
  const offs: number[] = [];
  objs.forEach((o, i) => {
    offs.push(out.length);
    out += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n` + offs.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("");
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return enc.encode(out);
}

const CONTENT_TYPES =
  '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
  '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>';

/** .docx mínimo: cada parágrafo vira um `<w:p>` com um `<w:t>` (XML escapado). */
export function docxDeParagrafos(paragrafos: string[], extras: Record<string, Uint8Array> = {}): Uint8Array {
  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const corpo = paragrafos.map((p) => `<w:p><w:r><w:t xml:space="preserve">${esc(p)}</w:t></w:r></w:p>`).join("");
  const doc = `<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${corpo}</w:body></w:document>`;
  return zipSync({ "[Content_Types].xml": strToU8(CONTENT_TYPES), "word/document.xml": strToU8(doc), ...extras });
}

/** Zip que não é .docx (sem word/document.xml). */
export function zipQualquer(): Uint8Array {
  return zipSync({ "leia-me.txt": strToU8("oi") });
}

export const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
export const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46, 0, 1, 0xff, 0xd9]);
export const WEBP = enc.encode("RIFF\x10\x00\x00\x00WEBPVP8 ");
