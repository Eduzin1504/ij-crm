"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { Check, MessageSquare, RotateCcw, X } from "lucide-react";
import { cn } from "cn";
import { Button } from "@/components/ui/button";
import { formatarDataHora } from "@/lib/projetos/formatar";
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

function Thread({ t }: { t: ThreadJson }) {
  const c = useComentarios()!;
  const [respondendo, setRespondendo] = useState(false);
  const [resposta, setResposta] = useState("");
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
      className={cn("rounded-lg border border-border p-3", ativo && "border-warn bg-warn-soft/40", t.resolvido && "opacity-75")}
    >
      {t.ancora ? (
        <button
          type="button"
          onClick={() => c.ativar(ativo ? null : t.id, "painel")}
          title={alterado ? "O trecho foi editado ou apagado do texto" : "Mostrar o trecho no texto"}
          className="mb-2 block w-full rounded-md border-l-2 border-warn bg-surface-hover/60 px-2 py-1 text-left text-xs text-fg-mute"
        >
          <span className="line-clamp-3 break-words italic">“{t.ancora.trecho}”</span>
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
 * Comentários da proposta (GAB-91): qualquer pessoa logada comenta (geral ou
 * citando um trecho), responde, resolve e reabre — sem a caneta. Atualiza
 * sozinho pelo polling do `ComentariosProvider`.
 */
export function PainelComentarios() {
  const c = useComentarios();
  const [texto, setTexto] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [verResolvidos, setVerResolvidos] = useState(false);
  const [ocupado, startTransition] = useTransition();
  const campo = useRef<HTMLTextAreaElement>(null);
  const pedidoFoco = c?.pedidoFoco ?? 0;

  useEffect(() => {
    if (pedidoFoco > 0) campo.current?.focus();
  }, [pedidoFoco]);

  if (!c) return null;
  const abertos = c.threads.filter((t) => !t.resolvido);
  const resolvidos = c.threads.length - abertos.length;
  const visiveis = verResolvidos ? c.threads : abertos;

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
      c!.citar(null);
      await c!.recarregar();
    });
  }

  return (
    <section className="rounded-xl border border-border bg-surface p-4" aria-label="Comentários">
      <div className="mb-3 flex items-center gap-2">
        <h2 className="text-sm font-medium">Comentários</h2>
        <span className="font-mono text-[11px] text-fg-faint">{abertos.length} abertos</span>
        <span className="flex-1" />
        {resolvidos ? (
          <button type="button" className="text-xs text-fg-mute underline-offset-2 hover:underline" onClick={() => setVerResolvidos((v) => !v)}>
            {verResolvidos ? "Esconder resolvidos" : `Ver resolvidos (${resolvidos})`}
          </button>
        ) : null}
      </div>

      <form
        className="space-y-1.5"
        onSubmit={(e) => {
          e.preventDefault();
          enviar();
        }}
      >
        {c.citado ? (
          <div className="flex items-start gap-1 rounded-md border-l-2 border-warn bg-surface-hover/60 px-2 py-1 text-xs text-fg-mute">
            <span className="line-clamp-3 flex-1 break-words italic">“{c.citado.trecho}”</span>
            <button type="button" aria-label="Tirar o trecho citado" className="text-fg-faint hover:text-foreground" onClick={() => c.citar(null)}>
              <X className="size-3.5" />
            </button>
          </div>
        ) : null}
        <CampoTexto valor={texto} mudar={setTexto} rotulo={c.citado ? "Comentário sobre o trecho" : "Comentário geral"} campo={campo} />
        <div className="flex items-center gap-2">
          <Button type="submit" size="xs" disabled={ocupado || !texto.trim()}>
            Comentar
          </Button>
          {!c.citado ? <span className="text-[11px] text-fg-faint">Para citar um trecho: selecione no texto e use “Comentar trecho”.</span> : null}
        </div>
        {erro ? (
          <p role="alert" className="text-xs text-destructive">
            {erro}
          </p>
        ) : null}
      </form>

      {c.erroCarga ? (
        <p role="alert" className="mt-3 text-xs text-destructive">
          {c.erroCarga}
        </p>
      ) : null}

      {visiveis.length ? (
        <ul className="mt-4 space-y-3">
          {visiveis.map((t) => (
            <Thread key={t.id} t={t} />
          ))}
        </ul>
      ) : (
        <p className="mt-4 text-xs text-fg-faint">{c.threads.length ? "Nenhum comentário aberto." : "Nenhum comentário ainda."}</p>
      )}
    </section>
  );
}
