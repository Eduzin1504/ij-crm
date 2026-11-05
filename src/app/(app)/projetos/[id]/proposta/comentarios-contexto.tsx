"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { MessageSquarePlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DocumentoView } from "@/components/propostas/documento-view";
import type { EntradaDestaques } from "@/components/propostas/destaques-editor";
import { ancoraDaSelecaoDom } from "@/components/propostas/selecao-dom";
import { ancoraDoBloco, localizarAncora, textoPlano, type Ancora, type Destaque } from "@/lib/propostas/ancora";
import { normalizarDocumento, type Documento, type TipoBlocoDados } from "@/lib/propostas/documento";
import type { Estruturado } from "@/lib/propostas/estruturado";

/** Polling dos comentários: ≤ ~10 s para aparecer em outra tela. Pausa com a aba oculta. */
export const INTERVALO_COMENTARIOS_MS = 5_000;
/** O editor informa o texto a cada tecla: recalcula "trecho alterado" só depois de uma pausa. */
export const ATRASO_TEXTO_MS = 300;
export const SESSAO_EXPIRADA = "Sessão expirada: recarregue a página para ver comentários novos.";

export type ComentarioJson = { id: string; autor: { id: string; nome: string }; texto: string; criadoEm: string; viaMcp: boolean };
export type ThreadJson = ComentarioJson & {
  ancora: Ancora | null;
  trechoAlterado: boolean;
  resolvido: { por: string | null; em: string } | null;
  respostas: ComentarioJson[];
};

/** O editor manda o documento cru ("a  b"): compara no formato canônico, como o servidor. */
const planoCanonico = (d: Documento) => textoPlano(normalizarDocumento(d)).texto;

export function mensagemErro(ref?: string): string {
  return ref ? `Erro no servidor (ref: ${ref}). Tente de novo; se persistir, informe a ref.` : "Não deu para falar com o servidor. Tente de novo.";
}

type Contexto = {
  projetoId: string;
  euId: string;
  threads: ThreadJson[];
  erroCarga: string | null;
  recarregar: () => Promise<void>;
  /** Trecho "alterado" contra o texto que ESTA tela mostra (editor ao vivo ou leitura). */
  alterado: (t: ThreadJson) => boolean;
  ativo: string | null;
  ativar: (id: string | null, origem: "texto" | "painel") => void;
  /** Trecho citado esperando o comentário (o botão "Comentar trecho" preenche). */
  citado: Ancora | null;
  citar: (a: Ancora | null) => void;
  /** Incrementa a cada citação: o formulário foca o campo. */
  pedidoFoco: number;
  /** A fonte de seleção ativa (editor ou leitura) se registra aqui. */
  registrarSelecao: (fn: () => Ancora | null) => () => void;
  lerSelecao: () => Ancora | null;
  informarTexto: (d: Documento) => void;
  /** Threads abertas com trecho: o que se destaca no texto. */
  ancoras: { id: string; ancora: Ancora }[];
  /** Rascunhos ("novo" ou id da thread): aqui, para não sumirem ao fechar o painel no celular. */
  rascunhos: Record<string, string>;
  escreverRascunho: (chave: string, texto: string) => void;
  /** Citação nova ainda sem foco no campo: reabrir o painel depois não abre o teclado. */
  consumirFoco: () => boolean;
  /** Incrementa quando tocam num trecho destacado na leitura: no celular, abre o painel de comentários. */
  pedidoPainel: number;
};

const Ctx = createContext<Contexto | null>(null);

/** null fora do provider (ex.: testes do painel da proposta): tudo de comentário some. */
export function useComentarios(): Contexto | null {
  return useContext(Ctx);
}

/**
 * Comentários da proposta ao vivo (GAB-91): carga inicial do servidor e
 * polling barato (`?v=`: o servidor só lista quando algo mudou) a cada 5 s,
 * pausado com a aba oculta e retomado na volta.
 */
