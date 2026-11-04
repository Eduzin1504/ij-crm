/**
 * Âncora de comentário num trecho da proposta (GAB-91). Puro: roda no
 * servidor (MCP, "trecho alterado"), no editor (decoração do ProseMirror) e
 * na visualização (realce).
 *
 * Por que texto citado + contexto, e não uma marca no documento: o texto é
 * Markdown canônico com um subconjunto validado de nós/marcas
 * (`./documento.ts`); uma marca "comentário" quebraria a validação e o
 * Markdown que o MCP lê e escreve. E posições absolutas não sobrevivem ao
 * rascunho mudando a cada tecla. Então a âncora guarda o TRECHO citado e até
 * `CONTEXTO_ANCORA` caracteres antes e depois, medidos no "texto plano" do
 * documento (blocos de texto não vazios, na ordem, separados por `\n` — o
 * mesmo no editor e na visualização). Para achar: todas as ocorrências do
 * trecho no texto atual; com mais de uma, vence a de contexto mais parecido.
 * Não achou → "trecho alterado" (o comentário continua visível).
 *
 * O texto plano é sempre o do documento CANÔNICO: o Markdown não guarda
 * espaços repetidos, tab, quebra de linha dentro do bloco nem espaço nas
 * pontas (`normalizarInline` em `./documento.ts`). O editor ao vivo pode ter
 * "a  b"; por isso ele normaliza cada bloco com `normalizarBloco` (e um mapa
 * para a posição crua) antes de criar ou procurar âncoras — senão o trecho
 * digitado com dois espaços ficaria "alterado" para todo mundo.
 *
 * Bloco móvel (GAB-100): entra no texto plano pelo título FIXO ("Cronograma"), na
 * posição em que está na folha, e nunca pelos dados. Assim o texto plano sai do
 * Markdown sozinho (servidor e MCP não precisam da parte estruturada), mudar valor
 * ou entrega não deixa comentário "alterado", e dá para comentar o bloco citando o
 * título. Tirar o bloco da folha marca o comentário dele como "trecho alterado".
 */
import { TITULO_BLOCO_DADOS } from "./blocos-dados";
import { documentoComBlocos, type Bloco, type Documento, type ItemLista, type TipoBlocoDados } from "./documento";

export const CONTEXTO_ANCORA = 40;
export const TRECHO_MAX = 500;
/** Teto de ocorrências examinadas (trecho curto repetido num texto enorme não trava a tecla). */
export const OCORRENCIAS_MAX = 200;

const CONTROLE = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/;

/**
 * Normaliza o texto de UM bloco como o Markdown canônico faz
 * (`normalizarInline`): quebra de linha e tab → espaço, sem caracteres de
 * controle, sem espaço nas pontas, espaços repetidos → um. `mapa[i]` = índice
 * no texto cru do i-ésimo caractere do texto normalizado.
 */
export function normalizarBloco(cru: string): { texto: string; mapa: number[] } {
  const cs: { c: string; i: number }[] = [];
  for (let i = 0; i < cru.length; i++) {
    let c = cru[i];
    if (c === "\r" && cru[i + 1] === "\n") continue; // CRLF = uma quebra
    if (c === "\r" || c === "\n" || c === "\t") c = " ";
    else if (CONTROLE.test(c)) continue;
    cs.push({ c, i });
  }
  let a = 0;
  let b = cs.length;
  while (a < b && /\s/u.test(cs[a].c)) a++;
  while (b > a && /\s/u.test(cs[b - 1].c)) b--;
  let texto = "";
  const mapa: number[] = [];
  for (let k = a; k < b; k++) {
    if (cs[k].c === " " && texto.endsWith(" ")) continue;
    texto += cs[k].c;
    mapa.push(cs[k].i);
  }
  return { texto, mapa };
}

/** Trecho citado (pode atravessar blocos, separados por `\n`) no formato canônico. */
export function normalizarTrecho(t: string): string {
  return t
    .split("\n")
    .map((p) => normalizarBloco(p).texto)
    .filter(Boolean)
    .join("\n");
}

/** Contexto da âncora: só tira o que o canônico nunca tem (sem aparar: a borda com o trecho importa). */
export function normalizarContexto(t: string): string {
  return t
    .replace(/\r\n?/g, "\n")
    .replace(/\t/g, " ")
    .replace(new RegExp(CONTROLE.source, "g"), "")
    .replace(/ {2,}/g, " ");
}

