import type { StatusProposta } from "@prisma/client";
import { cn } from "cn";
import { ROTULO_STATUS_PROPOSTA } from "@/lib/propostas/regras";

/** Tom do badge por status (o ciclo inteiro já mapeado; nesta fatia só Rascunho aparece). */
const TOM: Record<StatusProposta, string> = {
  RASCUNHO: "border-border-strong text-fg-soft",
  EM_ANALISE: "border-warn/60 text-fg-soft",
  EM_AJUSTE: "border-warn/60 text-fg-soft",
  PRONTA_PARA_ENVIO: "border-success/60 text-fg-soft",
  ENVIADA: "border-success/60 text-fg-soft",
  ACEITA: "border-success text-foreground",
  RECUSADA: "border-danger/60 text-fg-soft",
  REVISAO_PEDIDA: "border-warn/60 text-fg-soft",
};

/** Badge de status da proposta (card do Kanban, aba Propostas, detalhe). */
export function StatusPropostaBadge({ status, className, prefixo = false }: { status: StatusProposta; className?: string; prefixo?: boolean }) {
  return (
    <span
      data-testid="status-proposta"
      title={`Proposta: ${ROTULO_STATUS_PROPOSTA[status]}`}
      className={cn("inline-flex rounded-full border px-1.5 font-mono text-[10px] leading-4 whitespace-nowrap uppercase", TOM[status], className)}
    >
      {prefixo ? "proposta · " : ""}
      {ROTULO_STATUS_PROPOSTA[status]}
    </span>
  );
}
