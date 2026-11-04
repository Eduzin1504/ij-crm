/**
 * Conversão Markdown ↔ documento da proposta (GAB-86). Fonte da verdade
 * gravada: o Markdown CANÔNICO que `documentoParaMarkdown` produz.
 *
 * - `documentoParaMarkdown`: serializador próprio (o subconjunto é pequeno);
 *   escapa todo caractere de texto que o Markdown leria como formatação.
 * - `markdownParaDocumento`: o lexer do `marked` (sem dependências, só no
 *   servidor) quebra o Markdown em tokens; cada token fora do subconjunto
 *   (link, imagem, HTML, código, tabela…) vira TEXTO literal. Nada aqui gera
 *   HTML: a tela desenha o documento como elementos React (texto escapado), e
 *   o editor recebe JSON — Markdown/HTML vindo do MCP nunca injeta marcação.
 *
 * Blocos móveis (GAB-100): comentário HTML sozinho na linha, no nível de cima:
 * `<!-- bloco:cronograma -->`, `<!-- bloco:investimento -->`, e `<!-- bloco:nenhum -->`
 * quando os dois foram tirados da folha. Texto que só parece um marcador sai
 * escapado (`\\<!-- ...`), então Markdown canônico antigo nunca vira bloco, e
 * qualquer outro comentário continua literal. Só esses três viram nó, e o nó não
 * guarda dado nenhum: só o lugar.
 *
 * Garantias (testadas em `markdown.test.ts`, inclusive com documentos
 * aleatórios): para todo documento normalizado `d`,
 * `markdownParaDocumento(documentoParaMarkdown(d))` é `d`; e o Markdown
 * canônico é ponto fixo de `normalizarMarkdown`.
 */
import { Lexer, type Token, type Tokens } from "marked";
import { MARCAS, normalizarDocumento, type Bloco, type Documento, type ItemLista, type Marca, type NoTexto, type TipoBlocoDados } from "./documento";

// ---------------------------------------------------------------- doc → Markdown

const DELIM: Record<Marca, string> = { bold: "**", italic: "*" };

const marcadorDe = (tipo: TipoBlocoDados | "nenhum") => `<!-- bloco:${tipo} -->`;
const MARCADOR = /^<!--\s*bloco:(cronograma|investimento|nenhum)\s*-->$/;

