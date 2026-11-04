import type { StatusCheckin } from "@prisma/client";
import { cn } from "cn";
import { ROTULO_CHECKIN } from "@/lib/projetos/execucao-regras";
import { formatarDia } from "@/lib/projetos/formatar";

const COR: Record<StatusCheckin, string> = { VERDE: "bg-success", AMARELO: "bg-warn", VERMELHO: "bg-danger" };

/** Badge do check-in (card do Kanban, detalhe). A cor nunca vem sozinha: o rótulo diz o mesmo. */
export function StatusCheckinBadge({ status, motivo, semana, className }: { status: StatusCheckin; motivo?: string; /** Segunda da semana, `AAAA-MM-DD`. */ semana?: string; className?: string }) {
  return (
    <span
      data-testid="status-checkin"
      title={`Check-in: ${ROTULO_CHECKIN[status]}${semana ? ` · semana de ${formatarDia(semana)}` : ""}${motivo ? ` · ${motivo}` : ""}`}
      className={cn("inline-flex items-center gap-1 rounded-full border border-border-strong px-1.5 font-mono text-[10px] leading-4 whitespace-nowrap text-fg-soft uppercase", className)}
    >
      <span aria-hidden className={cn("size-1.5 shrink-0 rounded-full", COR[status])} />
      {ROTULO_CHECKIN[status]}
    </span>
  );
}
