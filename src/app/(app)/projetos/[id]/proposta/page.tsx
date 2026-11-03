import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { EstadoVazio } from "@/components/estado-vazio";
import { DocumentoView } from "@/components/propostas/documento-view";
import { StatusPropostaBadge } from "@/components/propostas/status-proposta";
import { MarcarQuadroAtivo } from "@/components/shell/quadro-ativo";
import { ROTULO_AREA } from "@/lib/auth/areas";
import { listarAnexos } from "@/lib/anexos/anexos";
import { exigirUsuario } from "@/lib/auth/atual";
import { formatarDataHora } from "@/lib/projetos/formatar";
import { acoesPossiveis, ladoDaCaneta, outroLado, podeEditarProposta } from "@/lib/propostas/caneta";
import { estruturadoParaEntrada } from "@/lib/propostas/estruturado";
import { markdownParaDocumento } from "@/lib/propostas/markdown";
import { listarPessoasDaCaneta, obterPropostaDoProjeto, pessoaDaCaneta, tempoComCaneta } from "@/lib/propostas/propostas";
import { podeCriarProposta } from "@/lib/propostas/regras";
import { AcoesCaneta } from "./acoes-caneta";
import { CriarProposta } from "./criar-proposta";
import { EstruturadoLeitura } from "./estruturado-leitura";
import { HistoricoVersoes } from "./historico-versoes";
import { PainelProposta } from "./painel-proposta";

export const metadata = { title: "Proposta" };

