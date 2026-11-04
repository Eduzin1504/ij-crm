import Link from "next/link";
import { cn } from "cn";

const ABA = "rounded-md px-3 py-1 font-mono text-xs uppercase tracking-eyebrow transition-colors";

/** Os dois painéis, Vendas e Projetos: o item "Painel" do menu acende nos dois. `periodo`: os parâmetros do período, mantidos na troca. */
export function AbasPainel({ atual, periodo }: { atual: "vendas" | "projetos"; periodo: Record<string, string> }) {
  const busca = new URLSearchParams(periodo).toString();
  return (
    <nav aria-label="Painel" className="flex rounded-lg border border-border bg-surface p-0.5">
      {(
        [
          ["vendas", "/painel", "Vendas"],
          ["projetos", "/painel/projetos", "Projetos"],
        ] as const
      ).map(([chave, href, rotulo]) => (
        <Link key={chave} href={busca ? `${href}?${busca}` : href} aria-current={chave === atual ? "page" : undefined} className={cn(ABA, chave === atual ? "bg-surface-strong text-foreground" : "text-fg-mute hover:text-foreground")}>
          {rotulo}
        </Link>
      ))}
    </nav>
  );
}
