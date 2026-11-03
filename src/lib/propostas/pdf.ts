/**
 * Conteúdo do PDF da proposta (GAB-89): a versão final (o documento do
 * editor, do Markdown canônico) + a parte estruturada (valor, prazo, escopo
 * resumido e cronograma de entregas). Só CONTEÚDO — a cara é do template
 * (`@/lib/pdf/templates`), trocável pelo oficial da IJ sem mexer aqui.
 * Puro (sem banco): o serviço lê a versão e chama `documentoPdfDaProposta`.
 */
import type { BlocoPdf, DocumentoPdf, Trecho } from "@/lib/pdf/tipos";
import type { Bloco, ItemLista, NoTexto } from "./documento";
import type { Estruturado } from "./estruturado";
import { markdownParaDocumento } from "./markdown";

export type DadosPdfProposta = {
  projeto: string;
  empresa: string | null;
  numero: number;
  /** Quando a versão foi salva. */
  data: Date;
  markdown: string;
  estruturado: Estruturado;
};

const BRL = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });

/** "12500.00" → "R$ 12.500,00" (espaço comum: a fonte não precisa do NBSP). */
export function formatarReais(v: string): string {
  return BRL.format(Number(v)).replace(/\s/g, " ");
}

/** "2026-12-01" → "01/12/2026" (dia de calendário, sem fuso). */
export function formatarDia(dia: string): string {
  const [a, m, d] = dia.split("-");
  return `${d}/${m}/${a}`;
}

function dataBr(d: Date): string {
  return new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "America/Sao_Paulo" }).format(d);
}

function trechos(nos: NoTexto[] | undefined): Trecho[] {
  return (nos ?? []).map((n) => ({
    texto: n.text,
    negrito: n.marks?.some((m) => m.type === "bold") || undefined,
    italico: n.marks?.some((m) => m.type === "italic") || undefined,
  }));
}

function blocosDoDocumento(blocos: Bloco[], nivel = 0): BlocoPdf[] {
  const saida: BlocoPdf[] = [];
  for (const b of blocos) {
    switch (b.type) {
      case "heading":
        // O título do documento é o único nível 1 do PDF: # e ## (o modelo usa ##) viram seção; ### subseção.
        saida.push({ tipo: "titulo", nivel: b.attrs.level === 3 ? 3 : 2, trechos: trechos(b.content) });
        break;
      case "paragraph":
        if (nivel === 0) saida.push({ tipo: "paragrafo", trechos: trechos(b.content) });
        else saida.push({ tipo: "item", marcador: null, nivel: nivel - 1, trechos: trechos(b.content) });
        break;
      case "horizontalRule":
        saida.push({ tipo: "linha" });
        break;
      case "bulletList":
      case "orderedList":
        b.content.forEach((item: ItemLista, i) => {
          const marcador = b.type === "bulletList" ? (nivel % 2 === 0 ? "•" : "–") : `${(b.attrs.start ?? 1) + i}.`;
          saida.push(...itemDaLista(item, marcador, nivel));
        });
        break;
    }
  }
  return saida;
}

function itemDaLista(item: ItemLista, marcador: string, nivel: number): BlocoPdf[] {
  const [primeiro, ...resto] = item.content;
  const saida: BlocoPdf[] = [];
  if (primeiro?.type === "paragraph") saida.push({ tipo: "item", marcador, nivel, trechos: trechos(primeiro.content) });
  else {
    saida.push({ tipo: "item", marcador, nivel, trechos: [] });
    if (primeiro) resto.unshift(primeiro);
  }
  saida.push(...blocosDoDocumento(resto, nivel + 1));
  return saida;
}

/** Nome do arquivo: "Proposta - <projeto> - v3.pdf" (o download sanitiza para o header). */
export function nomeArquivoPdf(projeto: string, numero: number): string {
  const titulo = projeto.replace(/[\\/:*?"<>|\u0000-\u001f]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 80) || "projeto";
  return `Proposta - ${titulo} - v${numero}.pdf`;
}

export function documentoPdfDaProposta(d: DadosPdfProposta): DocumentoPdf {
  const e = d.estruturado;
  const campos: { rotulo: string; valor: string }[] = [];
  if (e.valor !== null) campos.push({ rotulo: "Investimento", valor: formatarReais(e.valor) });
  if (e.prazoDias !== null) campos.push({ rotulo: "Prazo", valor: `${e.prazoDias} ${e.prazoDias === 1 ? "dia corrido" : "dias corridos"}` });
  if (e.escopoResumo) campos.push({ rotulo: "Escopo", valor: e.escopoResumo });

  const blocos: BlocoPdf[] = [];
  if (campos.length) blocos.push({ tipo: "campos", linhas: campos }, { tipo: "linha" });
  blocos.push(...blocosDoDocumento(markdownParaDocumento(d.markdown).content));
  if (e.entregas.length) {
    const comValor = e.entregas.some((x) => x.valor !== null);
    blocos.push({ tipo: "titulo", nivel: 2, trechos: [{ texto: "Cronograma de entregas" }] });
    blocos.push({
      tipo: "tabela",
      colunas: comValor
        ? [
            { titulo: "Entrega", largura: 0.56 },
            { titulo: "Data", largura: 0.2 },
            { titulo: "Valor", largura: 0.24, alinhar: "direita" },
          ]
        : [
            { titulo: "Entrega", largura: 0.75 },
            { titulo: "Data", largura: 0.25 },
          ],
      linhas: e.entregas.map((x) => (comValor ? [x.titulo, formatarDia(x.dia), x.valor !== null ? formatarReais(x.valor) : "—"] : [x.titulo, formatarDia(x.dia)])),
    });
  }

  return {
    titulo: "Proposta comercial",
    subtitulo: [[d.empresa, d.projeto].filter(Boolean).join(" · "), `Versão ${d.numero} · ${dataBr(d.data)}`],
    blocos,
    autor: "Inteli Júnior",
    assunto: `Proposta — ${d.projeto} (v${d.numero})`,
  };
}