export type Ancora = { trecho: string; antes: string; depois: string };
export type Faixa = { inicio: number; fim: number };

/**
 * Texto plano do documento e onde começa cada bloco de texto nele (pela
 * identidade do objeto do bloco: a visualização desenha a partir disso).
 */
export function textoPlano(doc: Documento): { texto: string; inicios: Map<object, number> } {
  const inicios = new Map<object, number>();
  let texto = "";
  const visitar = (b: Bloco | ItemLista) => {
    if (b.type === "paragraph" || b.type === "heading" || b.type === "blocoDados") {
      const t = b.type === "blocoDados" ? TITULO_BLOCO_DADOS[b.attrs.tipo] : (b.content ?? []).map((n) => n.text).join("");
      if (!t) return;
      if (texto) texto += "\n";
      inicios.set(b, texto.length);
      texto += t;
    } else if (b.type === "bulletList" || b.type === "orderedList" || b.type === "listItem") b.content.forEach(visitar);
  };
  documentoComBlocos(doc).content.forEach(visitar);
  return { texto, inicios };
}

/** Âncora que aponta para um bloco móvel (o título dele, com o contexto da posição). null = fora da folha. */
export function ancoraDoBloco(doc: Documento, tipo: TipoBlocoDados): Ancora | null {
  const { texto, inicios } = textoPlano(doc);
  const bloco = documentoComBlocos(doc).content.find((b) => b.type === "blocoDados" && b.attrs.tipo === tipo);
  const inicio = bloco ? inicios.get(bloco) : undefined;
  return inicio === undefined ? null : criarAncora(texto, inicio, inicio + TITULO_BLOCO_DADOS[tipo].length);
}

/** Âncora da seleção [inicio, fim) do texto plano. Aparada; vazia ou longa demais → null. */
export function criarAncora(texto: string, inicio: number, fim: number): Ancora | null {
  let a = Math.max(0, Math.min(inicio, fim));
  let b = Math.min(texto.length, Math.max(inicio, fim));
  while (a < b && /\s/.test(texto[a])) a++;
  while (b > a && /\s/.test(texto[b - 1])) b--;
  if (a >= b || b - a > TRECHO_MAX) return null;
  return { trecho: texto.slice(a, b), antes: texto.slice(Math.max(0, a - CONTEXTO_ANCORA), a), depois: texto.slice(b, b + CONTEXTO_ANCORA) };
}

function sufixoComum(a: string, b: string): number {
  let n = 0;
  while (n < a.length && n < b.length && a[a.length - 1 - n] === b[b.length - 1 - n]) n++;
  return n;
}

function prefixoComum(a: string, b: string): number {
  let n = 0;
  while (n < a.length && n < b.length && a[n] === b[n]) n++;
  return n;
}

/** Onde a âncora está no texto atual; null = trecho alterado/apagado. */
export function localizarAncora(texto: string, a: Ancora): Faixa | null {
  if (!a.trecho) return null;
  let melhor: Faixa | null = null;
  let pontos = -1;
  let n = 0;
  for (let i = texto.indexOf(a.trecho); i !== -1 && n < OCORRENCIAS_MAX; i = texto.indexOf(a.trecho, i + 1), n++) {
    const fim = i + a.trecho.length;
    const p = sufixoComum(a.antes, texto.slice(Math.max(0, i - a.antes.length), i)) + prefixoComum(a.depois, texto.slice(fim, fim + a.depois.length));
    if (p > pontos) {
      pontos = p;
      melhor = { inicio: i, fim };
    }
  }
  return melhor;
}

export type Destaque = Faixa & { id: string };
export type Segmento = Faixa & { ids: string[] };

/** Corta o bloco [inicio, inicio+tamanho) nas bordas dos destaques que o tocam. */
export function segmentosDeDestaque(inicio: number, tamanho: number, destaques: readonly Destaque[]): Segmento[] {
  const fim = inicio + tamanho;
  const dentro = destaques.filter((d) => d.inicio < fim && d.fim > inicio);
  const bordas = [...new Set([inicio, fim, ...dentro.flatMap((d) => [d.inicio, d.fim]).filter((x) => x > inicio && x < fim)])].sort((x, y) => x - y);
  const out: Segmento[] = [];
  for (let k = 0; k < bordas.length - 1; k++) {
    const s = bordas[k];
    const e = bordas[k + 1];
    out.push({ inicio: s, fim: e, ids: dentro.filter((d) => d.inicio <= s && d.fim >= e).map((d) => d.id) });
  }
  return out;
}
