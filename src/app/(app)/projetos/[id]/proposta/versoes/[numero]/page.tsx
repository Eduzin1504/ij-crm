import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { DocumentoView } from "@/components/propostas/documento-view";
import { MarcarQuadroAtivo } from "@/components/shell/quadro-ativo";
import { ROTULO_AREA } from "@/lib/auth/areas";
import { exigirUsuario } from "@/lib/auth/atual";
import { formatarDataHora } from "@/lib/projetos/formatar";
import { markdownParaDocumento } from "@/lib/propostas/markdown";
import { podeVerPropostaDoProjeto } from "@/lib/propostas/acesso";
import { obterPropostaDoProjeto, obterVersao } from "@/lib/propostas/propostas";
import { EstruturadoLeitura } from "../../estruturado-leitura";
import { HistoricoVersoes } from "../../historico-versoes";

export const metadata = { title: "Versão da proposta" };

/** Uma versão salva (imutável): texto e parte estruturada daquele momento. Lê quem vê a proposta (GAB-98). */
export default async function VersaoPage({ params }: { params: Promise<{ id: string; numero: string }> }) {
  const eu = await exigirUsuario();
  const { id, numero: bruto } = await params;
  const numero = /^\d{1,9}$/.test(bruto) ? Number(bruto) : NaN;
  if (!Number.isInteger(numero) || numero < 1) notFound();
  if (!(await podeVerPropostaDoProjeto(eu, id))) redirect("/403");
  const [r, v] = await Promise.all([obterPropostaDoProjeto(id), obterVersao(id, numero)]);
  if (!r?.proposta || !v) notFound();

  return (
    <>
      <MarcarQuadroAtivo quadro={r.projeto.pipeline.chave} />
      <Link href={`/projetos/${id}/proposta`} className="mb-4 inline-flex items-center gap-1.5 font-mono text-xs text-fg-mute hover:text-foreground">
        <ArrowLeft className="size-3.5" /> Proposta atual · {r.projeto.titulo}
      </Link>
      <header className="mb-6">
        <p className="eyebrow mb-1">proposta · versão imutável</p>
        <h1 className="text-2xl font-semibold tracking-tight">
          v{v.numero} <span className="text-fg-mute">· {r.projeto.titulo}</span>
        </h1>
        <p className="mt-1 text-sm text-fg-mute">
          {v.autor.nome}
          {v.autorLado ? ` (${ROTULO_AREA[v.autorLado].toLowerCase()})` : ""} em {formatarDataHora(v.criadoEm)}
          {v.viaMcp ? " · via MCP" : ""}
        </p>
        {v.nota ? <p className="mt-2 max-w-prose rounded-lg border border-border bg-surface px-3 py-2 text-sm break-words">{v.nota}</p> : null}
      </header>
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="space-y-6">
          <section className="rounded-xl border border-border bg-surface p-4">
            <h2 className="mb-3 text-sm font-medium">Texto</h2>
            <DocumentoView documento={markdownParaDocumento(v.conteudoMd)} />
          </section>
          <section className="rounded-xl border border-border bg-surface p-4">
            <h2 className="mb-4 text-sm font-medium">Dados da proposta</h2>
            <EstruturadoLeitura e={v.estruturado} />
          </section>
        </div>
        <aside>
          <HistoricoVersoes projetoId={id} versoes={r.proposta.versoes} atual={v.numero} />
        </aside>
      </div>
    </>
  );
}