export function ComentariosProvider({ projetoId, euId, inicial, children }: { projetoId: string; euId: string; inicial: { versao: string; threads: ThreadJson[] }; children: ReactNode }) {
  const [threads, setThreads] = useState(inicial.threads);
  const [erroCarga, setErroCarga] = useState<string | null>(null);
  const [ativo, setAtivo] = useState<string | null>(null);
  const [citado, setCitado] = useState<Ancora | null>(null);
  const [pedidoFoco, setPedidoFoco] = useState(0);
  const [texto, setTexto] = useState<string | null>(null);
  const [rascunhos, setRascunhos] = useState<Record<string, string>>({});
  const [pedidoPainel, setPedidoPainel] = useState(0);
  const escreverRascunho = useCallback((chave: string, valor: string) => setRascunhos((r) => ({ ...r, [chave]: valor })), []);
  const focoPendente = useRef(false);
  const versao = useRef(inicial.versao);
  const fonte = useRef<(() => Ancora | null) | null>(null);
  // Respostas fora de ordem (polling + recarga depois de comentar): só a da última requisição vale.
  const requisicao = useRef(0);
  // Requisições em andamento: o tick do polling não empilha outra (rede lenta > 5 s
  // faria toda resposta chegar "velha" pelo contador e a tela nunca atualizar).
  const emAndamento = useRef(0);
  const [expirada, setExpirada] = useState(false);

  const recarregar = useCallback(async () => {
    const minha = ++requisicao.current;
    emAndamento.current++;
    try {
      const r = await fetch(`/api/projetos/${encodeURIComponent(projetoId)}/comentarios?v=${encodeURIComponent(versao.current)}`, { cache: "no-store" });
      const corpo = (await r.json().catch(() => ({}))) as { versao?: string; comentarios?: ThreadJson[]; ref?: string };
      if (minha !== requisicao.current) return;
      if (r.status === 401) {
        // Sessão expirou: para o polling (não adianta insistir) e diz o que fazer.
        setExpirada(true);
        setErroCarga(SESSAO_EXPIRADA);
        return;
      }
      if (!r.ok) {
        // 404 não tem ref: a proposta sumiu — a próxima navegação resolve.
        if (corpo.ref) setErroCarga(mensagemErro(corpo.ref));
        return;
      }
      setErroCarga(null);
      // Sessão voltou (ex.: recarga depois de uma ação respondeu ok): o polling retoma.
      setExpirada(false);
      if (corpo.versao) versao.current = corpo.versao;
      if (corpo.comentarios) setThreads(corpo.comentarios);
    } catch {
      // Rede oscilou: mantém o que tem; a próxima rodada tenta de novo.
    } finally {
      emAndamento.current--;
    }
  }, [projetoId]);

  useEffect(() => {
    if (expirada) return;
    let timer: ReturnType<typeof setInterval> | undefined;
    const tick = () => {
      if (emAndamento.current === 0) void recarregar();
    };
    const parar = () => {
      if (timer) clearInterval(timer);
      timer = undefined;
    };
    const iniciar = () => {
      parar();
      timer = setInterval(tick, INTERVALO_COMENTARIOS_MS);
    };
    const aoMudarVisibilidade = () => {
      if (document.hidden) return parar();
      tick();
      iniciar();
    };
    if (!document.hidden) iniciar();
    document.addEventListener("visibilitychange", aoMudarVisibilidade);
    return () => {
      parar();
      document.removeEventListener("visibilitychange", aoMudarVisibilidade);
    };
  }, [recarregar, expirada]);

  const ativar = useCallback((id: string | null, origem: "texto" | "painel") => {
    setAtivo(id);
    if (!id) return;
    // Rola até o outro lado: clicou no texto → o comentário; no comentário → o trecho.
    requestAnimationFrame(() => {
      const alvo = origem === "texto" ? document.getElementById(`comentario-${id}`) : document.querySelector(`[data-comentario="${CSS.escape(id)}"]`);
      alvo?.scrollIntoView?.({ block: origem === "texto" ? "nearest" : "center", behavior: "smooth" });
    });
  }, []);

  // Clique num trecho destacado (editor ou leitura) ativa o comentário dele.
  useEffect(() => {
    const clique = (e: MouseEvent) => {
      const el = (e.target as Element | null)?.closest?.("[data-comentario]");
      if (!el) return;
      ativar(el.getAttribute("data-comentario"), "texto");
      // No editor o toque é para pôr o cursor: não cobre o texto (o painel abre pelo botão).
      if (!el.closest(".ProseMirror")) setPedidoPainel((n) => n + 1);
    };
    document.addEventListener("click", clique);
    return () => document.removeEventListener("click", clique);
  }, [ativar]);

  const citar = useCallback((a: Ancora | null) => {
    setCitado(a);
    if (a) {
      focoPendente.current = true;
      setPedidoFoco((n) => n + 1);
    }
  }, []);
  const consumirFoco = useCallback(() => {
    const pendente = focoPendente.current;
    focoPendente.current = false;
    return pendente;
  }, []);
  const registrarSelecao = useCallback((fn: () => Ancora | null) => {
    fonte.current = fn;
    return () => {
      if (fonte.current === fn) fonte.current = null;
    };
  }, []);
  const lerSelecao = useCallback(() => fonte.current?.() ?? null, []);
  // Primeira vez na hora (a tela abre já certa); depois, com pausa (o editor chama a cada tecla).
  const atrasoTexto = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const jaInformou = useRef(false);
  const informarTexto = useCallback((d: Documento) => {
    clearTimeout(atrasoTexto.current);
    if (!jaInformou.current) {
      jaInformou.current = true;
      setTexto(planoCanonico(d));
      return;
    }
    atrasoTexto.current = setTimeout(() => setTexto(planoCanonico(d)), ATRASO_TEXTO_MS);
  }, []);
  useEffect(() => () => clearTimeout(atrasoTexto.current), []);
  const alterado = useCallback((t: ThreadJson) => (t.ancora ? (texto === null ? t.trechoAlterado : localizarAncora(texto, t.ancora) === null) : false), [texto]);

  const ancoras = useMemo(() => threads.filter((t) => t.ancora && !t.resolvido).map((t) => ({ id: t.id, ancora: t.ancora! })), [threads]);

  const valor = useMemo<Contexto>(
    () => ({
      projetoId,
      euId,
      threads,
      erroCarga,
      recarregar,
      alterado,
      ativo,
      ativar,
      citado,
      citar,
      pedidoFoco,
      registrarSelecao,
      lerSelecao,
      informarTexto,
      ancoras,
      rascunhos,
      escreverRascunho,
      consumirFoco,
      pedidoPainel,
    }),
    [projetoId, euId, threads, erroCarga, recarregar, alterado, ativo, ativar, citado, citar, pedidoFoco, registrarSelecao, lerSelecao, informarTexto, ancoras, rascunhos, escreverRascunho, consumirFoco, pedidoPainel],
  );
  return <Ctx.Provider value={valor}>{children}</Ctx.Provider>;
}

