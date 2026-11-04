import Link from "next/link";
import { cn } from "cn";
import { ChevronLeft, ChevronRight } from "lucide-react";
import type { Periodo, TipoPeriodo } from "@/lib/ranking/periodo";

const ABA = "rounded-md px-3 py-1 font-mono text-xs uppercase tracking-eyebrow transition-colors";
const SETA = "inline-flex size-8 items-center justify-center rounded-lg border border-border text-fg-soft hover:bg-surface-hover hover:text-foreground";

/** Semana | Mês e as setas dos painéis. `parametros`: o filtro de pessoa, mantido na troca. */
export function NavegacaoPeriodo({ caminho, tipo, periodo, parametros }: { caminho: string; tipo: TipoPeriodo; periodo: Periodo; parametros: Record<string, string> }) {
  const href = (t: TipoPeriodo, ref?: string) => {
    const q = new URLSearchParams({ periodo: t, ...(ref ? { ref } : {}), ...parametros });
    return `${caminho}?${q.toString()}`;
  };
  return (
    <>
      <nav aria-label="Período" className="flex rounded-lg border border-border bg-surface p-0.5">
        {(["semana", "mes"] as const).map((t) => (
          <Link key={t} href={href(t)} aria-current={t === tipo ? "page" : undefined} className={cn(ABA, t === tipo ? "bg-surface-strong text-foreground" : "text-fg-mute hover:text-foreground")}>
            {t === "semana" ? "Semana" : "Mês"}
          </Link>
        ))}
      </nav>
      <Link href={href(tipo, periodo.anterior)} className={SETA} aria-label={tipo === "semana" ? "Semana anterior" : "Mês anterior"}>
        <ChevronLeft className="size-4" />
      </Link>
      {periodo.proximo ? (
        <Link href={href(tipo, periodo.proximo)} className={SETA} aria-label={tipo === "semana" ? "Próxima semana" : "Próximo mês"}>
          <ChevronRight className="size-4" />
        </Link>
      ) : (
        <span aria-hidden className={cn(SETA, "pointer-events-none opacity-40")}>
          <ChevronRight className="size-4" />
        </span>
      )}
      {!periodo.atual ? (
        <Link href={href(tipo)} className="font-mono text-xs text-fg-mute hover:text-foreground hover:underline">
          {tipo === "semana" ? "semana atual" : "mês atual"}
        </Link>
      ) : null}
    </>
  );
}
