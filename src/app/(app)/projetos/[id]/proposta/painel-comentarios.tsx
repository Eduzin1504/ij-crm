"use client";

import { useEffect, useLayoutEffect, useRef, useState, useTransition } from "react";
import { Check, ChevronDown, ChevronUp, MessageSquare, MessageSquarePlus, RotateCcw, X } from "lucide-react";
import { cn } from "cn";
import { Button } from "@/components/ui/button";
import { formatarDataHora } from "@/lib/projetos/formatar";
import { trechoLegivel } from "@/lib/propostas/ancora";
import { posicoesNaMargem } from "@/lib/propostas/margem";
import { COMENTARIO_MAX } from "@/lib/propostas/comentarios-limites";
import { comentarAction, resolverComentarioAction, responderComentarioAction, type RespostaComentario } from "./comentarios-actions";
import { mensagemErro, useComentarios, type ComentarioJson, type ThreadJson } from "./comentarios-contexto";

/** Resposta da action → texto de erro (com a ref do log quando inesperado), ou null. */
function erroDe(r: RespostaComentario | undefined): string | null {
  if (!r) return mensagemErro();
  if (r.ok) return null;
  return "ref" in r ? mensagemErro(r.ref) : r.erro;
}

function Cabecalho({ c }: { c: ComentarioJson }) {
  return (
    <p className="flex flex-wrap items-baseline gap-x-2 text-xs">
      <b className="font-medium text-foreground">{c.autor.nome}</b>
      <span className="text-fg-faint">{formatarDataHora(new Date(c.criadoEm))}</span>
      {c.viaMcp ? <span className="font-mono text-[10px] text-fg-faint uppercase">via MCP</span> : null}
    </p>
  );
}

/** Texto puro: o React escapa; quebras de linha preservadas pelo CSS. */
function Texto({ texto }: { texto: string }) {
  return <p className="mt-0.5 text-sm break-words whitespace-pre-wrap text-fg-soft">{texto}</p>;
}

function CampoTexto({ valor, mudar, rotulo, campo }: { valor: string; mudar: (v: string) => void; rotulo: string; campo?: React.Ref<HTMLTextAreaElement> }) {
  return (
    <textarea
      ref={campo}
      aria-label={rotulo}
      placeholder={rotulo}
      value={valor}
      maxLength={COMENTARIO_MAX}
      rows={2}
      onChange={(e) => mudar(e.target.value)}
      className="w-full resize-y rounded-lg border border-input bg-input/20 px-2 py-1.5 text-sm outline-none focus:border-ring focus:ring-3 focus:ring-ring/50"
    />
  );
}

