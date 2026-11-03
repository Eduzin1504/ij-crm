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
 */
import type { Bloco, Documento, ItemLista } from "./documento";

export const CONTEXTO_ANCORA = 40;
export const TRECHO_MAX = 500;

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
    if (b.type === "paragraph" || b.type === "heading") {
      const t = (b.content ?? []).map((n) => n.text).join("");
      if (!t) return;
      if (texto) texto += "\n";
      inicios.set(b, texto.length);
      texto += t;
    } else if (b.type === "bulletList" || b.type === "orderedList" || b.type === "listItem") b.content.forEach(visitar);
  };
  doc.content.forEach(visitar);
  return { texto, inicios };
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
  for (let i = texto.indexOf(a.trecho); i !== -1; i = texto.indexOf(a.trecho, i + 1)) {
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
