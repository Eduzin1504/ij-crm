import type { StatusTarefa } from "@prisma/client";
import { CalendarDays } from "lucide-react";
import { cn } from "cn";
import { Avatar } from "@/components/avatar";
import type { PessoaTarefa, TarefaLista } from "@/lib/tarefas/modelo";

/** Cor de cada status (só em ícone, nunca fundo cheio; paleta de gráficos da IJ). */
const COR_STATUS: Record<StatusTarefa, string> = {
  BACKLOG: "text-fg-faint",
  A_FAZER: "text-fg-soft",
  EM_ANDAMENTO: "text-chart-3",
  EM_REVISAO: "text-chart-4",
  FEITA: "text-success",
  CANCELADA: "text-fg-faint",
};

/** Círculo que enche conforme o status (Backlog tracejado; Feita cheio com check; Cancelada com X). */
export function IconeStatus({ status, className }: { status: StatusTarefa; className?: string }) {
  const c = cn("shrink-0", COR_STATUS[status], className);
  switch (status) {
    case "BACKLOG":
      return <svg viewBox="0 0 16 16" aria-hidden className={c}><circle cx="8" cy="8" r="6" fill="none" stroke="currentColor" strokeWidth="1.5" strokeDasharray="2 2" /></svg>;
    case "A_FAZER":
      return <svg viewBox="0 0 16 16" aria-hidden className={c}><circle cx="8" cy="8" r="6" fill="none" stroke="currentColor" strokeWidth="1.5" /></svg>;
    case "EM_ANDAMENTO":
      return <svg viewBox="0 0 16 16" aria-hidden className={c}><circle cx="8" cy="8" r="6" fill="none" stroke="currentColor" strokeWidth="1.5" /><path d="M8 2a6 6 0 0 1 0 12z" fill="currentColor" /></svg>;
    case "EM_REVISAO":
      return <svg viewBox="0 0 16 16" aria-hidden className={c}><circle cx="8" cy="8" r="6" fill="none" stroke="currentColor" strokeWidth="1.5" /><path d="M8 2a6 6 0 1 1-6 6h6z" fill="currentColor" /></svg>;
    case "FEITA":
      return <svg viewBox="0 0 16 16" aria-hidden className={c}><circle cx="8" cy="8" r="6.5" fill="currentColor" /><path d="m5.5 8 1.8 1.8L10.8 6" fill="none" stroke="var(--background)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>;
    case "CANCELADA":
      return <svg viewBox="0 0 16 16" aria-hidden className={c}><circle cx="8" cy="8" r="6" fill="none" stroke="currentColor" strokeWidth="1.5" /><path d="m5.5 5.5 5 5m0-5-5 5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg>;
  }
}

export type EstadoPrazo = "atrasada" | "hoje" | "futura";

/** Compara dias civis (`YYYY-MM-DD`), como `estadoProximaAcao`. */
export function estadoPrazo(prazo: string, hoje: string): EstadoPrazo {
  return prazo < hoje ? "atrasada" : prazo === hoje ? "hoje" : "futura";
}

/** `2026-11-10` → `10 nov`. */
export function diaCurto(dia: string): string {
  const [, m, d] = dia.split("-");
  return `${d} ${["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"][Number(m) - 1]}`;
}

/** Chip de propriedade (medidas do Linear: 28px, 13px, raio 8, borda branca a 10%). */
export function Chip({ className, children }: { className?: string; children: React.ReactNode }) {
  return <span className={cn("inline-flex h-7 items-center gap-1.5 rounded-lg border border-white/10 px-2.5 text-[13px] text-fg-soft", className)}>{children}</span>;
}

/**
 * Cartão da tarefa, nas proporções do card do Linear: linha do ID (13px) com
 * avatar de 20px; título 14/20 com o ícone de status de 16px; chips de 28px;
 * "criada em" 13px; vãos de 8, 10 e 12. Sem borda lateral colorida.
 */
export function CartaoTarefa({
  tarefa,
  pai,
  pessoa,
  mostrarAvatar,
  hoje,
  arrastando = false,
}: {
  tarefa: TarefaLista;
  /** Tarefa pai (contexto na primeira linha), quando é subtarefa. */
  pai?: { numero: number; titulo: string } | null;
  pessoa?: PessoaTarefa | null;
  /** Agrupado por responsável a linha já diz quem é; aí o avatar sai do card. */
  mostrarAvatar: boolean;
  hoje: string;
  arrastando?: boolean;
}) {
  const estado = tarefa.prazo ? estadoPrazo(tarefa.prazo, hoje) : null;
  return (
    <article
      className={cn(
        "rounded-lg border border-border bg-surface p-3 transition-colors hover:bg-surface-hover",
        arrastando && "rotate-1 border-border-strong shadow-lg shadow-black/40",
        (tarefa.status === "FEITA" || tarefa.status === "CANCELADA") && "[&_h3]:text-fg-soft",
      )}
    >
      <div className="flex h-5 items-center gap-1.5 text-[13px] text-fg-mute">
        <span className="shrink-0">#{tarefa.numero}</span>
        {pai ? (
          <span className="min-w-0 truncate text-fg-faint">
            <span aria-hidden>› </span>
            {pai.titulo}
          </span>
        ) : null}
        <span className="flex-1" />
        {mostrarAvatar && pessoa ? <Avatar nome={pessoa.nome} usuarioId={pessoa.id} fotoEm={pessoa.fotoEm} className="size-5 text-[9px]" /> : null}
      </div>
      <h3 className="mt-2 flex items-start gap-2.5 text-sm leading-5 font-medium text-foreground">
        <IconeStatus status={tarefa.status} className="mt-0.5 size-4" />
        <span className="min-w-0 break-words">{tarefa.titulo}</span>
      </h3>
      {tarefa.prazo && estado ? (
        <div className="mt-2.5 flex flex-wrap gap-1.5">
          <Chip className={cn(estado === "atrasada" && "text-danger")}>
            <CalendarDays className={cn("size-[15px]", estado === "atrasada" ? "text-danger" : estado === "hoje" ? "text-warn" : "text-fg-mute")} />
            {diaCurto(tarefa.prazo)}
            {estado === "atrasada" ? " · atrasada" : estado === "hoje" ? " · hoje" : ""}
          </Chip>
        </div>
      ) : null}
      <p className="mt-3 text-[13px] text-fg-faint">Criada {diaCurto(new Date(tarefa.criadoEmMs).toISOString().slice(0, 10))}</p>
    </article>
  );
}