function Thread({ t, topo }: { t: ThreadJson; topo?: number }) {
  const c = useComentarios()!;
  const resposta = c.rascunhos[t.id] ?? "";
  const setResposta = (v: string) => c.escreverRascunho(t.id, v);
  const [respondendo, setRespondendo] = useState(resposta !== "");
  const [erro, setErro] = useState<string | null>(null);
  const [ocupado, startTransition] = useTransition();
  const alterado = c.alterado(t);
  const ativo = c.ativo === t.id;

  function agir(fazer: () => Promise<RespostaComentario>, depois?: () => void) {
    setErro(null);
    startTransition(async () => {
      let r: RespostaComentario | undefined;
      try {
        r = await fazer();
      } catch {
        r = undefined;
      }
      const e = erroDe(r);
      if (e) return setErro(e);
      depois?.();
      await c.recarregar();
    });
  }

  return (
    <li
      id={`comentario-${t.id}`}
      data-thread={t.id}
      style={topo === undefined ? undefined : { position: "absolute", top: topo, left: 0, right: 0 }}
      className={cn("rounded-lg border border-border bg-surface p-3", ativo && "z-[1] border-warn bg-surface-strong", t.resolvido && "opacity-75")}
    >
      {/* Fio até a linha comentada: atravessa o vão entre a margem e a folha. */}
      {topo !== undefined && t.ancora && !alterado && !t.resolvido ? <span aria-hidden className="absolute top-4 -right-5 w-5 border-t border-dashed border-warn" /> : null}
      {t.ancora ? (
        <button
          type="button"
          onClick={() => c.ativar(ativo ? null : t.id, "painel")}
          title={alterado ? "O trecho foi editado ou apagado do texto" : "Mostrar o trecho no texto"}
          className="mb-2 block w-full rounded-md border-l-2 border-warn bg-surface-hover/60 px-2 py-1 text-left text-xs text-fg-mute"
        >
          <span className="line-clamp-3 break-words italic">“{trechoLegivel(t.ancora.trecho)}”</span>
          {alterado ? <span className="mt-1 inline-block rounded bg-warn-soft px-1.5 py-0.5 font-mono text-[10px] text-foreground not-italic uppercase">trecho alterado</span> : null}
        </button>
      ) : (
        <p className="mb-1 font-mono text-[10px] text-fg-faint uppercase">geral</p>
      )}
      <Cabecalho c={t} />
      <Texto texto={t.texto} />
      {t.respostas.length ? (
        <ul className="mt-2 space-y-2 border-l border-border pl-3">
          {t.respostas.map((r) => (
            <li key={r.id}>
              <Cabecalho c={r} />
              <Texto texto={r.texto} />
            </li>
          ))}
        </ul>
      ) : null}
      {t.resolvido ? (
        <p className="mt-2 text-xs text-fg-mute">
          <Check className="mr-1 inline size-3" />
          Resolvido{t.resolvido.por ? ` por ${t.resolvido.por}` : ""} em {formatarDataHora(new Date(t.resolvido.em))}
        </p>
      ) : null}
      {respondendo ? (
        <form
          className="mt-2 space-y-1.5"
          onSubmit={(e) => {
            e.preventDefault();
            agir(
              () => responderComentarioAction(t.id, resposta),
              () => {
                setResposta("");
                setRespondendo(false);
              },
            );
          }}
        >
          <CampoTexto valor={resposta} mudar={setResposta} rotulo="Sua resposta" />
          <div className="flex gap-2">
            <Button type="submit" size="xs" disabled={ocupado || !resposta.trim()}>
              Responder
            </Button>
            <Button type="button" size="xs" variant="ghost" onClick={() => setRespondendo(false)}>
              Cancelar
            </Button>
          </div>
        </form>
      ) : (
        <div className="mt-2 flex flex-wrap gap-1">
          <Button type="button" size="xs" variant="ghost" onClick={() => setRespondendo(true)}>
            <MessageSquare className="size-3" /> Responder
          </Button>
          {t.resolvido ? (
            <Button type="button" size="xs" variant="ghost" disabled={ocupado} onClick={() => agir(() => resolverComentarioAction(t.id, false))}>
              <RotateCcw className="size-3" /> Reabrir
            </Button>
          ) : (
            <Button type="button" size="xs" variant="ghost" disabled={ocupado} onClick={() => agir(() => resolverComentarioAction(t.id, true))}>
              <Check className="size-3" /> Resolver
            </Button>
          )}
        </div>
      )}
      {erro ? (
        <p role="alert" className="mt-2 text-xs text-destructive">
          {erro}
        </p>
      ) : null}
    </li>
  );
}

/**
 * Cartões na altura da linha comentada: o trecho é achado pelo `data-comentario` que a
 * folha põe nele (editor ou leitura). Roda de novo quando a folha ou os cartões mudam de
 * tamanho ou o destaque muda de lugar. Só mede e posiciona: não toca no documento.
 */
