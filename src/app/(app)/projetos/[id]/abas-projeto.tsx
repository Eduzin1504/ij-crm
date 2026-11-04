import Link from "next/link";
import { cn } from "cn";

/**
 * Abas do projeto (Visão geral | Tarefas): o kanban interno fica DENTRO do projeto,
 * não como página solta. Só aparece para quem vê tarefas e em card do quadro de
 * Projetos (quem chama decide); sem isso, a página do card fica como sempre foi.
 */
export function AbasProjeto({ projetoId, ativa, tarefasAbertas }: { projetoId: string; ativa: "geral" | "tarefas"; tarefasAbertas: number }) {
  const abas = [
    { chave: "geral", rotulo: "Visão geral", href: `/projetos/${projetoId}`, contagem: null },
    { chave: "tarefas", rotulo: "Tarefas", href: `/projetos/${projetoId}/tarefas`, contagem: tarefasAbertas },
  ] as const;
  return (
    <nav aria-label="Seções do projeto" className="mb-4 flex shrink-0 gap-1 border-b border-border">
      {abas.map((a) => (
        <Link
          key={a.chave}
          href={a.href}
          aria-current={ativa === a.chave ? "page" : undefined}
          className={cn(
            "-mb-px flex items-center gap-1.5 border-b-2 px-3 py-2 text-sm font-medium transition-colors",
            ativa === a.chave ? "border-primary text-foreground" : "border-transparent text-fg-mute hover:text-foreground",
          )}
        >
          {a.rotulo}
          {a.contagem !== null ? <span className="font-mono text-[11px] text-fg-faint tabular">{a.contagem}</span> : null}
        </Link>
      ))}
    </nav>
  );
}
