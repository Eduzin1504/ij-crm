/**
 * Arquivos mínimos e válidos para os testes de anexos (GAB-84), gerados em
 * memória: PDF com uma página de texto por item, .docx com parágrafos, e
 * cabeçalhos de imagem (só o magic number importa para a validação).
 */
import { deflateRawSync, deflateSync } from "node:zlib";
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

/**
 * PDF "bomba" (review do PR #53): um único stream FlateDecode que descompacta
 * para `mb` MB. `modo: "espacos"` = só espaços (estoura memória no pdf.js);
 * `modo: "tj"` = milhares de `Tj` (trava a CPU na extração de texto).
 */
export function pdfBomba(mb: number, modo: "espacos" | "tj" = "espacos"): Uint8Array {
  const unidade =
    modo === "espacos" ? Buffer.alloc(1024 * 1024, 0x20) : Buffer.from("BT /F1 12 Tf 0 0 Td (AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA) Tj ET\n".repeat(13000));
  const comp = deflateSync(Buffer.concat(Array.from({ length: mb }, () => unidade)), { level: 9 });
  const objs: (string | null)[] = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
    null,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  const partes: Buffer[] = [Buffer.from("%PDF-1.4\n")];
  let tam = partes[0].length;
  const offs: number[] = [];
  objs.forEach((o, i) => {
    offs.push(tam);
    const b =
      o === null
        ? Buffer.concat([Buffer.from(`${i + 1} 0 obj\n<< /Length ${comp.length} /Filter /FlateDecode >>\nstream\n`), comp, Buffer.from("\nendstream\nendobj\n")])
        : Buffer.from(`${i + 1} 0 obj\n${o}\nendobj\n`);
    partes.push(b);
    tam += b.length;
  });
  partes.push(
    Buffer.from(
      `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offs.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("")}trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${tam}\n%%EOF\n`,
    ),
  );
  return new Uint8Array(Buffer.concat(partes));
}

/**
 * .docx "bomba" (review do PR #53): `word/document.xml` com `mb` MB reais de
 * "a" comprimidos, e o tamanho DECLARADO no zip mentindo (1000 bytes).
 */
export function docxBomba(mb: number): Uint8Array {
  const comp = deflateRawSync(Buffer.alloc(mb * 1024 * 1024, 0x61), { level: 9 });
  const ct = Buffer.from("[Content_Types].xml");
  const ctDados = Buffer.from("<Types/>");
  const doc = Buffer.from("word/document.xml");
  const local = (nome: Buffer, metodo: number, dados: Buffer, declarado: number) => {
    const h = Buffer.alloc(30);
    h.writeUInt32LE(0x04034b50, 0);
    h.writeUInt16LE(20, 4);
    h.writeUInt16LE(metodo, 8);
    h.writeUInt32LE(dados.length, 18);
    h.writeUInt32LE(declarado, 22);
    h.writeUInt16LE(nome.length, 26);
    return Buffer.concat([h, nome, dados]);
  };
  const central = (nome: Buffer, metodo: number, dados: Buffer, declarado: number, offset: number) => {
    const h = Buffer.alloc(46);
    h.writeUInt32LE(0x02014b50, 0);
    h.writeUInt16LE(20, 4);
    h.writeUInt16LE(20, 6);
    h.writeUInt16LE(metodo, 10);
    h.writeUInt32LE(dados.length, 20);
    h.writeUInt32LE(declarado, 24);
    h.writeUInt16LE(nome.length, 28);
    h.writeUInt32LE(offset, 42);
    return Buffer.concat([h, nome]);
  };
  const l1 = local(ct, 0, ctDados, ctDados.length);
  const l2 = local(doc, 8, comp, 1000);
  const cd = Buffer.concat([central(ct, 0, ctDados, ctDados.length, 0), central(doc, 8, comp, 1000, l1.length)]);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(2, 8);
  eocd.writeUInt16LE(2, 10);
  eocd.writeUInt32LE(cd.length, 12);
  eocd.writeUInt32LE(l1.length + l2.length, 16);
  return new Uint8Array(Buffer.concat([l1, l2, cd, eocd]));
}