function usePosicoes(lista: React.RefObject<HTMLUListElement | null>, threads: ThreadJson[], ligado: boolean) {
  const [posicoes, setPosicoes] = useState<{ topos: Record<string, number>; altura: number } | null>(null);
  const chave = threads.map((t) => t.id).join();
  useLayoutEffect(() => {
    const ul = lista.current;
    if (!ligado || !ul) return;
    const medir = () => {
      const base = ul.getBoundingClientRect().top;
      const itens = [...ul.querySelectorAll<HTMLElement>("[data-thread]")].map((el) => {
        const id = el.dataset.thread!;
        const alvo = document.querySelector(`[data-comentario="${CSS.escape(id)}"]`);
        return { id, alvo: alvo ? alvo.getBoundingClientRect().top - base : null, altura: el.offsetHeight };
      });
      const r = posicoesNaMargem(itens);
      setPosicoes((a) => (a && a.altura === r.altura && itens.every((i) => a.topos[i.id] === r.topos[i.id]) ? a : r));
    };
    let quadro = 0;
    const agendar = () => {
      cancelAnimationFrame(quadro);
      quadro = requestAnimationFrame(medir);
    };
    medir();
    const tamanho = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(agendar);
    tamanho?.observe(ul);
    ul.querySelectorAll("[data-thread]").forEach((el) => tamanho?.observe(el));
    // O editor carrega depois (só no navegador) e desenha os destaques depois: observa a grade toda.
    let folha: Element | null = null;
    const olharFolha = () => {
      const f = document.querySelector("[data-folha]");
      if (f && f !== folha) {
        if (folha) tamanho?.unobserve(folha);
        tamanho?.observe(f);
        folha = f;
      }
    };
    olharFolha();
    const mudancas =
      typeof MutationObserver === "undefined"
        ? null
        : new MutationObserver(() => {
            olharFolha();
            agendar();
          });
    mudancas?.observe(ul.closest(".grade-proposta") ?? document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ["data-comentario"] });
    window.addEventListener("resize", agendar);
    return () => {
      cancelAnimationFrame(quadro);
      tamanho?.disconnect();
      mudancas?.disconnect();
      window.removeEventListener("resize", agendar);
    };
  }, [lista, ligado, chave]);
  return ligado ? posicoes : null;
}

/**
 * Comentários da proposta (GAB-91): qualquer pessoa logada comenta (geral ou
 * citando um trecho), responde, resolve e reabre — sem a caneta. Atualiza
 * sozinho pelo polling do `ComentariosProvider`.
 *
 * GAB-100, `alinhar`: é a margem esquerda da folha. Cartão na altura da linha, o de baixo
 * desce se colidir, e o formulário fica recolhido no topo fixo da coluna.
 */
