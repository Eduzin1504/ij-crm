/**
 * Documento de PDF do CRM (GAB-89; reaproveitado pelo contrato, GAB-92): o
 * CONTEÚDO, em blocos simples, separado do TEMPLATE (a cara: página, fontes,
 * cores, cabeçalho e rodapé). Quem gera (`./gerador.ts`) só junta os dois.
 *
 * Trocar o template provisório pelo oficial da IJ = escrever outro
 * `TemplatePdf` e apontar `templateAtual` (./templates) para ele — o fluxo
 * (proposta, contrato) e o gerador não mudam.
 */

/** Trecho de texto com a formatação que o editor da proposta permite. */
export type Trecho = { texto: string; negrito?: boolean; italico?: boolean };

export type BlocoPdf =
  | { tipo: "titulo"; nivel: 1 | 2 | 3; trechos: Trecho[] }
  | { tipo: "paragrafo"; trechos: Trecho[] }
  /** Item de lista: `marcador` ("•", "1.") só no 1º parágrafo do item; `nivel` 0 = lista de fora. */
  | { tipo: "item"; marcador: string | null; nivel: number; trechos: Trecho[] }
  | { tipo: "linha" }
  /** Pares rótulo → valor (ex.: Valor total, Prazo). */
  | { tipo: "campos"; linhas: { rotulo: string; valor: string }[] }
  /** Tabela simples: `largura` em frações (somam 1); cabeçalho repetido se a tabela quebra de página. */
  | { tipo: "tabela"; colunas: { titulo: string; largura: number; alinhar?: "esquerda" | "direita" }[]; linhas: string[][] };

export type DocumentoPdf = {
  /** Título do documento (cabeçalho e metadados do PDF). */
  titulo: string;
  /** Linhas abaixo do título (cliente, versão, data…). */
  subtitulo?: string[];
  blocos: BlocoPdf[];
  /** Metadados do arquivo. */
  autor?: string;
  assunto?: string;
};

export type Cor = { r: number; g: number; b: number };

export type EstiloTexto = { tamanho: number; entrelinha: number; antes: number; depois: number; cor: Cor; negrito?: boolean };

/** Bytes de uma fonte TrueType (embutida com subconjunto: acentos e qualquer Unicode que ela tenha). */
export type FontesTemplate = { regular: Uint8Array; negrito: Uint8Array; italico: Uint8Array; negritoItalico: Uint8Array };

/**
 * A cara do documento. O cabeçalho/rodapé recebem um "pincel" mínimo (texto
 * e linha), não o pdf-lib: um template novo não depende da biblioteca.
 */
export type TemplatePdf = {
  nome: string;
  /** Pontos (1/72 pol.). A4 = 595.28 × 841.89. */
  pagina: { largura: number; altura: number; margem: { topo: number; base: number; esquerda: number; direita: number } };
  fontes: () => Promise<FontesTemplate>;
  estilos: {
    texto: EstiloTexto;
    titulo1: EstiloTexto;
    titulo2: EstiloTexto;
    titulo3: EstiloTexto;
    /** Subtítulo da abertura e rótulos dos campos. */
    rotulo: EstiloTexto;
    tabela: EstiloTexto;
    /** Recuo por nível de lista. */
    recuoLista: number;
    corLinha: Cor;
  };
  /** Desenhado em toda página, por cima do conteúdo (depois de saber o total de páginas). */
  cabecalho?: (p: Pincel, ctx: ContextoPagina) => void;
  rodape?: (p: Pincel, ctx: ContextoPagina) => void;
};

export type ContextoPagina = { pagina: number; total: number; largura: number; altura: number; titulo: string };

export type Pincel = {
  /** Texto numa linha (sem quebra), `x` à esquerda ou alinhado à direita/centro de `x`. */
  texto: (t: string, x: number, y: number, o?: { tamanho?: number; negrito?: boolean; italico?: boolean; cor?: Cor; alinhar?: "esquerda" | "direita" | "centro" }) => void;
  linha: (x1: number, y1: number, x2: number, y2: number, o?: { cor?: Cor; espessura?: number }) => void;
  retangulo: (x: number, y: number, largura: number, altura: number, cor: Cor) => void;
  larguraDe: (t: string, tamanho: number, negrito?: boolean) => number;
};
