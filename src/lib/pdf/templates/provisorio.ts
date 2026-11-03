/**
 * Template PROVISÓRIO dos PDFs (spec fase 2 §7: o modelo oficial e o logo em
 * vetor da IJ vêm depois). Simples de propósito: A4, Inter, faixa fina no topo
 * com "Inteli Júnior" e o título, rodapé com a paginação. O oficial é outro
 * `TemplatePdf` em ./templates — o gerador e o fluxo não mudam.
 */
import { fontesInter } from "../fontes";
import type { Cor, TemplatePdf } from "../tipos";

const TINTA: Cor = { r: 0.11, g: 0.11, b: 0.13 };
const SUAVE: Cor = { r: 0.42, g: 0.42, b: 0.46 };
const LINHA: Cor = { r: 0.82, g: 0.82, b: 0.85 };
const MARCA: Cor = { r: 0.0, g: 0.3, b: 0.65 };

/** Corta com "…" para caber em `max` pontos (título longo no cabeçalho). */
function cortar(t: string, largura: (s: string) => number, max: number): string {
  if (largura(t) <= max) return t;
  let s = [...t];
  while (s.length > 1 && largura(`${s.join("")}…`) > max) s = s.slice(0, -1);
  return `${s.join("").trimEnd()}…`;
}

export const TEMPLATE_PROVISORIO: TemplatePdf = {
  nome: "provisorio",
  pagina: { largura: 595.28, altura: 841.89, margem: { topo: 78, base: 64, esquerda: 56, direita: 56 } },
  fontes: fontesInter,
  estilos: {
    texto: { tamanho: 10.5, entrelinha: 1.45, antes: 6, depois: 2, cor: TINTA },
    titulo1: { tamanho: 20, entrelinha: 1.25, antes: 14, depois: 6, cor: TINTA, negrito: true },
    titulo2: { tamanho: 14, entrelinha: 1.3, antes: 14, depois: 4, cor: MARCA, negrito: true },
    titulo3: { tamanho: 12, entrelinha: 1.3, antes: 10, depois: 2, cor: TINTA, negrito: true },
    rotulo: { tamanho: 10, entrelinha: 1.4, antes: 0, depois: 0, cor: SUAVE },
    tabela: { tamanho: 9.5, entrelinha: 1.35, antes: 8, depois: 6, cor: TINTA },
    recuoLista: 16,
    corLinha: LINHA,
  },
  cabecalho(p, ctx) {
    const topo = ctx.altura - 40;
    p.retangulo(0, ctx.altura - 6, ctx.largura, 6, MARCA);
    p.texto("Inteli Júnior", 56, topo, { tamanho: 9, negrito: true, cor: MARCA });
    p.texto(cortar(ctx.titulo, (t) => p.larguraDe(t, 8.5), ctx.largura - 56 * 2 - 120), ctx.largura - 56, topo, { tamanho: 8.5, cor: SUAVE, alinhar: "direita" });
    p.linha(56, topo - 8, ctx.largura - 56, topo - 8, { cor: LINHA });
  },
  rodape(p, ctx) {
    p.linha(56, 44, ctx.largura - 56, 44, { cor: LINHA });
    p.texto("Documento gerado pelo CRM da Inteli Júnior", 56, 30, { tamanho: 8, cor: SUAVE });
    p.texto(`Página ${ctx.pagina} de ${ctx.total}`, ctx.largura - 56, 30, { tamanho: 8, cor: SUAVE, alinhar: "direita" });
  },
};
