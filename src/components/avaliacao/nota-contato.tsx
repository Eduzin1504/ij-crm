/**
 * "Os leads gostaram do contato?" (GAB-85, spec fase 2 §4.14/Q23): nota de 1 a 5
 * do vendedor (um clique, opcional) e o sentimento do lead lido pela LLM.
 *
 * Sem "use client" de propósito: sem hooks. O seletor só é usado dentro de
 * formulários cliente (nota, marcar feita); a exibição vai na Timeline (servidor).
 */
import type { Sentimento } from "@prisma/client";
import { Star } from "lucide-react";
import { cn } from "cn";
import { NOTA_CONTATO_MAX, ROTULO_SENTIMENTO, type ResumoAvaliacao } from "@/lib/projetos/avaliacao";

const NOTAS = Array.from({ length: NOTA_CONTATO_MAX }, (_, i) => i + 1);

/** Um clique escolhe; clicar de novo na nota escolhida limpa (a nota é opcional). */
export function SeletorNotaContato({ valor, onChange, disabled = false }: { valor: number | null; onChange: (nota: number | null) => void; disabled?: boolean }) {
  return (
    <div className="flex items-center gap-2">
      <span aria-hidden className="text-xs text-fg-mute">
        Como foi o contato? <span className="text-fg-faint">(opcional)</span>
      </span>
      <div role="radiogroup" aria-label="Como foi o contato? (opcional)" className="flex items-center">
        {NOTAS.map((n) => {
          const marcada = valor === n;
          const acesa = valor !== null && n <= valor;
          return (
            <button
              key={n}
              type="button"
              role="radio"
              aria-checked={marcada}
              aria-label={`${n} de ${NOTA_CONTATO_MAX}`}
              title={`${n} de ${NOTA_CONTATO_MAX}`}
              disabled={disabled}
              onClick={() => onChange(marcada ? null : n)}
              className="rounded p-0.5 text-fg-faint outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50"
            >
              <Star className={cn("size-4", acesa && "fill-current text-warn")} aria-hidden />
            </button>
          );
        })}
      </div>
    </div>
  );
}

export function NotaContatoExibida({ nota }: { nota: number }) {
  return (
    <span
      aria-label={`Contato avaliado em ${nota} de ${NOTA_CONTATO_MAX}`}
      className="inline-flex items-center gap-1 rounded-4xl border border-border px-2 py-0.5 text-xs text-fg-soft"
    >
      <Star className="size-3 fill-current text-warn" aria-hidden />
      <span className="font-mono tabular">
        {nota}/{NOTA_CONTATO_MAX}
      </span>
    </span>
  );
}

const COR_SENTIMENTO: Record<Sentimento, string> = {
  POSITIVO: "text-success",
  NEUTRO: "text-fg-mute",
  NEGATIVO: "text-danger",
};

export function BadgeSentimento({ sentimento }: { sentimento: Sentimento }) {
  return (
    <span
      title="Sentimento do lead lido pela LLM na mensagem"
      className={cn("inline-flex items-center rounded-4xl border border-border px-2 py-0.5 text-xs", COR_SENTIMENTO[sentimento])}
    >
      Lead: {ROTULO_SENTIMENTO[sentimento]}
    </span>
  );
}

const MEDIA = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 1 });
const ORDEM: Sentimento[] = ["POSITIVO", "NEUTRO", "NEGATIVO"];
const plural = (n: number, s: string) => `${n} ${s}${n === 1 ? "" : "s"}`;

/** Resumo do card no detalhe do Projeto: média das notas do vendedor e sentimentos do lead. */
export function ResumoAvaliacaoContato({ resumo }: { resumo: ResumoAvaliacao }) {
  const sentimentos = ORDEM.filter((s) => resumo.sentimentos[s] > 0).map((s) => plural(resumo.sentimentos[s], ROTULO_SENTIMENTO[s]));
  return (
    <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-fg-mute">
      {resumo.media !== null ? (
        <span className="inline-flex items-center gap-1">
          <Star className="size-3 fill-current text-warn" aria-hidden />
          Contato: <span className="font-mono text-fg-soft tabular">{MEDIA.format(resumo.media)}</span> ({plural(resumo.notas, "nota")})
        </span>
      ) : null}
      {sentimentos.length > 0 ? <span>Lead: {sentimentos.join(", ")}</span> : null}
    </p>
  );
}
