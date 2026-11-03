import Link from "next/link";
import { ROTULO_AREA } from "@/lib/auth/areas";
import { formatarDataHora } from "@/lib/projetos/formatar";
import type { PropostaDoProjeto } from "@/lib/propostas/propostas";

type Versao = NonNullable<PropostaDoProjeto["proposta"]>["versoes"][number];

const CLASSE_SELECT = "h-7 rounded-md border border-input bg-input/30 px-1.5 font-mono text-xs text-foreground outline-none focus-visible:border-ring";

/**
 * Histórico v1, v2… (mais nova primeiro): autor, lado, data, nota e "via MCP";
 * cada uma abre a versão. Com 2+ versões, "comparar" abre o diff (GAB-87) — um
 * formulário GET simples, sem JS.
 */
export function HistoricoVersoes({ projetoId, versoes, atual, comparar }: { projetoId: string; versoes: Versao[]; atual?: number; comparar?: { de: number | null; para: number } }) {
  const para = comparar?.para ?? versoes[0]?.numero;
  const de = comparar ? comparar.de : versoes[1]?.numero;
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
      {versoes.length >= 2 ? (
        <form action={`/projetos/${projetoId}/proposta/diff`} className="mt-3 flex flex-wrap items-center gap-1.5 border-t border-border pt-3 text-xs text-fg-mute">
          <span>Comparar</span>
          <select name="de" aria-label="Comparar de" defaultValue={de ?? ""} className={CLASSE_SELECT}>
            {versoes.map((v) => (
              <option key={v.numero} value={v.numero}>
                v{v.numero}
              </option>
            ))}
          </select>
          <span>com</span>
          <select name="para" aria-label="Comparar com" defaultValue={para} className={CLASSE_SELECT}>
            {versoes.map((v) => (
              <option key={v.numero} value={v.numero}>
                v{v.numero}
              </option>
            ))}
          </select>
          <button type="submit" className="rounded-md border border-border px-2 py-0.5 text-foreground hover:bg-surface-hover">
            Ver diff
          </button>
        </form>
      ) : null}
    </section>
  );
}