export function PainelComentarios({ alinhar = false }: { alinhar?: boolean }) {
  const c = useComentarios();
  const texto = c?.rascunhos.novo ?? "";
  const setTexto = (v: string) => c?.escreverRascunho("novo", v);
  const [erro, setErro] = useState<string | null>(null);
  const [verResolvidos, setVerResolvidos] = useState(false);
  const [ocupado, startTransition] = useTransition();
  const [formAberto, setFormAberto] = useState(false);
  const campo = useRef<HTMLTextAreaElement>(null);
  const lista = useRef<HTMLUListElement>(null);
  const pedidoFoco = c?.pedidoFoco ?? 0;
  const abertos = c?.threads.filter((t) => !t.resolvido) ?? [];
  const resolvidos = (c?.threads.length ?? 0) - abertos.length;
  const visiveis = verResolvidos ? (c?.threads ?? []) : abertos;
  const posicoes = usePosicoes(lista, visiveis, alinhar);

  const consumirFoco = c?.consumirFoco;
  useEffect(() => {
    if (consumirFoco?.()) campo.current?.focus({ preventScroll: alinhar });
  }, [pedidoFoco, alinhar, consumirFoco]);

  // Abriu o painel no celular a partir de um trecho: mostra o comentário dele.
  const ativo = c?.ativo ?? null;
  useEffect(() => {
    if (!alinhar && ativo) document.getElementById(`comentario-${ativo}`)?.scrollIntoView?.({ block: "nearest" });
  }, [alinhar, ativo]);

  if (!c) return null;
  const comForm = !alinhar || formAberto || !!c.citado || texto.trim() !== "";

  /** Setas: anterior e próximo entre os abertos que têm trecho na tela, na ordem do texto. */
  function navegar(passo: -1 | 1) {
    const naTela = abertos.filter((t) => t.ancora && !c!.alterado(t));
    if (naTela.length === 0) return;
    const ordenados = [...naTela].sort((a, b) => topoDoTrecho(a.id) - topoDoTrecho(b.id));
    const i = ordenados.findIndex((t) => t.id === c!.ativo);
    const prox = i === -1 ? (passo === 1 ? 0 : ordenados.length - 1) : (i + passo + ordenados.length) % ordenados.length;
    c!.ativar(ordenados[prox].id, "painel");
  }

  function enviar() {
    setErro(null);
    const citado = c!.citado;
    startTransition(async () => {
      let r: RespostaComentario | undefined;
      try {
        r = await comentarAction(c!.projetoId, texto, citado);
      } catch {
        r = undefined;
      }
      const e = erroDe(r);
      if (e) return setErro(e);
      setTexto("");
      setFormAberto(false);
      c!.citar(null);
      await c!.recarregar();
    });
  }

  return (
    <section className={alinhar ? "" : "rounded-xl border border-border bg-surface p-4"} aria-label="Comentários">
      <div className={cn("mb-3", alinhar && "sticky top-14 z-[4] -mx-1 bg-background px-1 pt-1 pb-2")}>
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <h2 className="sr-only">Comentários</h2>
          <span className="eyebrow">
            {abertos.length} {abertos.length === 1 ? "aberto" : "abertos"} · {resolvidos} {resolvidos === 1 ? "resolvido" : "resolvidos"}
          </span>
          <span className="flex-1" />
          <span className="flex">
            <Button type="button" size="icon-xs" variant="ghost" aria-label="Comentário anterior" title="Anterior" disabled={abertos.length === 0} onClick={() => navegar(-1)}>
              <ChevronUp />
            </Button>
            <Button type="button" size="icon-xs" variant="ghost" aria-label="Próximo comentário" title="Próximo" disabled={abertos.length === 0} onClick={() => navegar(1)}>
              <ChevronDown />
            </Button>
          </span>
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-2">
          {alinhar && !comForm ? (
            <Button type="button" size="xs" variant="outline" onClick={() => setFormAberto(true)}>
              <MessageSquarePlus className="size-3" /> Comentário geral
            </Button>
          ) : null}
          {resolvidos ? (
            <button type="button" className="text-xs text-fg-mute underline-offset-2 hover:underline" onClick={() => setVerResolvidos((v) => !v)}>
              {verResolvidos ? "Esconder resolvidos" : `Ver resolvidos (${resolvidos})`}
            </button>
          ) : null}
        </div>

        {comForm ? (
          <form
            className="mt-2 space-y-1.5"
            onSubmit={(e) => {
              e.preventDefault();
              enviar();
            }}
          >
            {c.citado ? (
              <div className="flex items-start gap-1 rounded-md border-l-2 border-warn bg-surface-hover/60 px-2 py-1 text-xs text-fg-mute">
                <span className="line-clamp-3 flex-1 break-words italic">“{trechoLegivel(c.citado.trecho)}”</span>
                <button type="button" aria-label="Tirar o trecho citado" className="text-fg-faint hover:text-foreground" onClick={() => c.citar(null)}>
                  <X className="size-3.5" />
                </button>
              </div>
            ) : null}
            <CampoTexto valor={texto} mudar={setTexto} rotulo={c.citado ? "Comentário sobre o trecho" : "Comentário geral"} campo={campo} />
            <div className="flex flex-wrap items-center gap-2">
              <Button type="submit" size="xs" disabled={ocupado || !texto.trim()}>
                Comentar
              </Button>
              {alinhar ? (
                <Button
                  type="button"
                  size="xs"
                  variant="ghost"
                  onClick={() => {
                    setFormAberto(false);
                    setTexto("");
                    c.citar(null);
                  }}
                >
                  Cancelar
                </Button>
              ) : !c.citado ? (
                <span className="text-[11px] text-fg-faint">Para citar um trecho: selecione no texto e use “Comentar trecho”.</span>
              ) : null}
            </div>
            {erro ? (
              <p role="alert" className="text-xs text-destructive">
                {erro}
              </p>
            ) : null}
          </form>
        ) : null}

        {c.erroCarga ? (
          <p role="alert" className="mt-2 text-xs text-destructive">
            {c.erroCarga}
          </p>
        ) : null}
      </div>

      {visiveis.length ? (
        <ul ref={lista} className={cn("mt-4", posicoes ? "relative" : "space-y-3")} style={posicoes ? { height: posicoes.altura } : undefined}>
          {visiveis.map((t) => (
            <Thread key={t.id} t={t} topo={posicoes?.topos[t.id]} />
          ))}
        </ul>
      ) : (
        <p className="mt-4 text-xs text-fg-faint">{c.threads.length ? "Nenhum comentário aberto." : "Nenhum comentário ainda."}</p>
      )}
    </section>
  );
}

function topoDoTrecho(id: string): number {
  return document.querySelector(`[data-comentario="${CSS.escape(id)}"]`)?.getBoundingClientRect().top ?? Number.POSITIVE_INFINITY;
}
