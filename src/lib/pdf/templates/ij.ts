/**
 * Modelo da IJ (GAB-100, spec proposta-folha §4), em A4: capa com moldura e rede
 * vermelha, faixa preta com o logo no topo das páginas seguintes e a rede vermelha no
 * rodapé. Texto em Arimo (métricas da Arial) justificado, com recuo de primeira linha,
 * títulos pretos: o vermelho fica só nos desenhos.
 *
 * As proporções são as mesmas da folha na tela (`.folha` em globals.css).
 */
import { fontesIJ, imagensIJ } from "../fontes";
import type { Cor, TemplatePdf } from "../tipos";

const PRETO: Cor = { r: 0, g: 0, b: 0 };
const LARGURA = 595.28;
const ALTURA = 841.89;
const MARGEM_LADO = 70;
const ALTURA_FAIXA = LARGURA * (155 / 1132);
const ALTURA_RODAPE = LARGURA * (147 / 1128);
const hex = (n: number): Cor => ({ r: ((n >> 16) & 255) / 255, g: ((n >> 8) & 255) / 255, b: (n & 255) / 255 });

export const TEMPLATE_IJ: TemplatePdf = {
  nome: "ij",
  pagina: { largura: LARGURA, altura: ALTURA, margem: { topo: ALTURA_FAIXA + 18, base: ALTURA_RODAPE + 6, esquerda: MARGEM_LADO, direita: MARGEM_LADO } },
  fontes: fontesIJ,
  imagens: imagensIJ,
  estilos: {
    texto: { tamanho: 11, entrelinha: 1.32, antes: 7, depois: 2, cor: PRETO, alinhar: "justificado", recuoPrimeira: 34 },
    titulo1: { tamanho: 18, entrelinha: 1.25, antes: 0, depois: 10, cor: PRETO, negrito: true, alinhar: "centro" },
    titulo2: { tamanho: 13.5, entrelinha: 1.3, antes: 13, depois: 4, cor: PRETO, negrito: true },
    titulo3: { tamanho: 11, entrelinha: 1.3, antes: 10, depois: 3, cor: PRETO, negrito: true, recuo: 34 },
    rotulo: { tamanho: 10, entrelinha: 1.4, antes: 0, depois: 0, cor: PRETO },
    tabela: { tamanho: 9.5, entrelinha: 1.3, antes: 8, depois: 10, cor: PRETO },
    tabelaCores: { cabecalho: hex(0x1f1f1f), textoCabecalho: { r: 1, g: 1, b: 1 }, borda: PRETO, total: hex(0xf3e3e3) },
    recuoLista: 34,
    corLinha: PRETO,
  },
  capa(p, ctx, capa) {
    const { largura: W, altura: H } = ctx;
    p.imagem("capa", 0, 0, W, H);
    const direita = W * (1 - 0.118);
    const esquerda = W * 0.11;
    const linha = (y: number, t: string, tamanho: number, negrito: boolean) => {
      // Nome de empresa comprido encolhe até caber; não corta nem sai da moldura.
      let s = tamanho;
      while (s > 9 && p.larguraDe(t, s, negrito, "capa") > direita - esquerda) s -= 0.5;
      p.texto(t, direita, y, { tamanho: s, negrito, familia: "capa", cor: PRETO, alinhar: "direita" });
    };
    const topo = H * (1 - 0.59);
    linha(topo - 19, capa.titulo, 19, true);
    linha(topo - 19 - 34, capa.empresa, 19, true);
    linha(topo - 19 - 34 - 44, capa.data, 11.5, false);
    p.texto(capa.endereco, W * 0.205, H * (1 - 0.86) - 11.5, { tamanho: 11.5, familia: "capa", cor: PRETO });
  },
  cabecalho(p, ctx) {
    p.imagem("faixa", 0, ctx.altura - ALTURA_FAIXA, ctx.largura, ALTURA_FAIXA);
  },
  rodape(p, ctx) {
    p.imagem("rodape", 0, 0, ctx.largura, ALTURA_RODAPE);
  },
};
