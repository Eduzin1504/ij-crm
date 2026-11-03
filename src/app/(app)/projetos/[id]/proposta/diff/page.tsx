import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { DiffEstruturado, DiffTexto } from "@/components/propostas/diff-view";
import { MarcarQuadroAtivo } from "@/components/shell/quadro-ativo";
import { ROTULO_AREA } from "@/lib/auth/areas";
import { exigirUsuario } from "@/lib/auth/atual";
import { diffDaProposta, obterPropostaDoProjeto } from "@/lib/propostas/propostas";
import { HistoricoVersoes } from "../historico-versoes";

export const metadata = { title: "O que mudou na proposta" };

function numero(bruto: string | string[] | undefined): number | undefined | null {
  if (bruto === undefined || bruto === "") return undefined;
  return typeof bruto === "string" && /^\d{1,9}$/.test(bruto) && Number(bruto) >= 1 ? Number(bruto) : null;
}

/**
 * Diff entre duas versões (GAB-87). Sem `de`: desde a última versão que o
 * lado de quem olha entregou (o "que voltou"). Todos leem.
 */
export default async function DiffPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const eu = await exigirUsuario();
  const { id } = await params;
  const sp = await searchParams;
  const de = numero(sp.de);
  const para = numero(sp.para);
  if (de === null || para === null) notFound();
  const [r, d] = await Promise.all([obterPropostaDoProjeto(id), diffDaProposta(id, { de, para, quem: eu.id })]);
  if (!r?.proposta || !d) notFound();
  const rotulo = (v: { numero: number; autor: string; lado: keyof typeof ROTULO_AREA | null }) => `v${v.numero} · ${v.autor}${v.lado ? ` (${ROTULO_AREA[v.lado].toLowerCase()})` : ""}`;

  return (
    <>
      <MarcarQuadroAtivo quadro={r.projeto.pipeline.chave} />
      <Link href={`/projetos/${id}/proposta`} className="mb-4 inline-flex items-center gap-1.5 font-mono text-xs text-fg-mute hover:text-foreground">
        <ArrowLeft className="size-3.5" /> Proposta atual · {r.projeto.titulo}
      </Link>
      <header className="mb-6">
        <p className="eyebrow mb-1">proposta · o que mudou</p>
        <h1 className="text-2xl font-semibold tracking-tight">
          {d.de ? `v${d.de.numero} → v${d.para.numero}` : `v${d.para.numero}`} <span className="text-fg-mute">· {r.projeto.titulo}</span>
        </h1>
        <p className="mt-1 text-sm text-fg-mute">
          {d.de ? (
            <>
              de <Link className="underline underline-offset-2" href={`/projetos/${id}/proposta/versoes/${d.de.numero}`}>{rotulo(d.de)}</Link> para{" "}
            </>
          ) : (
            "primeira versão: "
          )}
          <Link className="underline underline-offset-2" href={`/projetos/${id}/proposta/versoes/${d.para.numero}`}>
            {rotulo(d.para)}
          </Link>
        </p>
      </header>
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="space-y-6">
          <section className="rounded-xl border border-border bg-surface p-4">
            <h2 className="mb-3 text-sm font-medium">Texto</h2>
            <DiffTexto linhas={d.texto} />
          </section>
          <section className="rounded-xl border border-border bg-surface p-4">
            <h2 className="mb-4 text-sm font-medium">Dados da proposta</h2>
            <DiffEstruturado mudancas={d.estruturado} />
          </section>
        </div>
        <aside>
          <HistoricoVersoes projetoId={id} versoes={r.proposta.versoes} comparar={{ de: d.de?.numero ?? null, para: d.para.numero }} />
        </aside>
      </div>
    </>
  );
}
