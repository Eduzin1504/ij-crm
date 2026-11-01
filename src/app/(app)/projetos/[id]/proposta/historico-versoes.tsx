import Link from "next/link";
import { ROTULO_AREA } from "@/lib/auth/areas";
import { formatarDataHora } from "@/lib/projetos/formatar";
import type { PropostaDoProjeto } from "@/lib/propostas/propostas";

type Versao = NonNullable<PropostaDoProjeto["proposta"]>["versoes"][number];

/** Histórico v1, v2… (mais nova primeiro): autor, lado, data, nota e "via MCP"; cada uma abre a versão. */
export function HistoricoVersoes({ projetoId, versoes, atual }: { projetoId: string; versoes: Versao[]; atual?: number }) {
  return (
    <section className="rounded-xl border border-border bg-surface p-4">
      <h2 className="mb-3 text-sm font-medium">Versões</h2>
      {versoes.length === 0 ? (
        <p className="text-xs text-fg-faint">Nenhuma versão salva ainda. O rascunho é salvo sozinho; “Salvar versão” congela um retrato.</p>
      ) : (
        <ol className="space-y-1">
          {versoes.map((v) => (
            <li key={v.numero}>
              <Link
                href={`/projetos/${projetoId}/proposta/versoes/${v.numero}`}
                aria-current={v.numero === atual ? "page" : undefined}
                className="block rounded-lg px-2 py-1.5 text-sm hover:bg-surface-hover aria-[current=page]:bg-surface-hover"
              >
                <span className="font-mono text-xs font-medium text-foreground">v{v.numero}</span>{" "}
                <span className="text-fg-soft">{v.autor.nome}</span>
                {v.autorLado ? <span className="text-fg-faint"> · {ROTULO_AREA[v.autorLado].toLowerCase()}</span> : null}
                {v.viaMcp ? <span className="ml-1 rounded border border-border px-1 font-mono text-[10px] text-fg-mute">via MCP</span> : null}
                <span className="block font-mono text-[11px] text-fg-faint">{formatarDataHora(v.criadoEm)}</span>
                {v.nota ? <span className="mt-0.5 block text-xs break-words text-fg-mute">{v.nota}</span> : null}
              </Link>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