/** Entrada da decoração do editor (memo: só muda com os comentários ou o ativo). */
export function useDestaquesDoEditor(): EntradaDestaques | undefined {
  const c = useComentarios();
  const ancoras = c?.ancoras;
  const ativo = c?.ativo ?? null;
  return useMemo(() => (ancoras ? { destaques: ancoras, ativo } : undefined), [ancoras, ativo]);
}

/**
 * "Comentar trecho": lê a seleção da fonte ativa (editor ou leitura). O
 * `mousedown` não tira o foco/seleção do texto (como a barra do editor).
 */
export function BotaoComentarTrecho({ compacto = false }: { compacto?: boolean }) {
  const c = useComentarios();
  const [dica, setDica] = useState<string | null>(null);
  if (!c) return null;
  return (
    <span className="inline-flex items-center gap-2">
      {dica ? (
        <span role="status" className="text-xs text-fg-mute">
          {dica}
        </span>
      ) : null}
      <Button
        type="button"
        size={compacto ? "icon-xs" : "xs"}
        variant="outline"
        aria-label="Comentar trecho"
        title="Comentar trecho"
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => {
          const a = c.lerSelecao();
          setDica(a ? null : "Selecione um trecho do texto (até 500 caracteres) e clique de novo.");
          if (a) c.citar(a);
        }}
      >
        <MessageSquarePlus className="size-3.5" />
        {compacto ? null : " Comentar trecho"}
      </Button>
    </span>
  );
}

/** Leitura do rascunho (quem não está com a caneta) com os trechos comentados realçados e seleção comentável. */
export function TextoComentavel({ documento, dados }: { documento: Documento; dados?: Estruturado }) {
  const c = useComentarios();
  const raiz = useRef<HTMLDivElement>(null);
  const plano = useMemo(() => textoPlano(documento).texto, [documento]);
  const informar = c?.informarTexto;
  const registrar = c?.registrarSelecao;
  useEffect(() => informar?.(documento), [informar, documento]);
  useEffect(() => registrar?.(() => (raiz.current ? ancoraDaSelecaoDom(raiz.current, plano) : null)), [registrar, plano]);
  const destaques = useMemo<Destaque[]>(
    () =>
      (c?.ancoras ?? []).flatMap((a) => {
        const f = localizarAncora(plano, a.ancora);
        return f ? [{ id: a.id, ...f }] : [];
      }),
    [c?.ancoras, plano],
  );
  return (
    <div ref={raiz}>
      <DocumentoView documento={documento} destaques={destaques} ativo={c?.ativo ?? null} dados={dados} controlesBloco={c ? (tipo) => <ComentarBloco documento={documento} tipo={tipo} /> : undefined} />
    </div>
  );
}

/** Comentar o bloco inteiro: a âncora é o título dele, no lugar em que está (GAB-100). */
function ComentarBloco({ documento, tipo }: { documento: Documento; tipo: TipoBlocoDados }) {
  const c = useComentarios();
  if (!c) return null;
  return (
    <span className="bloco-dados-controles">
      <button
        type="button"
        aria-label="Comentar o bloco"
        title="Comentar o bloco"
        className="inline-flex size-6 items-center justify-center rounded-md text-fg-soft hover:bg-surface-hover hover:text-foreground"
        onClick={() => {
          const a = ancoraDoBloco(documento, tipo);
          if (a) c.citar(a);
        }}
      >
        <MessageSquarePlus className="size-3.5" />
      </button>
    </span>
  );
}