/** Caracteres que o Markdown pode ler como formatação em qualquer ponto da linha. */
const ESCAPAR_SEMPRE = /[\\*_`[\]<~]/g;

function escaparTexto(texto: string, inicioDeLinha: boolean, emTitulo: boolean): string {
  // `&` só antes de algo com cara de entidade (`&#42;`, `&amp;`): o `marked` decodifica algumas.
  let s = texto.replace(ESCAPAR_SEMPRE, (c) => `\\${c}`).replace(/&(?=#?[0-9A-Za-z]+;)/g, "\\&");
  if (emTitulo) s = s.replace(/#/g, "\\#");
  if (inicioDeLinha) {
    if (/^[#>+\-=|]/.test(s)) s = `\\${s}`;
    else s = s.replace(/^(\d{1,9})([.)])/, "$1\\$2");
  }
  return s;
}

/**
 * Texto inline com as marcas como pilha de delimitadores. A marca que vai mais
 * longe abre primeiro (fica por fora): assim "itálico que contém um negrito"
 * sai `*a **b** c*` e não fecha/reabre delimitadores colados.
 */
function serializarInline(content: NoTexto[] | undefined, emTitulo = false): string {
  const nos = content ?? [];
  const marcasDe = (n: NoTexto) => MARCAS.filter((m) => (n.marks ?? []).some((x) => x.type === m));
  const marcas = nos.map(marcasDe);
  // alcance[m][i]: quantos nós seguidos, a partir de i, têm a marca m (linear, de trás para frente)
  const alcances = Object.fromEntries(
    MARCAS.map((m) => {
      const a = new Array<number>(nos.length + 1).fill(0);
      for (let i = nos.length - 1; i >= 0; i--) a[i] = marcas[i].includes(m) ? a[i + 1] + 1 : 0;
      return [m, a];
    }),
  ) as Record<Marca, number[]>;
  const alcance = (m: Marca, de: number) => alcances[m][de];
  let saida = "";
  const abertas: Marca[] = [];
  nos.forEach((n, i) => {
    const quer = marcas[i];
    // fecha da primeira marca aberta que não continua até o topo da pilha
    const corte = abertas.findIndex((m) => !quer.includes(m));
    if (corte >= 0) {
      for (let k = abertas.length - 1; k >= corte; k--) saida += DELIM[abertas[k]];
      abertas.length = corte;
    }
    const novas = quer.filter((m) => !abertas.includes(m)).sort((a, b) => alcance(b, i) - alcance(a, i) || MARCAS.indexOf(a) - MARCAS.indexOf(b));
    for (const m of novas) {
      saida += DELIM[m];
      abertas.push(m);
    }
    saida += escaparTexto(n.text, saida.length === 0, emTitulo);
  });
  for (let k = abertas.length - 1; k >= 0; k--) saida += DELIM[abertas[k]];
  return saida;
}

function indentar(linhas: string[], recuo: string): string[] {
  return linhas.map((l) => (l === "" ? "" : recuo + l));
}

function serializarItem(item: ItemLista, marcador: string): string[] {
  const linhas: string[] = [];
  item.content.forEach((b, i) => {
    const sub = serializarBloco(b);
    if (i > 0) {
      // sublista cola no parágrafo; outro bloco precisa de linha em branco
      if (b.type !== "bulletList" && b.type !== "orderedList") linhas.push("");
    }
    linhas.push(...sub);
  });
  const recuo = " ".repeat(marcador.length + 1);
  const [primeira = "", ...resto] = linhas;
  return [primeira === "" ? marcador : `${marcador} ${primeira}`, ...indentar(resto, recuo)];
}

function serializarBloco(b: Bloco): string[] {
  switch (b.type) {
    case "paragraph":
      return [serializarInline(b.content)];
    case "heading":
      return [`${"#".repeat(b.attrs.level)} ${serializarInline(b.content, true)}`];
    case "horizontalRule":
      return ["---"];
    case "blocoDados":
      return [marcadorDe(b.attrs.tipo)];
    case "semBlocos":
      return [marcadorDe("nenhum")];
    case "bulletList":
      return b.content.flatMap((it) => serializarItem(it, "-"));
    case "orderedList":
      return b.content.flatMap((it, i) => serializarItem(it, `${b.attrs.start + i}.`));
  }
}

export function documentoParaMarkdown(doc: Documento): string {
  return normalizarDocumento(doc)
    .content.map((b) => serializarBloco(b).join("\n"))
    .join("\n\n");
}

// ---------------------------------------------------------------- Markdown → doc

type Contexto = Set<Marca>;

function texto(text: string, marcas: Contexto): NoTexto {
  const ms = MARCAS.filter((m) => marcas.has(m));
  return ms.length ? { type: "text", text, marks: ms.map((type) => ({ type })) } : { type: "text", text };
}

function inline(tokens: Token[] | undefined, marcas: Contexto = new Set()): NoTexto[] {
  const saida: NoTexto[] = [];
  for (const tk of tokens ?? []) {
    switch (tk.type) {
      case "text": {
        const t = tk as Tokens.Text;
        if (t.tokens?.length) saida.push(...inline(t.tokens, marcas));
        else saida.push(texto(t.text, marcas));
        break;
      }
      case "escape":
        saida.push(texto(tk.raw.slice(1), marcas));
        break;
      case "strong":
        saida.push(...inline((tk as Tokens.Strong).tokens, new Set([...marcas, "bold"])));
        break;
      case "em":
        saida.push(...inline((tk as Tokens.Em).tokens, new Set([...marcas, "italic"])));
        break;
      case "br":
        saida.push(texto(" ", marcas));
        break;
      case "checkbox":
        saida.push(texto((tk as Tokens.Checkbox).checked ? "[x] " : "[ ] ", marcas));
        break;
      default:
        // link, imagem, código, riscado, HTML…: o texto original, literal
        saida.push(texto(tk.raw, marcas));
    }
  }
  return saida;
}

/** Linhas não vazias de um trecho cru → parágrafos de texto literal. */
function paragrafosLiterais(cru: string): Bloco[] {
  return cru
    .split(/\r\n?|\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => ({ type: "paragraph", content: [{ type: "text", text: l }] }));
}

/** `topo`: nível de cima do documento, o único lugar onde um marcador vira bloco móvel. */
function blocos(tokens: Token[] | undefined, topo = false): Bloco[] {
  const saida: Bloco[] = [];
  for (const tk of tokens ?? []) {
    switch (tk.type) {
      case "space":
        break;
      case "paragraph":
        saida.push({ type: "paragraph", content: inline((tk as Tokens.Paragraph).tokens) });
        break;
      case "text": {
        const t = tk as Tokens.Text;
        saida.push({ type: "paragraph", content: t.tokens?.length ? inline(t.tokens) : [{ type: "text", text: t.text }] });
        break;
      }
      case "heading": {
        const h = tk as Tokens.Heading;
        saida.push({ type: "heading", attrs: { level: Math.min(3, h.depth) as 1 | 2 | 3 }, content: inline(h.tokens) });
        break;
      }
      case "hr":
        saida.push({ type: "horizontalRule" });
        break;
      case "list": {
        const l = tk as Tokens.List;
        const content: ItemLista[] = l.items.map((it) => ({ type: "listItem", content: blocos(it.tokens) }));
        const inicio = typeof l.start === "number" ? l.start : 1;
        saida.push(l.ordered ? { type: "orderedList", attrs: { start: inicio }, content } : { type: "bulletList", content });
        break;
      }
      case "blockquote":
        saida.push(...blocos((tk as Tokens.Blockquote).tokens));
        break;
      case "table": {
        const tb = tk as Tokens.Table;
        for (const linha of [tb.header, ...tb.rows]) {
          const content: NoTexto[] = [];
          linha.forEach((cel, i) => {
            if (i > 0) content.push({ type: "text", text: " | " });
            content.push(...inline(cel.tokens));
          });
          saida.push({ type: "paragraph", content });
        }
        break;
      }
      case "code":
        saida.push(...paragrafosLiterais((tk as Tokens.Code).text));
        break;
      case "html": {
        const m = topo ? MARCADOR.exec(tk.raw.trim()) : null;
        if (!m) saida.push(...paragrafosLiterais(tk.raw));
        else if (m[1] === "nenhum") saida.push({ type: "semBlocos" });
        else saida.push({ type: "blocoDados", attrs: { tipo: m[1] as TipoBlocoDados } });
        break;
      }
      default:
        // HTML de bloco, definição de link, qualquer outro: texto literal
        saida.push(...paragrafosLiterais(tk.raw));
    }
  }
  return saida;
}

export function markdownParaDocumento(md: string): Documento {
  const tokens = new Lexer({ gfm: true, breaks: false }).lex(md);
  return normalizarDocumento({ type: "doc", content: blocos(tokens, true) });
}

/** Markdown qualquer (ex.: vindo do MCP) → Markdown canônico do subconjunto. */
export function normalizarMarkdown(md: string): string {
  return documentoParaMarkdown(markdownParaDocumento(md));
}
