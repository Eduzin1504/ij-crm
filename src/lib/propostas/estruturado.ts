/**
 * Parte ESTRUTURADA da proposta (spec fase 2 §4.5): valor, prazo, escopo
 * resumido e cronograma de entregas. É ela que alimenta a regra de §4.4
 * (mudou escopo/prazo/valor → volta para projetos), o contrato e a execução.
 *
 * Entrada = strings do formulário/MCP (dinheiro no formato BR "12.500,00",
 * dia "AAAA-MM-DD"); saída = forma canônica gravada (rascunho e snapshot da
 * versão). Validado SEMPRE no servidor (o formulário só ajuda). Puro.
 */
import { z } from "zod";
// Sem `@/lib/projetos/campos` (importa enum do Prisma como valor): este módulo roda no cliente também.
import { lerDinheiro } from "@/lib/projetos/terminal-regras";

export const ESCOPO_RESUMO_MAX = 2000;
export const TITULO_ENTREGA_MAX = 200;
export const ENTREGAS_MAX = 50;
export const PRAZO_DIAS_MAX = 3650;

export type Entrega = { titulo: string; dia: string; valor: string | null };

/** Forma gravada: valor decimal com ponto ("12500.00"), prazo em dias corridos. */
export type Estruturado = {
  valor: string | null;
  prazoDias: number | null;
  escopoResumo: string | null;
  entregas: Entrega[];
};

export const ESTRUTURADO_VAZIO: Estruturado = { valor: null, prazoDias: null, escopoResumo: null, entregas: [] };

/** O que o formulário e o MCP mandam (tudo texto; ausente = vazio). */
export const estruturadoEntradaSchema = z
  .object({
    valor: z.string().max(50).optional(),
    prazoDias: z.union([z.string().max(10), z.number()]).optional(),
    escopoResumo: z.string().max(ESCOPO_RESUMO_MAX * 2).optional(),
    entregas: z
      .array(z.object({ titulo: z.string().max(TITULO_ENTREGA_MAX * 2), dia: z.string().max(20), valor: z.string().max(50).optional() }).strict())
      .max(ENTREGAS_MAX * 2)
      .optional(),
  })
  .strict();

export type EstruturadoEntrada = z.infer<typeof estruturadoEntradaSchema>;

export type ResultadoEstruturado = { ok: true; valor: Estruturado } | { ok: false; erro: string };

/** "AAAA-MM-DD" de um dia que existe no calendário (30/02 não). */
export function diaValido(dia: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dia);
  if (!m) return false;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return d.toISOString().slice(0, 10) === dia;
}

function prazo(bruto: string | number | undefined): { ok: true; v: number | null } | { ok: false } {
  if (bruto === undefined) return { ok: true, v: null };
  const t = String(bruto).trim();
  if (t === "") return { ok: true, v: null };
  if (!/^\d+$/.test(t)) return { ok: false };
  const n = Number(t);
  return n >= 1 && n <= PRAZO_DIAS_MAX ? { ok: true, v: n } : { ok: false };
}

export function interpretarEstruturado(bruto: unknown): ResultadoEstruturado {
  const p = estruturadoEntradaSchema.safeParse(bruto ?? {});
  if (!p.success) return { ok: false, erro: "Dados da proposta inválidos." };
  const e = p.data;

  const valor = lerDinheiro(e.valor ?? "");
  if (!valor.ok) return { ok: false, erro: "Valor inválido: use reais no formato 12.500,00 (não pode ser negativo)." };

  const pz = prazo(e.prazoDias);
  if (!pz.ok) return { ok: false, erro: `Prazo inválido: informe dias corridos, de 1 a ${PRAZO_DIAS_MAX}.` };

  const escopo = (e.escopoResumo ?? "").trim();
  if (escopo.length > ESCOPO_RESUMO_MAX) return { ok: false, erro: `Escopo resumido: no máximo ${ESCOPO_RESUMO_MAX} caracteres.` };

  const brutas = e.entregas ?? [];
  if (brutas.length > ENTREGAS_MAX) return { ok: false, erro: `O cronograma pode ter até ${ENTREGAS_MAX} entregas.` };
  const entregas: Entrega[] = [];
  for (const [i, en] of brutas.entries()) {
    const rotulo = `Entrega ${i + 1}`;
    const titulo = en.titulo.replace(/\s+/g, " ").trim();
    if (titulo === "" || titulo.length > TITULO_ENTREGA_MAX) return { ok: false, erro: `${rotulo}: dê um nome (até ${TITULO_ENTREGA_MAX} caracteres).` };
    const dia = en.dia.trim();
    if (!diaValido(dia)) return { ok: false, erro: `${rotulo}: data inválida (use AAAA-MM-DD).` };
    const v = lerDinheiro(en.valor ?? "");
    if (!v.ok) return { ok: false, erro: `${rotulo}: valor inválido (formato 12.500,00, não negativo).` };
    entregas.push({ titulo, dia, valor: v.valor });
  }

  return { ok: true, valor: { valor: valor.valor, prazoDias: pz.v, escopoResumo: escopo || null, entregas } };
}

/** Lê o JSON gravado (rascunho/snapshot) de volta; defensivo contra linha antiga/estranha. */
export function lerEstruturadoGravado(json: unknown): Estruturado {
  if (!json || typeof json !== "object" || Array.isArray(json)) return ESTRUTURADO_VAZIO;
  const o = json as Record<string, unknown>;
  const entregas = Array.isArray(o.entregas)
    ? o.entregas.flatMap((x) => {
        const e = x as Record<string, unknown>;
        return typeof e?.titulo === "string" && typeof e?.dia === "string" ? [{ titulo: e.titulo, dia: e.dia, valor: typeof e.valor === "string" ? e.valor : null }] : [];
      })
    : [];
  return {
    valor: typeof o.valor === "string" ? o.valor : null,
    prazoDias: typeof o.prazoDias === "number" ? o.prazoDias : null,
    escopoResumo: typeof o.escopoResumo === "string" ? o.escopoResumo : null,
    entregas,
  };
}

/** Mesmo conteúdo estruturado (para "nada mudou desde a última versão"). */
export function mesmoEstruturado(a: Estruturado, b: Estruturado): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

const BR = new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** "12500.00" → "12.500,00" (o formato que o formulário e o MCP mandam de volta). */
export function valorParaCampo(v: string | null): string {
  return v === null ? "" : BR.format(Number(v)).replace(/ /g, " ");
}

/** O formulário da tela: tudo texto, tudo presente. */
export type FormularioEstruturado = { valor: string; prazoDias: string; escopoResumo: string; entregas: { titulo: string; dia: string; valor: string }[] };

/** Forma gravada → entrada (para o formulário começar do que está salvo). */
export function estruturadoParaEntrada(e: Estruturado): FormularioEstruturado {
  return {
    valor: valorParaCampo(e.valor),
    prazoDias: e.prazoDias === null ? "" : String(e.prazoDias),
    escopoResumo: e.escopoResumo ?? "",
    entregas: e.entregas.map((x) => ({ titulo: x.titulo, dia: x.dia, valor: valorParaCampo(x.valor) })),
  };
}

/** Soma das parcelas do cronograma (string decimal) — a tela compara com o valor total. */
export function somaDasParcelas(entregas: readonly Entrega[]): string | null {
  const com = entregas.filter((e) => e.valor !== null);
  if (com.length === 0) return null;
  const centavos = com.reduce((s, e) => s + Math.round(Number(e.valor) * 100), 0);
  return (centavos / 100).toFixed(2);
}
