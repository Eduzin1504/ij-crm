/**
 * Gerador de PDF do CRM (GAB-89; o contrato do GAB-92 reaproveita): junta um
 * `DocumentoPdf` (conteúdo) com um `TemplatePdf` (a cara) e devolve os bytes.
 *
 * Por que pdf-lib (+ @pdf-lib/fontkit): JavaScript puro, sem binário nem
 * navegador (puppeteer/chromium não cabem no container de 512 MB), sem `fs`
 * dentro da lib (empacota no Next sem ajuste) e com fonte TrueType EMBUTIDA em
 * subconjunto — acentos e qualquer caractere que a fonte tenha, só com os
 * glifos usados (o arquivo fica pequeno). O pdf-lib não faz layout: a quebra
 * de linha/página é este módulo (texto corrido, listas, campos e tabela — o
 * que a proposta e o contrato usam).
 *
 * Caractere que a fonte não tem (emoji, ideograma) vira "?" em vez de um
 * glifo vazio: o PDF nunca sai com buraco silencioso.
 */
import fontkit from "@pdf-lib/fontkit";
import { PDFDocument, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import type { BlocoPdf, ContextoPagina, Cor, DocumentoPdf, EstiloTexto, Pincel, TemplatePdf, Trecho } from "./tipos";

/**
 * Sem as features de layout do OpenType (contextuais, ligaduras, kerning):
 * cada `drawText` roda o shaping do fontkit, e com elas a Inter custava ~60 ms
 * por página (uma proposta de 100 mil caracteres levava segundos). Para texto
 * latino de documento o resultado visual é o mesmo, e as larguras medidas
 * (`medir`, soma por caractere) passam a bater exatamente com o desenhado.
 */
const SEM_LAYOUT = { calt: false, liga: false, clig: false, kern: false, ccmp: false, locl: false, mark: false, mkmk: false, rlig: false, dlig: false } as const;

type Fontes = { regular: PDFFont; negrito: PDFFont; italico: PDFFont; negritoItalico: PDFFont };

const cor = (c: Cor) => rgb(c.r, c.g, c.b);

function fonteDe(f: Fontes, negrito?: boolean, italico?: boolean): PDFFont {
  if (negrito && italico) return f.negritoItalico;
  if (negrito) return f.negrito;
  if (italico) return f.italico;
  return f.regular;
}

/** Texto que a fonte desenha: espaços/controle normalizados e o que ela não tem → "?". */
export function limparTexto(t: string, suportados: ReadonlySet<number>): string {
  let saida = "";
  for (const ch of t.normalize("NFC")) {
    const cp = ch.codePointAt(0)!;
    if (cp === 0x09 || cp === 0x0a || cp === 0x0d || cp === 0xa0) saida += " ";
    else if (cp < 0x20 || (cp >= 0x7f && cp < 0xa0) || cp === 0x200b || cp === 0xfeff) continue;
    else saida += suportados.has(cp) ? ch : "?";
  }
  return saida;
}

/**
 * Largura = soma das larguras de cada caractere (cache por fonte). O
 * `widthOfTextAtSize` do pdf-lib roda o layout do fontkit a cada chamada:
 * medir palavra por palavra (e partir palavra longa) ficava quadrático.
 */
const larguras = new WeakMap<PDFFont, Map<string, number>>();
function medir(fonte: PDFFont, texto: string, tamanho: number): number {
  let cache = larguras.get(fonte);
  if (!cache) larguras.set(fonte, (cache = new Map()));
  let total = 0;
  for (const ch of texto) {
    let w = cache.get(ch);
    if (w === undefined) cache.set(ch, (w = fonte.widthOfTextAtSize(ch, 1000)));
    total += w;
  }
  return (total * tamanho) / 1000;
}

type Palavra = { texto: string; fonte: PDFFont; largura: number; espaco: number };

/** Quebra os trechos em linhas de até `max` pontos (palavra maior que a linha é partida). */
function quebrarLinhas(trechos: Trecho[], estilo: EstiloTexto, f: Fontes, limpar: (t: string) => string, max: number): Palavra[][] {
  const palavras: Palavra[] = [];
  for (const t of trechos) {
    const fonte = fonteDe(f, t.negrito ?? estilo.negrito, t.italico);
    const espaco = medir(fonte, " ", estilo.tamanho);
    const texto = limpar(t.texto);
    // Espaço na fronteira entre trechos ("**negrito** depois") conta como separador.
    const partes = texto.split(" ");
    partes.forEach((p, i) => {
      if (i > 0 && palavras.length) palavras[palavras.length - 1].espaco = espaco;
      if (p === "") return;
      // Trecho colado no anterior ("neg**rito**"): vira outra "palavra" com espaço 0 entre as duas.
      palavras.push({ texto: p, fonte, largura: medir(fonte, p, estilo.tamanho), espaco: 0 });
    });
  }
  const linhas: Palavra[][] = [];
  let atual: Palavra[] = [];
  let larg = 0;
  for (const p of palavras) {
    const pedacos = p.largura > max ? partirPalavra(p, estilo.tamanho, max) : [p];
    for (const q of pedacos) {
      const antes = atual.length ? atual[atual.length - 1].espaco : 0;
      if (atual.length && larg + antes + q.largura > max) {
        linhas.push(atual);
        atual = [];
        larg = 0;
      }
      larg += (atual.length ? atual[atual.length - 1].espaco : 0) + q.largura;
      atual.push(q);
    }
  }
  if (atual.length) linhas.push(atual);
  return linhas;
}

/**
 * Palavras seguidas na mesma fonte viram um `drawText` só (com os espaços):
 * cada chamada roda o layout do fontkit, e por palavra a proposta de 100 mil
 * caracteres levava segundos. `largura` inclui o espaço depois do grupo.
 */
function agrupar(linha: Palavra[]): { texto: string; fonte: PDFFont; largura: number }[] {
  const grupos: { texto: string; fonte: PDFFont; largura: number }[] = [];
  for (const p of linha) {
    const g = grupos.at(-1);
    const espaco = p.espaco > 0 ? " " : "";
    if (g && g.fonte === p.fonte) {
      g.texto += p.texto + espaco;
      g.largura += p.largura + p.espaco;
    } else grupos.push({ texto: p.texto + espaco, fonte: p.fonte, largura: p.largura + p.espaco });
  }
  return grupos;
}

function partirPalavra(p: Palavra, tamanho: number, max: number): Palavra[] {
  const saida: Palavra[] = [];
  let buf = "";
  let larg = 0;
  for (const ch of p.texto) {
    const w = medir(p.fonte, ch, tamanho);
    if (buf && larg + w > max) {
      saida.push({ texto: buf, fonte: p.fonte, largura: larg, espaco: 0 });
      buf = "";
      larg = 0;
    }
    buf += ch;
    larg += w;
  }
  saida.push({ texto: buf, fonte: p.fonte, largura: larg, espaco: p.espaco });
  return saida;
}

/** Gera o PDF. Determinístico para o mesmo conteúdo (datas de criação fixadas pelo chamador, se quiser). */
export async function gerarPdf(doc: DocumentoPdf, template: TemplatePdf, opts: { criadoEm?: Date } = {}): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkit);
  const bytes = await template.fontes();
  const f: Fontes = {
    regular: await pdf.embedFont(bytes.regular, { subset: true, features: SEM_LAYOUT }),
    negrito: await pdf.embedFont(bytes.negrito, { subset: true, features: SEM_LAYOUT }),
    italico: await pdf.embedFont(bytes.italico, { subset: true, features: SEM_LAYOUT }),
    negritoItalico: await pdf.embedFont(bytes.negritoItalico, { subset: true, features: SEM_LAYOUT }),
  };
  const suportados = new Set(f.regular.getCharacterSet());
  const limpar = (t: string) => limparTexto(t, suportados);

  pdf.setTitle(limpar(doc.titulo));
  pdf.setCreator("ij-crm");
  pdf.setProducer("ij-crm (pdf-lib)");
  if (doc.autor) pdf.setAuthor(limpar(doc.autor));
  if (doc.assunto) pdf.setSubject(limpar(doc.assunto));
  if (opts.criadoEm) {
    pdf.setCreationDate(opts.criadoEm);
    pdf.setModificationDate(opts.criadoEm);
  }

  const { largura: W, altura: H, margem } = template.pagina;
  const larguraUtil = W - margem.esquerda - margem.direita;
  const est = template.estilos;
  let pagina: PDFPage = pdf.addPage([W, H]);
  let y = H - margem.topo;

  const novaPagina = () => {
    pagina = pdf.addPage([W, H]);
    y = H - margem.topo;
  };
  /** Garante `altura` livre; senão vai para a próxima página. */
  const caber = (altura: number) => {
    if (y - altura < margem.base) novaPagina();
  };

  const desenharLinhas = (linhas: Palavra[][], estilo: EstiloTexto, x: number) => {
    const alturaLinha = estilo.tamanho * estilo.entrelinha;
    for (const linha of linhas) {
      caber(alturaLinha);
      y -= alturaLinha;
      let cx = x;
      for (const g of agrupar(linha)) {
        pagina.drawText(g.texto, { x: cx, y: y + (alturaLinha - estilo.tamanho) / 2, size: estilo.tamanho, font: g.fonte, color: cor(estilo.cor) });
        cx += g.largura;
      }
    }
  };

  const textoCorrido = (trechos: Trecho[], estilo: EstiloTexto, x: number, largura: number, primeiro: boolean) => {
    const linhas = quebrarLinhas(trechos, estilo, f, limpar, largura);
    if (!primeiro) y -= estilo.antes;
    // Título nunca fica sozinho no pé da página: leva junto o começo do que vem depois.
    if (estilo !== est.texto && estilo !== est.rotulo) caber(estilo.tamanho * estilo.entrelinha * linhas.length + est.texto.tamanho * est.texto.entrelinha * 2);
    desenharLinhas(linhas, estilo, x);
    y -= estilo.depois;
  };

  const blocos: BlocoPdf[] = [
    { tipo: "titulo", nivel: 1, trechos: [{ texto: doc.titulo }] },
    ...(doc.subtitulo ?? []).map((s): BlocoPdf => ({ tipo: "paragrafo", trechos: [{ texto: s }] })),
  ];
  const nAbertura = blocos.length;
  blocos.push(...doc.blocos);

  blocos.forEach((b, i) => {
    const primeiro = i === 0;
    switch (b.tipo) {
      case "titulo":
        textoCorrido(b.trechos, b.nivel === 1 ? est.titulo1 : b.nivel === 2 ? est.titulo2 : est.titulo3, margem.esquerda, larguraUtil, primeiro);
        break;
      case "paragrafo":
        textoCorrido(b.trechos, i < nAbertura ? est.rotulo : est.texto, margem.esquerda, larguraUtil, primeiro);
        break;
      case "item": {
        const recuo = est.recuoLista * (b.nivel + 1);
        const x = margem.esquerda + recuo;
        const linhas = quebrarLinhas(b.trechos.length ? b.trechos : [{ texto: "" }], est.texto, f, limpar, larguraUtil - recuo);
        y -= est.texto.antes / 2;
        const alturaLinha = est.texto.tamanho * est.texto.entrelinha;
        caber(alturaLinha);
        if (b.marcador) {
          const m = limpar(b.marcador);
          const lm = medir(f.regular, m, est.texto.tamanho);
          pagina.drawText(m, { x: x - lm - 5, y: y - alturaLinha + (alturaLinha - est.texto.tamanho) / 2, size: est.texto.tamanho, font: f.regular, color: cor(est.texto.cor) });
        }
        desenharLinhas(linhas.length ? linhas : [[]], est.texto, x);
        y -= est.texto.depois / 2;
        break;
      }
      case "linha":
        caber(est.texto.antes + est.texto.depois + 1);
        y -= est.texto.antes;
        pagina.drawLine({ start: { x: margem.esquerda, y }, end: { x: W - margem.direita, y }, thickness: 0.6, color: cor(est.corLinha) });
        y -= est.texto.depois;
        break;
      case "campos": {
        const rotuloLarg = Math.min(larguraUtil * 0.32, Math.max(...b.linhas.map((l) => medir(f.negrito, limpar(l.rotulo), est.texto.tamanho))) + 12);
        y -= est.texto.antes;
        for (const l of b.linhas) {
          const valor = quebrarLinhas([{ texto: l.valor }], est.texto, f, limpar, larguraUtil - rotuloLarg);
          const alturaLinha = est.texto.tamanho * est.texto.entrelinha;
          caber(alturaLinha);
          pagina.drawText(limpar(l.rotulo), { x: margem.esquerda, y: y - alturaLinha + (alturaLinha - est.texto.tamanho) / 2, size: est.texto.tamanho, font: f.negrito, color: cor(est.rotulo.cor) });
          desenharLinhas(valor.length ? valor : [[]], est.texto, margem.esquerda + rotuloLarg);
          y -= 2;
        }
        y -= est.texto.depois;
        break;
      }
      case "tabela":
        desenharTabela(b);
        break;
    }
  });

  function desenharTabela(b: Extract<BlocoPdf, { tipo: "tabela" }>) {
    const e = est.tabela;
    const alturaLinha = e.tamanho * e.entrelinha;
    const pad = 4;
    const xs: number[] = [];
    let acc = margem.esquerda;
    for (const c of b.colunas) {
      xs.push(acc);
      acc += c.largura * larguraUtil;
    }
    const celulas = (textos: string[], negrito: boolean) =>
      textos.map((t, i) => quebrarLinhas([{ texto: t, negrito }], e, f, limpar, b.colunas[i].largura * larguraUtil - pad * 2));
    const linhaDaTabela = (cs: Palavra[][][], fundo: Cor | null) => {
      const altura = Math.max(1, ...cs.map((c) => c.length)) * alturaLinha + pad;
      caber(altura);
      if (fundo) pagina.drawRectangle({ x: margem.esquerda, y: y - altura, width: larguraUtil, height: altura, color: cor(fundo) });
      cs.forEach((linhas, i) => {
        let cy = y - pad / 2;
        for (const l of linhas) {
          cy -= alturaLinha;
          const largTexto = l.reduce((s, p, j) => s + p.largura + (j < l.length - 1 ? p.espaco : 0), 0);
          let cx = b.colunas[i].alinhar === "direita" ? xs[i] + b.colunas[i].largura * larguraUtil - pad - largTexto : xs[i] + pad;
          for (const g of agrupar(l)) {
            pagina.drawText(g.texto, { x: cx, y: cy + (alturaLinha - e.tamanho) / 2, size: e.tamanho, font: g.fonte, color: cor(e.cor) });
            cx += g.largura;
          }
        }
      });
      y -= altura;
      pagina.drawLine({ start: { x: margem.esquerda, y }, end: { x: W - margem.direita, y }, thickness: 0.4, color: cor(est.corLinha) });
    };
    y -= e.antes;
    const cabecalho = celulas(b.colunas.map((c) => c.titulo), true);
    caber(alturaLinha * 2 + pad * 2);
    linhaDaTabela(cabecalho, { r: 0.95, g: 0.95, b: 0.95 });
    for (const l of b.linhas) {
      const cs = celulas(l, false);
      const altura = Math.max(1, ...cs.map((c) => c.length)) * alturaLinha + pad;
      if (y - altura < margem.base) {
        novaPagina();
        linhaDaTabela(cabecalho, { r: 0.95, g: 0.95, b: 0.95 });
      }
      linhaDaTabela(cs, null);
    }
    y -= e.depois;
  }

  // Cabeçalho e rodapé por último: o total de páginas já é conhecido.
  const paginas = pdf.getPages();
  paginas.forEach((pg, i) => {
    const ctx: ContextoPagina = { pagina: i + 1, total: paginas.length, largura: W, altura: H, titulo: doc.titulo };
    const pincel = pincelDe(pg, f, limpar, est.texto.cor);
    template.cabecalho?.(pincel, ctx);
    template.rodape?.(pincel, ctx);
  });

  return pdf.save();
}

function pincelDe(pg: PDFPage, f: Fontes, limpar: (t: string) => string, padrao: Cor): Pincel {
  return {
    texto(t, x, y, o = {}) {
      const tamanho = o.tamanho ?? 9;
      const fonte = fonteDe(f, o.negrito, o.italico);
      const s = limpar(t);
      const l = medir(fonte, s, tamanho);
      const x0 = o.alinhar === "direita" ? x - l : o.alinhar === "centro" ? x - l / 2 : x;
      pg.drawText(s, { x: x0, y, size: tamanho, font: fonte, color: cor(o.cor ?? padrao) });
    },
    linha(x1, y1, x2, y2, o = {}) {
      pg.drawLine({ start: { x: x1, y: y1 }, end: { x: x2, y: y2 }, thickness: o.espessura ?? 0.5, color: cor(o.cor ?? padrao) });
    },
    retangulo(x, y, largura, altura, c) {
      pg.drawRectangle({ x, y, width: largura, height: altura, color: cor(c) });
    },
    larguraDe(t, tamanho, negrito) {
      return medir(fonteDe(f, negrito), limpar(t), tamanho);
    },
  };
}
