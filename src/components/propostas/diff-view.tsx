import { cn } from "cn";
import type { LinhaDiff, MudancaCampo, Trecho } from "@/lib/propostas/diff";

function Trechos({ trechos }: { trechos: Trecho[] }) {
  return (
    <>
      {trechos.map((t, i) =>
        t.tipo === "igual" ? (
          <span key={i}>{t.texto}</span>
        ) : t.tipo === "removido" ? (
          <del key={i} className="rounded-sm bg-danger/15 text-danger decoration-danger/60">
            {t.texto}
          </del>
        ) : (
          <ins key={i} className="rounded-sm bg-success/15 text-success no-underline">
            {t.texto}
          </ins>
        ),
      )}
    </>
  );
}

const LINHA = "block border-l-2 px-3 py-1 font-mono text-[13px] leading-relaxed break-words whitespace-pre-wrap";

/**
 * Diff legível (GAB-87): uma linha por bloco do Markdown (título, parágrafo,
 * item). Saiu = vermelho riscado, entrou = verde; bloco alterado mostra o
 * antes e o depois com as palavras trocadas destacadas.
 */
export function DiffTexto({ linhas }: { linhas: LinhaDiff[] }) {
  if (!linhas.some((l) => l.tipo !== "igual")) return <p className="text-sm text-fg-faint">O texto não mudou.</p>;
  return (
    <div className="space-y-0.5" data-testid="diff-texto">
      {linhas.map((l, i) => {
        if (l.tipo === "igual") return <span key={i} className={cn(LINHA, "border-transparent text-fg-mute")}>{l.texto}</span>;
        if (l.tipo === "removida")
          return (
            <del key={i} className={cn(LINHA, "border-danger bg-danger/10 text-danger decoration-danger/60")} aria-label={`saiu: ${l.texto}`}>
              {l.texto}
            </del>
          );
        if (l.tipo === "adicionada")
          return (
            <ins key={i} className={cn(LINHA, "border-success bg-success/10 text-success no-underline")} aria-label={`entrou: ${l.texto}`}>
              {l.texto}
            </ins>
          );
        return (
          <div key={i} className="space-y-0.5">
            <span className={cn(LINHA, "border-danger/60 text-foreground")}>
              <span className="mr-1 text-danger select-none">−</span>
              <Trechos trechos={l.antes} />
            </span>
            <span className={cn(LINHA, "border-success/60 text-foreground")}>
              <span className="mr-1 text-success select-none">+</span>
              <Trechos trechos={l.depois} />
            </span>
          </div>
        );
      })}
    </div>
  );
}

export function DiffEstruturado({ mudancas }: { mudancas: MudancaCampo[] }) {
  if (mudancas.length === 0) return <p className="text-sm text-fg-faint">Valor, prazo, escopo e cronograma não mudaram.</p>;
  return (
    <dl className="space-y-3 text-sm">
      {mudancas.map((m) => (
        <div key={m.campo}>
          <dt className="font-mono text-[11px] text-fg-mute uppercase">{m.campo}</dt>
          <dd className="mt-1 grid gap-1 sm:grid-cols-2">
            <del className="rounded-md border border-danger/40 bg-danger/10 px-2 py-1 break-words whitespace-pre-wrap text-danger decoration-danger/60">{m.antes}</del>
            <ins className="rounded-md border border-success/40 bg-success/10 px-2 py-1 break-words whitespace-pre-wrap text-success no-underline">{m.depois}</ins>
          </dd>
        </div>
      ))}
    </dl>
  );
}
