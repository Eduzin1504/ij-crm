import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { EstadoVazio } from "@/components/estado-vazio";
import { DocumentoView } from "@/components/propostas/documento-view";
import { StatusPropostaBadge } from "@/components/propostas/status-proposta";
import { MarcarQuadroAtivo } from "@/components/shell/quadro-ativo";
import { exigirUsuario } from "@/lib/auth/atual";
import { formatarDataHora } from "@/lib/projetos/formatar";
import { estruturadoParaEntrada } from "@/lib/propostas/estruturado";
import { markdownParaDocumento } from "@/lib/propostas/markdown";
import { obterPropostaDoProjeto } from "@/lib/propostas/propostas";
import { podeEditarProposta } from "@/lib/propostas/regras";
import { CriarProposta } from "./criar-proposta";
import { EstruturadoLeitura } from "./estruturado-leitura";
import { HistoricoVersoes } from "./historico-versoes";
import { PainelProposta } from "./painel-proposta";

export const metadata = { title: "Proposta" };

/**
 * Proposta do Projeto (GAB-86): uma por Projeto. Quem edita (vendas
 * responsável, gestão) vê o editor com autosave, a parte estruturada e
 * "Salvar versão"; o resto (projetos, outros, visualizador) lê o rascunho
 * atual e as versões — transparência (§4.12).
 */
export default async function PropostaPage({ params }: { params: Promise<{ id: string }> }) {
  const eu = await exigirUsuario();
  const { id } = await params;
  const r = await obterPropostaDoProjeto(id);
  if (!r) notFound();
  const { projeto, proposta } = r;
  const edita = podeEditarProposta(eu, projeto);

  return (
    <>
      <MarcarQuadroAtivo quadro={projeto.pipeline.chave} />
      <Link href={`/projetos/${projeto.id}`} className="mb-4 inline-flex items-center gap-1.5 font-mono text-xs text-fg-mute hover:text-foreground">
        <ArrowLeft className="size-3.5" /> {projeto.titulo}
      </Link>

      <header className="mb-6 flex flex-wrap items-end gap-x-4 gap-y-2">
        <div className="min-w-0">
          <p className="eyebrow mb-1">
            proposta · {projeto.pipeline.chave} · {projeto.fase.nome}
          </p>
          <h1 className="text-2xl font-semibold tracking-tight break-words">{projeto.titulo}</h1>
          <p className="mt-1 text-sm text-fg-mute">
            {projeto.empresa ? `${projeto.empresa} · ` : ""}responsável {projeto.responsavel.nome}
          </p>
        </div>
        <span className="flex-1" />
        {proposta ? <StatusPropostaBadge status={proposta.status} className="text-[11px]" /> : null}
      </header>

      {!proposta ? (
        <section className="rounded-xl border border-border bg-surface p-4">
          <EstadoVazio
            mascote="notebook"
            titulo="Este projeto ainda não tem proposta"
            texto={edita ? "Crie a proposta: o texto fica aqui, com versões, e a parte estruturada (valor, prazo, entregas) alimenta o contrato e a execução." : "Quem é de vendas e responsável pelo projeto (ou a gestão) cria a proposta."}
            acao={edita ? <CriarProposta projetoId={projeto.id} /> : undefined}
          />
        </section>
      ) : (
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
          {edita ? (
            <PainelProposta
              // Sem `key` por revisão: o `router.refresh()` depois de salvar versão não pode
              // remontar o editor (perderia o que a pessoa digitou entretanto). O painel
              // guarda a própria revisão; conflito com quem gravou depois aparece nele.
              projetoId={projeto.id}
              revisao={proposta.revisao}
              documento={markdownParaDocumento(proposta.conteudoMd)}
              estruturado={estruturadoParaEntrada(proposta.estruturado)}
              ultimaVersao={proposta.versoes[0]?.numero ?? null}
            />
          ) : (
            <div className="space-y-6">
              <section className="rounded-xl border border-border bg-surface p-4">
                <div className="mb-3 flex flex-wrap items-center gap-2">
                  <h2 className="text-sm font-medium">Texto (rascunho atual)</h2>
                  <span className="flex-1" />
                  <span className="font-mono text-[11px] text-fg-faint">somente leitura</span>
                </div>
                <DocumentoView documento={markdownParaDocumento(proposta.conteudoMd)} />
              </section>
              <section className="rounded-xl border border-border bg-surface p-4">
                <h2 className="mb-4 text-sm font-medium">Dados da proposta</h2>
                <EstruturadoLeitura e={proposta.estruturado} />
              </section>
            </div>
          )}
          <aside className="space-y-6">
            <section className="rounded-xl border border-border bg-surface p-4 text-xs text-fg-mute">
              <p>
                Criada por {proposta.criadoPor.nome} em {formatarDataHora(proposta.criadoEm)}.
              </p>
              {proposta.rascunhoEm ? (
                <p className="mt-1">
                  Rascunho alterado por {proposta.rascunhoPor?.nome ?? "—"}
                  {proposta.rascunhoViaMcp ? " (via MCP)" : ""} em {formatarDataHora(proposta.rascunhoEm)}.
                </p>
              ) : null}
              {!edita ? <p className="mt-2 text-fg-faint">Quem edita nesta fase: vendas responsável pelo projeto e a gestão.</p> : null}
            </section>
            <HistoricoVersoes projetoId={projeto.id} versoes={proposta.versoes} />
          </aside>
        </div>
      )}
    </>
  );
}
