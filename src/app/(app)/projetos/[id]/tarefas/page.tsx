import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { PageHeader } from "@/components/shell/page-header";
import { MarcarQuadroAtivo } from "@/components/shell/quadro-ativo";
import { diaEmFuso } from "@/lib/projetos/aging";
import { exigirTarefas } from "@/lib/tarefas/acesso";
import { listarQuadro } from "@/lib/tarefas/tarefas";
import { QuadroTarefas } from "./quadro-tarefas";

export const metadata = { title: "Tarefas do projeto" };

/**
 * Kanban interno do projeto (spec 2026-11-04): só o time de projetos, só card
 * no quadro de Projetos (fora dele, 404). Sem item no menu: chega pelo link na
 * página do projeto.
 */
export default async function TarefasPage({ params }: { params: Promise<{ id: string }> }) {
  const ator = await exigirTarefas();
  const { id } = await params;
  const q = await listarQuadro(id, ator);
  if (!q.ok) {
    if (q.erro === "PROJETO_NAO_ENCONTRADO") notFound();
    redirect("/403");
  }
  const hoje = diaEmFuso(new Date());

  return (
    <div className="flex h-[calc(100dvh-10.5rem)] min-h-[28rem] flex-col md:h-[calc(100dvh-7.5rem)]">
      <MarcarQuadroAtivo quadro="projetos" />
      <Link href={`/projetos/${q.projeto.id}`} className="mb-4 inline-flex items-center gap-1.5 font-mono text-xs text-fg-mute hover:text-foreground">
        <ArrowLeft className="size-3.5" /> {q.projeto.titulo}
      </Link>
      <PageHeader eyebrow="projetos · tarefas do time" title={q.projeto.titulo} description="O que cada pessoa do time está fazendo neste projeto. Só o time de projetos vê este quadro." />
      <QuadroTarefas key={q.projeto.id} projetoId={q.projeto.id} tarefas={q.tarefas} pessoas={q.pessoas} hoje={hoje} />
    </div>
  );
}