/** "3 d 4 h", "5 h", "12 min" — tempo com a caneta. */
function duracao(ms: number): string {
  const min = Math.floor(ms / 60_000);
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h} h`;
  return `${Math.floor(h / 24)} d ${h % 24} h`;
}

/**
 * Proposta do Projeto (GAB-86): uma por Projeto. Quem está com a caneta
 * (GAB-87) vê o editor com autosave, a parte estruturada, "Salvar versão" e
 * as ações do pingue-pongue; o resto lê o rascunho atual e as versões —
 * transparência (§4.12) — e vê só as ações que lhe cabem (GP pega, projetos
 * marca inviável…). O servidor confere tudo de novo.
 */
export default async function PropostaPage({ params }: { params: Promise<{ id: string }> }) {
  const eu = await exigirUsuario();
  const { id } = await params;
  const r = await obterPropostaDoProjeto(id);
  if (!r) notFound();
  const { projeto, proposta } = r;
  const pessoa = await pessoaDaCaneta(eu.id);
  const cria = !!pessoa && pessoa.ativo && podeCriarProposta(pessoa, projeto);
  const edita = !!proposta && !!pessoa && podeEditarProposta(pessoa, proposta.estado);
  const acoes = proposta && pessoa ? acoesPossiveis(pessoa, proposta.estado) : [];
  const lado = proposta ? ladoDaCaneta(proposta) : "VENDAS";
  const pessoas = acoes.some((a) => a === "passar" || a === "devolver") ? await listarPessoasDaCaneta() : [];
  const caneta = {
    acoes,
    mesmoLado: pessoas.filter((p) => p.lado === lado && p.id !== eu.id),
    outroLado: pessoas.filter((p) => p.lado === outroLado(lado)),
    rotuloOutroLado: ROTULO_AREA[outroLado(lado)],
  };
  const tempos = proposta ? await tempoComCaneta(projeto.id) : [];
  // Quem está com a caneta e recebeu do outro lado: o diff do que o seu lado entregou para o que voltou.
  const ultima = proposta?.versoes[0];
  const minhaUltima = proposta?.versoes.find((v) => v.autorLado === lado);
  const voltou = proposta && proposta.canetaComId === eu.id && ultima && ultima.autorLado === outroLado(lado) ? { de: minhaUltima?.numero ?? null, para: ultima.numero } : null;
  // GAB-90: anexos para "Usar arquivo como base" (só quem está com a caneta edita e usa).
  const anexos = edita ? await listarAnexos(projeto.id) : [];

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
            texto={cria ? "Crie a proposta: o texto fica aqui, com versões, e a parte estruturada (valor, prazo, entregas) alimenta o contrato e a execução." : "Quem é de vendas e responsável pelo projeto (ou a gestão) cria a proposta."}
            acao={cria ? <CriarProposta projetoId={projeto.id} /> : undefined}
          />
        </section>
      ) : (
        <>
        <section className="mb-6 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl border border-border bg-surface px-4 py-3 text-sm" aria-label="Quem está com a caneta">
          <span className="font-mono text-[11px] text-fg-mute uppercase">caneta</span>
          {proposta.status === "INVIAVEL" ? (
            <span className="text-fg-soft">
              ninguém — proposta inviável{proposta.motivoInviavel ? <>: “{proposta.motivoInviavel}”</> : null}
            </span>
          ) : (
            <span>
              <b className="font-medium">{proposta.canetaCom ? (proposta.canetaCom.id === eu.id ? "Você" : proposta.canetaCom.nome) : "Ninguém"}</b>
              <span className="text-fg-mute"> · {ROTULO_AREA[lado].toLowerCase()}</span>
              {proposta.canetaDesde ? <span className="text-fg-faint"> · desde {formatarDataHora(proposta.canetaDesde)}</span> : null}
              {!proposta.canetaCom ? <span className="text-fg-faint"> · o GP de {ROTULO_AREA[lado].toLowerCase()} pega</span> : null}
            </span>
          )}
          {voltou ? (
            <Link
              href={`/projetos/${projeto.id}/proposta/diff?${voltou.de ? `de=${voltou.de}&` : ""}para=${voltou.para}`}
              className="ml-auto rounded-lg border border-warn/60 bg-warn-soft px-2 py-1 text-xs text-foreground hover:underline"
            >
              Voltou para você: ver o que mudou {voltou.de ? `(v${voltou.de} → v${voltou.para})` : `(v${voltou.para})`}
            </Link>
          ) : null}
        </section>
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
          {edita ? (
            <PainelProposta
              // Sem `key` por revisão: o `router.refresh()` depois de salvar versão não pode
              // remontar o editor (perderia o que a pessoa digitou entretanto). O painel
              // guarda a própria revisão; conflito com quem gravou depois aparece nele.
              // `key` pela caneta/status (GAB-87): quando a caneta muda de mão ou o status
              // muda, o editor remonta com a revisão nova (a mudança incrementou a revisão).
              key={`${proposta.canetaComId}:${proposta.status}`}
              projetoId={projeto.id}
              revisao={proposta.revisao}
              documento={markdownParaDocumento(proposta.conteudoMd)}
              estruturado={estruturadoParaEntrada(proposta.estruturado)}
              ultimaVersao={proposta.versoes[0]?.numero ?? null}
              caneta={caneta}
              anexos={anexos.map((a) => ({ id: a.id, nome: a.nome, tipo: a.tipo, semTexto: a.semTexto }))}
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
              <AcoesCaneta projetoId={projeto.id} revisao={proposta.revisao} {...caneta} />
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
              {!edita ? <p className="mt-2 text-fg-faint">Só quem está com a caneta edita; você lê (e comenta).</p> : null}
            </section>
            {tempos.length ? (
              <section className="rounded-xl border border-border bg-surface p-4">
                <h2 className="mb-2 text-sm font-medium">Tempo com a caneta</h2>
                <ul className="space-y-1 text-xs">
                  {tempos.map((t) => (
                    <li key={t.id} className="flex gap-2">
                      <span className="min-w-0 flex-1 truncate text-fg-soft">{t.nome}</span>
                      <span className="text-fg-faint">{ROTULO_AREA[t.lado].toLowerCase()}</span>
                      <span className="w-16 text-right font-mono tabular">{duracao(t.ms)}</span>
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}
            <HistoricoVersoes projetoId={projeto.id} versoes={proposta.versoes} />
          </aside>
        </div>
        </>
      )}
    </>
  );
}
