/**
 * Processo filho da extração de texto de PDF (GAB-84). Roda FORA do servidor
 * Next: o pdf.js descompacta os streams (FlateDecode) inteiros, de forma
 * síncrona, e um PDF malicioso de 1 MB chega a GBs de memória ou trava o event
 * loop por segundos. Aqui isso só derruba este processo; o pai
 * (./pdf-processo.ts) mata por tempo e por memória (RSS) e segue o upload como
 * "sem texto".
 *
 * Protocolo: PDF inteiro pelo stdin; uma linha JSON no stdout:
 *   { "paginas": string[], "total": n }   texto por página (cortado em TEXTO_MAX no total)
 *                                         (com SO_CONTAR=1: só abre e conta, `paginas` vazio — GAB-90)
 *   { "senha": true }                     PDF protegido por senha
 *   { "corrompido": true }                o pdf.js não abriu o arquivo
 *
 * JavaScript puro (.mjs), sem TypeScript nem alias: é executado direto pelo
 * `node`, também no standalone de produção (next.config: outputFileTracingIncludes).
 */
import { getDocumentProxy } from "unpdf";

// O pdf.js avisa por console.log: o stdout é só do protocolo.
console.log = console.info = console.warn = (...a) => process.stderr.write(`${a.join(" ")}\n`);

const TEXTO_MAX = Number(process.env.TEXTO_MAX) || 1_000_000;

async function lerStdin() {
  const partes = [];
  for await (const p of process.stdin) partes.push(p);
  return new Uint8Array(Buffer.concat(partes));
}

function responder(obj) {
  process.stdout.write(`${JSON.stringify(obj)}\n`, () => process.exit(0));
}

const bytes = await lerStdin();
let doc;
try {
  doc = await getDocumentProxy(bytes);
} catch (e) {
  responder(e && e.name === "PasswordException" ? { senha: true } : { corrompido: true });
}
if (doc && process.env.SO_CONTAR === "1") {
  responder({ paginas: [], total: doc.numPages });
} else if (doc) {
  const paginas = [];
  let total = 0;
  // Página a página (e não `extractText` de tudo): para assim que o teto de texto enche.
  for (let i = 1; i <= doc.numPages && total < TEXTO_MAX; i++) {
    const conteudo = await (await doc.getPage(i)).getTextContent();
    const texto = conteudo.items.map((it) => ("str" in it ? it.str + (it.hasEOL ? "\n" : "") : "")).join("");
    const t = texto.slice(0, TEXTO_MAX - total);
    paginas.push(t);
    total += t.length;
  }
  responder({ paginas, total: doc.numPages });
}
