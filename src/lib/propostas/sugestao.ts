/**
 * Sugestão de preenchimento da proposta a partir de arquivo (GAB-90): regras
 * PURAS (rodam no cliente e no servidor) que transformam a leitura do LLM em
 * campos do formulário — e decidem o que NÃO aplicar.
 *
 * Regra central ("nunca inventado"): um campo só entra se veio com valor no
 * formato certo, com o trecho do documento que o sustenta e confiança ≥
 * ACIMA de `LIMIAR_CONFIANCA` (estritamente: o prompt manda conversões como
 * "3 meses" virem no máximo 0.5, e 0.7 exato também não passa). Cada entrega do
 * cronograma precisa do PRÓPRIO trecho. O resto fica vazio (ou com o valor que já estava no
 * rascunho) e aparece em `revisar`, com o motivo e o que foi lido, para a
 * pessoa conferir.
 */
import type { LeituraProposta } from "@/lib/llm/prompts/proposta-arquivo.v1";
import { diaValido, ENTREGAS_MAX, ESCOPO_RESUMO_MAX, PRAZO_DIAS_MAX, TITULO_ENTREGA_MAX, valorParaCampo, type FormularioEstruturado } from "./estruturado";

export const LIMIAR_CONFIANCA = 0.7;

export type CampoSugestao = "valor" | "prazoDias" | "escopoResumo" | "entregas";

export const ROTULO_CAMPO_SUGESTAO: Record<CampoSugestao, string> = {
  valor: "Valor total",
  prazoDias: "Prazo (dias)",
  escopoResumo: "Escopo resumido",
  entregas: "Cronograma de entregas",
};

type EntregaForm = FormularioEstruturado["entregas"][number];

/** Campos que a sugestão preenche. `null` = não preenche (fica o que já está no rascunho). */
export type CamposSugeridos = {
  valor: string | null;
  prazoDias: string | null;
  escopoResumo: string | null;
  entregas: EntregaForm[] | null;
};

export type ItemRevisar = { campo: CampoSugestao; motivo: string; lido: string | null; trecho: string | null };

export type Sugestao = {
  /** `texto`: texto extraído no upload; `arquivo`: lido pelo modelo com visão (escaneado/imagem). */
  origem: "texto" | "arquivo";
  anexo: { id: string; nome: string };
  markdown: string;
  campos: CamposSugeridos;
  revisar: ItemRevisar[];
};

const NAO_ENCONTRADO = "não encontrado no arquivo";
const INCERTO = "leitura incerta: confira no arquivo";
const SEM_TRECHO = "sem trecho do arquivo que comprove";

const DECIMAL = /^\d{1,12}(\.\d{1,2})?$/;

/** "12500.00" do LLM → "12.500,00" do formulário; null se não é um decimal válido. */
function dinheiro(v: string | null): string | null {
  if (v === null) return null;
  const t = v.trim();
  return DECIMAL.test(t) ? valorParaCampo(Number(t).toFixed(2)) : null;
}

const acimaDoLimiar = (confianca: number) => confianca > LIMIAR_CONFIANCA;
const confiavel = (c: { confianca: number; trecho: string | null }) => acimaDoLimiar(c.confianca) && !!c.trecho?.trim();

function motivo(c: { valor: unknown; confianca: number; trecho: string | null }, valido: boolean): string {
  if (c.valor === null) return NAO_ENCONTRADO;
  if (!valido) return "valor em formato que não deu para usar";
  if (!c.trecho?.trim()) return SEM_TRECHO;
  return INCERTO;
}

export function interpretarLeitura(l: LeituraProposta): { campos: CamposSugeridos; revisar: ItemRevisar[] } {
  const revisar: ItemRevisar[] = [];
  const marcar = (campo: CampoSugestao, m: string, lido: string | null, trecho: string | null) => revisar.push({ campo, motivo: m, lido, trecho: trecho?.trim() || null });

  const valorLido = dinheiro(l.valor_total.valor);
  const valor = valorLido !== null && confiavel(l.valor_total) ? valorLido : null;
  if (valor === null) marcar("valor", motivo(l.valor_total, valorLido !== null), l.valor_total.valor, l.valor_total.trecho);

  const p = l.prazo_dias.valor;
  const prazoValido = p !== null && Number.isInteger(p) && p >= 1 && p <= PRAZO_DIAS_MAX;
  const prazoDias = prazoValido && confiavel(l.prazo_dias) ? String(p) : null;
  if (prazoDias === null) marcar("prazoDias", motivo(l.prazo_dias, prazoValido), p === null ? null : String(p), l.prazo_dias.trecho);

  const e = l.escopo_resumo.valor?.replace(/\s+/g, " ").trim() || null;
  // Resumo não precisa de trecho literal (é síntese), só de confiança.
  const escopoResumo = e !== null && acimaDoLimiar(l.escopo_resumo.confianca) ? e.slice(0, ESCOPO_RESUMO_MAX) : null;
  if (escopoResumo === null) marcar("escopoResumo", e === null ? NAO_ENCONTRADO : INCERTO, e, l.escopo_resumo.trecho);

  let entregas: EntregaForm[] | null = null;
  const itens = l.entregas.itens;
  if (itens.length === 0) marcar("entregas", NAO_ENCONTRADO, null, null);
  else if (!acimaDoLimiar(l.entregas.confianca)) marcar("entregas", INCERTO, itens.map((i) => i.titulo).join("; ").slice(0, 300), null);
  else {
    const boas: EntregaForm[] = [];
    for (const i of itens) {
      const titulo = i.titulo.replace(/\s+/g, " ").trim().slice(0, TITULO_ENTREGA_MAX);
      const dia = i.dia?.trim() ?? "";
      if (!titulo || !diaValido(dia)) {
        marcar("entregas", `entrega "${titulo || "sem nome"}" sem data completa (dia/mês/ano): não incluída`, titulo || null, i.trecho);
        continue;
      }
      if (!i.trecho?.trim()) {
        marcar("entregas", `entrega "${titulo}" ${SEM_TRECHO}: não incluída`, [titulo, dia, i.valor].filter(Boolean).join(" · "), null);
        continue;
      }
      const v = dinheiro(i.valor);
      if (i.valor !== null && v === null) marcar("entregas", `entrega "${titulo}": valor em formato que não deu para usar`, i.valor, i.trecho);
      boas.push({ titulo, dia, valor: v ?? "" });
    }
    entregas = boas.length > 0 ? boas.slice(0, ENTREGAS_MAX) : null;
  }

  return { campos: { valor, prazoDias, escopoResumo, entregas }, revisar };
}

/** Aplica a sugestão sobre o formulário atual: o que a sugestão não preenche fica como está. */
export function mesclarSugestao(atual: FormularioEstruturado, c: CamposSugeridos): FormularioEstruturado {
  return {
    valor: c.valor ?? atual.valor,
    prazoDias: c.prazoDias ?? atual.prazoDias,
    escopoResumo: c.escopoResumo ?? atual.escopoResumo,
    entregas: c.entregas ?? atual.entregas,
  };
}
