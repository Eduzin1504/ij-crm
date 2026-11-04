"use client";

import { useTransition } from "react";
import { usePathname, useRouter } from "next/navigation";

/**
 * Filtro do painel por pessoa (`?vendedor=`, ou `?gp=` no painel de projetos); "Todo o time" tira o filtro e mantém o período.
 * `periodo`: os parâmetros do período atual (`periodo`, `ref`), mantidos na troca.
 */
export function FiltroVendedor({ atualId, opcoes, periodo, parametro = "vendedor", rotulo = "vendedor" }: { atualId: string | null; opcoes: { id: string; nome: string }[]; periodo: Record<string, string>; parametro?: string; rotulo?: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const [pendente, startTransition] = useTransition();
  return (
    <label className="flex items-center gap-2 text-sm text-fg-mute">
      <span className="eyebrow">{rotulo}</span>
      <select
        value={atualId ?? ""}
        disabled={pendente}
        onChange={(e) => {
          const q = new URLSearchParams(periodo);
          if (e.target.value) q.set(parametro, e.target.value);
          else q.delete(parametro);
          const s = q.toString();
          startTransition(() => router.push(s ? `${pathname}?${s}` : pathname));
        }}
        className="h-8 rounded-lg border border-input bg-input/30 px-2.5 text-sm text-foreground outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
      >
        <option value="">Todo o time</option>
        {opcoes.map((o) => (
          <option key={o.id} value={o.id}>
            {o.nome}
          </option>
        ))}
      </select>
    </label>
  );
}
