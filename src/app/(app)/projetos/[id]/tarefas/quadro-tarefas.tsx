"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import type { PrioridadeTarefa, StatusTarefa } from "@prisma/client";
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  MeasuringStrategy,
  MouseSensor,
  TouchSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { CSS as DndCSS } from "@dnd-kit/utilities";
import { ChevronDown, Plus } from "lucide-react";
import { cn } from "cn";
import { Avatar } from "@/components/avatar";
import { EstadoVazio } from "@/components/estado-vazio";
import { MensagemErro } from "@/components/erros/mensagem-erro";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { executarAcao, falhaDe, FALHA_CONEXAO, type FalhaUI } from "@/lib/erros/cliente";
import { aplicarExibicao, ordenador, type Exibicao } from "@/lib/tarefas/exibicao";
import { FILTROS_VAZIOS, escreverFiltros, filtrarTarefas, lerFiltros, type Filtros } from "@/lib/tarefas/filtros";
import { PRIORIDADES, ROTULO_PRIORIDADE, TITULO_MAX, type PessoaTarefa, type TarefaLista } from "@/lib/tarefas/modelo";
import { COLUNAS, ROTULO_STATUS, SEM_ETIQUETA, SEM_RESPONSAVEL, agrupar, posicaoEntre, type Coluna, type Linha } from "@/lib/tarefas/quadro";
import { colisaoQuadro } from "../../../kanban/colisao";
import { criarTarefaAction, editarTarefaAction, moverTarefaAction, salvarExibicaoTarefasAction } from "./actions";
import { BarraTarefas } from "./barra-tarefas";
import { CartaoTarefa, IconePrioridade, IconeStatus } from "./cartao-tarefa";
import { DetalheTarefa, type PatchLocal } from "./detalhe-tarefa";
import { ListaTarefas } from "./lista-tarefas";
import { MenuOpcoes } from "./menu";

type Props = {
  projetoId: string;
  tarefas: TarefaLista[];
  pessoas: PessoaTarefa[];
  etiquetas: string[];
  exibicaoInicial: Exibicao;
  /** `YYYY-MM-DD` de hoje no fuso de negócio e o instante (vêm do servidor: sem diferença de hidratação). */
  hoje: string;
  agoraMs: number;
};

type Pre = { status: StatusTarefa; responsavelId: string | null; prioridade?: PrioridadeTarefa; etiquetas?: string[] };
type Atalho = { id: string; campo: "status" | "prio" | "resp"; ancora: HTMLElement | null } | null;
type MenuAberto = { tipo: "filtro" | "exibicao"; ancora: HTMLElement | null } | null;

const idCelula = (status: StatusTarefa, linha: string) => `cel:${status}:${linha}`;
const lerCelula = (id: string | number | undefined): { status: StatusTarefa; linha: string } | null => {
  const s = String(id ?? "");
  if (!s.startsWith("cel:")) return null;
  const [, status, ...linha] = s.split(":");
  return { status: status as StatusTarefa, linha: linha.join(":") };
};
const ATRASO_SALVAR_EXIBICAO_MS = 600;

/**
 * Tarefas do projeto: quadro (colunas por status × linhas do agrupamento) ou
 * lista, com filtros na URL e exibição por pessoa. Otimista: o estado parte
 * do servidor e é re-sincronizado quando chegam props novas (revalidate após
 * cada action; e ao voltar à aba).
 */
export function QuadroTarefas({ projetoId, tarefas: doServidor, pessoas, etiquetas: etiquetasServidor, exibicaoInicial, hoje, agoraMs }: Props) {
  const [base, setBase] = useState(doServidor);
  const [tarefas, setTarefas] = useState(doServidor);
  if (base !== doServidor) {
    setBase(doServidor);
    setTarefas(doServidor);
  }
  const [exibicao, setExibicao] = useState(exibicaoInicial);
  const [ativa, setAtiva] = useState<TarefaLista | null>(null);
  const [abertaId, setAbertaId] = useState<string | null>(null);
  const [selecionada, setSelecionada] = useState<string | null>(null);
  const [abertasManual, setAbertasManual] = useState<Set<StatusTarefa>>(new Set());
  const [fechados, setFechados] = useState<Set<string>>(new Set());
  const [menu, setMenu] = useState<MenuAberto>(null);
  const [atalho, setAtalho] = useState<Atalho>(null);
  const [criarEm, setCriarEm] = useState<Pre | null>(null);
  const [erro, setErro] = useState<FalhaUI | null>(null);
  const [, startTransition] = useTransition();
  const router = useRouter();
  const refFiltro = useRef<HTMLButtonElement>(null);
  const refExibicao = useRef<HTMLButtonElement>(null);
  const refQuadro = useRef<HTMLDivElement>(null);

  // Sem tempo real: atualiza ao voltar para a aba (spec §6).
  useEffect(() => {
    const aoVoltar = () => document.visibilityState === "visible" && router.refresh();
    document.addEventListener("visibilitychange", aoVoltar);
    return () => document.removeEventListener("visibilitychange", aoVoltar);
  }, [router]);

  /** Âncora do menu aberto por atalho (S/P/A): o cartão ou linha da tarefa, senão o botão Filtro. Lido num handler, nunca no render. */
  const abrirAtalho = (id: string, campo: "status" | "prio" | "resp") =>
    setAtalho({ id, campo, ancora: (refQuadro.current?.querySelector(`[data-id="${globalThis.CSS.escape(id)}"]`) as HTMLElement | null) ?? refFiltro.current });

  // Filtros moram na URL (link para um colega). `replaceState` não refaz o request.
  const searchParams = useSearchParams();
  const filtros = useMemo(() => lerFiltros(searchParams), [searchParams]);
  const mudarFiltros = useCallback((f: Filtros) => {
    const qs = escreverFiltros(f, new URLSearchParams(window.location.search)).toString();
    window.history.replaceState(null, "", qs ? `?${qs}` : window.location.pathname);
  }, []);

  // Exibição: otimista, salva no servidor com atraso (vários cliques = um request).
  const salvarPendente = useRef<ReturnType<typeof setTimeout> | null>(null);
  function mudarExibicao(e: Exibicao) {
    setExibicao(e);
    if (salvarPendente.current) clearTimeout(salvarPendente.current);
    salvarPendente.current = setTimeout(() => void executarAcao(() => salvarExibicaoTarefasAction(e), "salvar a exibição").then((f) => f && setErro(f)), ATRASO_SALVAR_EXIBICAO_MS);
  }

  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 8 } }),
    useSensor(KeyboardSensor),
  );

  const porId = useMemo(() => new Map(tarefas.map((t) => [t.id, t])), [tarefas]);
  const pessoaPorId = useMemo(() => new Map(pessoas.map((p) => [p.id, p])), [pessoas]);
  const etiquetas = useMemo(() => [...new Set([...etiquetasServidor, ...tarefas.flatMap((t) => t.etiquetas)])].sort((a, b) => a.localeCompare(b, "pt-BR")), [etiquetasServidor, tarefas]);
  const visiveis = useMemo(() => filtrarTarefas(aplicarExibicao(tarefas, exibicao, agoraMs), filtros, hoje), [tarefas, exibicao, filtros, agoraMs, hoje]);
  const ord = useMemo(() => ordenador(exibicao), [exibicao]);
  const agruparPor = exibicao.vista === "lista" && exibicao.agrupar === "nenhum" ? "status" : exibicao.agrupar;
  const linhas = useMemo(() => agrupar(visiveis, pessoas, agruparPor, ROTULO_STATUS, ROTULO_PRIORIDADE).map((l) => ({ ...l, tarefas: [...l.tarefas].sort(ord) })), [visiveis, pessoas, agruparPor, ord]);
  const colunasVisiveis = COLUNAS.filter((c) => !c.recolhida || exibicao.recolhidos || abertasManual.has(c.status));
  const aberta = abertaId ? (porId.get(abertaId) ?? null) : null;
  const subtarefasDe = useCallback(
    (id: string) => {
      const f = tarefas.filter((t) => t.paiId === id);
      return f.length ? { feitas: f.filter((t) => t.status === "FEITA" || t.status === "CANCELADA").length, total: f.length } : null;
    },
    [tarefas],
  );

  function aplicar(id: string, patch: PatchLocal) {
    setTarefas((ts) => ts.map((t) => (t.id === id ? { ...t, ...patch } : t)));
  }
  /** Edição direta (lista, atalhos): otimista + action. */
  function editar(id: string, patch: PatchLocal) {
    const snapshot = tarefas;
    setErro(null);
    aplicar(id, patch);
    startTransition(async () => {
      const falha = await executarAcao(() => editarTarefaAction(projetoId, id, patch), "salvar a tarefa");
      if (falha) {
        setTarefas(snapshot);
        setErro(falha);
        router.refresh();
      }
    });
  }

  /** O que uma linha do agrupamento impõe à tarefa solta nela. */
  function patchDaLinha(linha: string): { responsavelId?: string | null; prioridade?: PrioridadeTarefa } {
    if (agruparPor === "resp") return { responsavelId: linha === SEM_RESPONSAVEL ? null : linha };
    if (agruparPor === "prio") return { prioridade: linha as PrioridadeTarefa };
    return {};
  }

  function mover(id: string, status: StatusTarefa, linha: string, antesDeId: string | null) {
    const t = porId.get(id);
    if (!t) return;
    const daLinha = patchDaLinha(linha);
    const mudaResp = daLinha.responsavelId !== undefined && daLinha.responsavelId !== t.responsavelId;
    const mudaPrio = daLinha.prioridade !== undefined && daLinha.prioridade !== t.prioridade;
    const naCelula = linhas.find((l) => l.chave === linha)?.tarefas.filter((x) => x.id !== id && x.status === status) ?? [];
    const i = antesDeId ? naCelula.findIndex((x) => x.id === antesDeId) : -1;
    const antes = i === -1 ? (naCelula.at(-1)?.posicao ?? null) : i > 0 ? naCelula[i - 1].posicao : null;
    const depois = i === -1 ? null : naCelula[i].posicao;
    const posicao = posicaoEntre(antes, depois);
    const snapshot = tarefas;
    setErro(null);
    setTarefas((ts) => ts.map((x) => (x.id === id ? { ...x, status, posicao, ...(mudaResp ? { responsavelId: daLinha.responsavelId ?? null } : {}), ...(mudaPrio ? { prioridade: daLinha.prioridade! } : {}) } : x)));
    startTransition(async () => {
      const falha = await executarAcao(() => moverTarefaAction(projetoId, id, { status, posicao, ...(mudaResp ? { responsavelId: daLinha.responsavelId ?? null } : {}) }), "mover a tarefa");
      const falha2 = !falha && mudaPrio ? await executarAcao(() => editarTarefaAction(projetoId, id, { prioridade: daLinha.prioridade! }), "mudar a prioridade") : null;
      if (falha || falha2) {
        setTarefas(snapshot);
        setErro(falha ?? falha2);
        router.refresh();
      }
    });
  }

  function onDragStart(e: DragStartEvent) {
    setAtiva(porId.get(String(e.active.id)) ?? null);
  }
  function onDragEnd(e: DragEndEvent) {
    setAtiva(null);
    const over = e.over?.id;
    if (over === undefined) return;
    const cel = lerCelula(over);
    if (cel) return mover(String(e.active.id), cel.status, cel.linha, null);
    const alvo = porId.get(String(over));
    if (alvo && alvo.id !== e.active.id) {
      const linha = linhas.find((l) => l.tarefas.some((x) => x.id === alvo.id))?.chave ?? "all";
      mover(String(e.active.id), alvo.status, linha, alvo.id);
    }
  }

  const alternarColuna = (s: StatusTarefa) =>
    setAbertasManual((a) => {
      const n = new Set(a);
      if (n.has(s)) n.delete(s);
      else n.add(s);
      return n;
    });
  const alternarGrupo = (chave: string) =>
    setFechados((f) => {
      const n = new Set(f);
      if (n.has(chave)) n.delete(chave);
      else n.add(chave);
      return n;
    });

  function criarEmGrupo(l: Linha<TarefaLista>, status: StatusTarefa = "A_FAZER") {
    const pre: Pre = { status, responsavelId: null };
    if (agruparPor === "resp") pre.responsavelId = l.chave === SEM_RESPONSAVEL ? null : l.chave;
    if (agruparPor === "status") pre.status = l.chave as StatusTarefa;
    if (agruparPor === "prio") pre.prioridade = l.chave as PrioridadeTarefa;
    if (agruparPor === "etiqueta" && l.chave !== SEM_ETIQUETA) pre.etiquetas = [l.chave];
    setCriarEm(pre);
  }

  // Atalhos (spec §4): C cria, F filtro, D exibição, V quadro/lista, S/P/A na tarefa sob o mouse ou selecionada, 1–6 status, Esc. Nunca dentro de campos.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const alvo = e.target as HTMLElement | null;
      if (alvo && (["INPUT", "TEXTAREA", "SELECT"].includes(alvo.tagName) || alvo.isContentEditable)) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const k = e.key.toLowerCase();
      const t = selecionada ? porId.get(selecionada) : undefined;
      if (k === "escape") {
        if (menu || atalho) {
          setMenu(null);
          setAtalho(null);
        } else if (abertaId) setAbertaId(null);
        else if (criarEm) setCriarEm(null);
        else setSelecionada(null);
        return;
      }
      if (k === "c") {
        e.preventDefault();
        return setCriarEm({ status: "A_FAZER", responsavelId: null });
      }
      if (k === "f") {
        e.preventDefault();
        return setMenu({ tipo: "filtro", ancora: refFiltro.current });
      }
      if (k === "d" && !t) {
        e.preventDefault();
        return setMenu({ tipo: "exibicao", ancora: refExibicao.current });
      }
      if (k === "v") return mudarExibicao({ ...exibicao, vista: exibicao.vista === "quadro" ? "lista" : "quadro" });
      if (!t) return;
      if (k === "s") return abrirAtalho(t.id, "status");
      if (k === "p") return abrirAtalho(t.id, "prio");
      if (k === "a") return abrirAtalho(t.id, "resp");
      if (k === "enter" || k === " ") {
        e.preventDefault();
        return setAbertaId(t.id);
      }
      if (/^[1-6]$/.test(k)) return editar(t.id, { status: COLUNAS[Number(k) - 1].status });
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  });

  const grade = { gridTemplateColumns: `repeat(${colunasVisiveis.length}, 17rem)` };
  const mostrarAvatar = agruparPor !== "resp";
  const tarefaAtalho = atalho ? porId.get(atalho.id) : undefined;

  return (
    <>
      <BarraTarefas filtros={filtros} onMudarFiltros={mudarFiltros} exibicao={exibicao} onMudarExibicao={mudarExibicao} pessoas={pessoas} etiquetas={etiquetas} visiveis={visiveis.length} total={tarefas.length} refFiltro={refFiltro} refExibicao={refExibicao} menuAberto={menu} onMenu={setMenu} />
      {erro ? (
        <div className="mb-3 rounded-lg border border-danger/50 bg-surface px-3 py-2">
          <MensagemErro falha={erro} className="text-sm" />
        </div>
      ) : null}
      {criarEm ? (
        <div className="mb-3 max-w-xl">
          <NovaTarefa
            projetoId={projetoId}
            pre={criarEm}
            onFim={(t) => {
              setCriarEm(null);
              if (t) setTarefas((ts) => [...ts, t]);
            }}
            onErro={setErro}
          />
        </div>
      ) : null}
      {tarefas.length === 0 ? (
        <EstadoVazio mascote="cabeca" tamanho="sm" className="mb-4 shrink-0 rounded-xl border border-border bg-surface" titulo="Nenhuma tarefa ainda" texto="Crie a primeira pelo + de uma coluna ou com a tecla C." />
      ) : visiveis.length === 0 ? (
        <EstadoVazio
          mascote="cabeca"
          tamanho="sm"
          className="mb-4 shrink-0 rounded-xl border border-border bg-surface"
          titulo="Nenhuma tarefa com esses filtros"
          acao={
            <Button variant="outline" size="sm" onClick={() => mudarFiltros(FILTROS_VAZIOS)}>
              Limpar filtros
            </Button>
          }
        />
      ) : null}

      <div ref={refQuadro} className="-mx-4 flex min-h-0 flex-1 overflow-auto px-4 pb-2 md:-mx-8 md:px-8">
        {exibicao.vista === "lista" ? (
          <ListaTarefas linhas={linhas} porId={porId} pessoaPorId={pessoaPorId} pessoas={pessoas} exibicao={exibicao} hoje={hoje} selecionada={selecionada} fechados={fechados} onAlternarGrupo={alternarGrupo} onAbrir={setAbertaId} onSelecionar={setSelecionada} onEditar={editar} onNovo={(l) => criarEmGrupo(l)} />
        ) : (
          <DndContext id={`tarefas-${projetoId}`} sensors={sensors} collisionDetection={colisaoQuadro} measuring={{ droppable: { strategy: MeasuringStrategy.Always } }} onDragStart={onDragStart} onDragEnd={onDragEnd} onDragCancel={() => setAtiva(null)}>
            <div className="flex gap-3">
              <FaixaRecolhida coluna={COLUNAS[0]} aberta={colunasVisiveis.some((c) => c.status === "BACKLOG")} total={visiveis.filter((t) => t.status === "BACKLOG").length} onAbrir={() => alternarColuna("BACKLOG")} />
              <div className="flex min-w-0 flex-col">
                <div className="sticky top-0 z-10 grid gap-3 bg-background pb-1" style={grade}>
                  {colunasVisiveis.map((c) => (
                    <CabecalhoColuna key={c.status} coluna={c} total={visiveis.filter((t) => t.status === c.status).length} onRecolher={c.recolhida && !exibicao.recolhidos ? () => alternarColuna(c.status) : undefined} onNovo={() => setCriarEm({ status: c.status, responsavelId: null })} />
                  ))}
                </div>
                {linhas.map((l) => {
                  if (l.tarefas.length === 0 && !exibicao.vazios && agruparPor !== "nenhum") return l.nome ? <LinhaFechada key={l.chave} linha={l} /> : null;
                  const fechada = fechados.has(l.chave);
                  return (
                    <section key={l.chave} aria-label={`${l.nome || "Tarefas"}, ${l.tarefas.length} tarefa(s)`}>
                      {l.nome ? (
                        <button type="button" onClick={() => alternarGrupo(l.chave)} aria-expanded={!fechada} className="mt-2 flex h-9 w-full items-center gap-2 rounded-md px-1 text-left text-sm font-medium text-foreground hover:bg-surface">
                          <ChevronDown className={cn("size-3.5 text-fg-faint transition-transform", fechada && "-rotate-90")} />
                          <MarcaLinha linha={l} />
                          {l.nome}
                          <span className="font-mono text-xs text-fg-faint tabular">{l.tarefas.length}</span>
                        </button>
                      ) : null}
                      {fechada ? null : (
                        <div className="grid gap-3 py-2" style={grade}>
                          {colunasVisiveis.map((c) => (
                            <Celula key={c.status} id={idCelula(c.status, l.chave)} tarefas={l.tarefas.filter((t) => t.status === c.status)} porId={porId} pessoaPorId={pessoaPorId} subtarefasDe={subtarefasDe} exibicao={exibicao} mostrarAvatar={mostrarAvatar} hoje={hoje} selecionada={selecionada} onAbrir={setAbertaId} onSelecionar={setSelecionada} onNovo={() => criarEmGrupo(l, c.status)} />
                          ))}
                        </div>
                      )}
                    </section>
                  );
                })}
              </div>
              <FaixaRecolhida coluna={COLUNAS[5]} aberta={colunasVisiveis.some((c) => c.status === "CANCELADA")} total={visiveis.filter((t) => t.status === "CANCELADA").length} onAbrir={() => alternarColuna("CANCELADA")} />
            </div>
            <DragOverlay>
              {ativa ? (
                <div className="w-[17rem]">
                  <CartaoTarefa tarefa={ativa} pessoa={pessoaPorId.get(ativa.responsavelId ?? "")} subtarefas={subtarefasDe(ativa.id)} mostrarAvatar={mostrarAvatar} props={exibicao.props} dens={exibicao.dens} hoje={hoje} arrastando />
                </div>
              ) : null}
            </DragOverlay>
          </DndContext>
        )}
      </div>

      {atalho && tarefaAtalho ? (
        <MenuOpcoes
          ancora={atalho.ancora}
          titulo={atalho.campo === "status" ? "Mudar status" : atalho.campo === "prio" ? "Prioridade" : "Responsável"}
          busca={atalho.campo === "resp"}
          opcoes={
            atalho.campo === "status"
              ? COLUNAS.map((c, i) => ({ valor: c.status, rotulo: c.nome, icone: <IconeStatus status={c.status} className="size-3.5" />, atalho: String(i + 1) }))
              : atalho.campo === "prio"
                ? PRIORIDADES.map((p) => ({ valor: p.k, rotulo: p.nome, icone: <IconePrioridade prioridade={p.k} className="size-3.5" /> }))
                : [{ valor: "", rotulo: "Sem responsável" }, ...pessoas.filter((p) => p.ativo).map((p) => ({ valor: p.id, rotulo: p.nome, icone: <Avatar nome={p.nome} usuarioId={p.id} fotoEm={p.fotoEm} className="size-4 text-[8px]" /> }))]
          }
          selecionadas={[atalho.campo === "status" ? tarefaAtalho.status : atalho.campo === "prio" ? tarefaAtalho.prioridade : (tarefaAtalho.responsavelId ?? "")]}
          onEscolher={(v) => editar(atalho.id, atalho.campo === "status" ? { status: v as StatusTarefa } : atalho.campo === "prio" ? { prioridade: v as PrioridadeTarefa } : { responsavelId: v || null })}
          onFechar={() => setAtalho(null)}
        />
      ) : null}
      <DetalheTarefa
        projetoId={projetoId}
        tarefa={aberta}
        pessoas={pessoas}
        etiquetasSugeridas={etiquetas}
        onFechar={() => setAbertaId(null)}
        onMudou={aplicar}
        onExcluida={(id) => {
          setAbertaId(null);
          setTarefas((ts) => ts.filter((t) => t.id !== id && t.paiId !== id));
        }}
      />
    </>
  );
}

function MarcaLinha({ linha: l }: { linha: Linha<TarefaLista> }) {
  if (l.cor) return <span aria-hidden className="size-2 rounded-full" style={{ backgroundColor: l.cor }} />;
  if (l.pessoa) return <Avatar nome={l.pessoa.nome} usuarioId={l.pessoa.id} fotoEm={l.pessoa.fotoEm} className="size-5 text-[9px]" />;
  return <span className="size-5 rounded-full border border-dashed border-border-strong" />;
}

/** Linha sem tarefa no filtro atual: já nasce recolhida, só o nome e o zero. */
function LinhaFechada({ linha: l }: { linha: Linha<TarefaLista> }) {
  return (
    <div className="mt-2 flex h-9 items-center gap-2 px-1 text-sm text-fg-mute">
      <ChevronDown className="size-3.5 -rotate-90 text-fg-faint" />
      <MarcaLinha linha={l} />
      {l.nome}
      <span className="font-mono text-xs text-fg-faint">0</span>
    </div>
  );
}

function CabecalhoColuna({ coluna, total, onRecolher, onNovo }: { coluna: Coluna; total: number; onRecolher?: () => void; onNovo: () => void }) {
  return (
    <header className="flex h-9 items-center gap-2 rounded-t-lg bg-muted/60 px-2.5">
      <IconeStatus status={coluna.status} className="size-3.5" />
      <h2 className="min-w-0 flex-1 truncate text-sm font-medium">{coluna.nome}</h2>
      <span className="font-mono text-xs text-fg-faint tabular">{total}</span>
      {onRecolher ? (
        <Button variant="ghost" size="icon-xs" aria-label={`Recolher ${coluna.nome}`} title="Recolher" onClick={onRecolher}>
          <ChevronDown className="rotate-90" />
        </Button>
      ) : null}
      <Button variant="ghost" size="icon-xs" aria-label={`Nova tarefa em ${coluna.nome}`} title="Nova tarefa" onClick={onNovo}>
        <Plus />
      </Button>
    </header>
  );
}

/** Backlog e Cancelada começam recolhidas: uma faixa vertical com a contagem; abrem ao clicar ou soltando um card nela. */
function FaixaRecolhida({ coluna, aberta, total, onAbrir }: { coluna: Coluna; aberta: boolean; total: number; onAbrir: () => void }) {
  const { setNodeRef, isOver } = useDroppable({ id: idCelula(coluna.status, "all"), disabled: aberta });
  if (aberta) return null;
  return (
    <section ref={setNodeRef} aria-label={`${coluna.nome}, recolhida, ${total} tarefa(s)`} className={cn("flex w-9 shrink-0 flex-col rounded-lg border border-dashed border-border", isOver && "border-border-strong bg-surface/40")}>
      <button type="button" onClick={onAbrir} aria-label={`Expandir ${coluna.nome}`} className="flex flex-1 flex-col items-center gap-2 rounded-md pt-2 text-fg-mute outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50">
        <IconeStatus status={coluna.status} className="size-3.5" />
        <span className="font-mono text-xs tabular">{total}</span>
        <span className="text-xs whitespace-nowrap [writing-mode:vertical-rl]">{coluna.nome}</span>
      </button>
    </section>
  );
}

function Celula({
  id,
  tarefas,
  porId,
  pessoaPorId,
  subtarefasDe,
  exibicao,
  mostrarAvatar,
  hoje,
  selecionada,
  onAbrir,
  onSelecionar,
  onNovo,
}: {
  id: string;
  tarefas: TarefaLista[];
  porId: Map<string, TarefaLista>;
  pessoaPorId: Map<string, PessoaTarefa>;
  subtarefasDe: (id: string) => { feitas: number; total: number } | null;
  exibicao: Exibicao;
  mostrarAvatar: boolean;
  hoje: string;
  selecionada: string | null;
  onAbrir: (id: string) => void;
  onSelecionar: (id: string | null) => void;
  onNovo: () => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id });
  return (
    <div ref={setNodeRef} className={cn("group/cel flex min-h-12 flex-col gap-2 rounded-lg p-1 transition-colors", isOver && "bg-primary-soft/20 outline-1 outline-dashed outline-primary/60")}>
      {tarefas.map((t) => (
        <CartaoArrastavel key={t.id} tarefa={t} pai={t.paiId ? (porId.get(t.paiId) ?? null) : null} pessoa={pessoaPorId.get(t.responsavelId ?? "")} subtarefas={subtarefasDe(t.id)} exibicao={exibicao} mostrarAvatar={mostrarAvatar} hoje={hoje} selecionada={selecionada === t.id} onAbrir={() => onAbrir(t.id)} onSelecionar={() => onSelecionar(t.id)} />
      ))}
      <button type="button" onClick={onNovo} className="flex h-7 items-center gap-1 rounded-md px-2 text-xs text-fg-faint opacity-0 transition-opacity group-hover/cel:opacity-100 hover:bg-surface hover:text-foreground focus-visible:opacity-100">
        <Plus className="size-3.5" /> Nova tarefa
      </button>
    </div>
  );
}

function CartaoArrastavel({
  tarefa,
  pai,
  pessoa,
  subtarefas,
  exibicao,
  mostrarAvatar,
  hoje,
  selecionada,
  onAbrir,
  onSelecionar,
}: {
  tarefa: TarefaLista;
  pai: TarefaLista | null;
  pessoa?: PessoaTarefa;
  subtarefas: { feitas: number; total: number } | null;
  exibicao: Exibicao;
  mostrarAvatar: boolean;
  hoje: string;
  selecionada: boolean;
  onAbrir: () => void;
  onSelecionar: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({ id: tarefa.id });
  const alvo = useDroppable({ id: tarefa.id });
  return (
    <div
      ref={(el) => {
        setNodeRef(el);
        alvo.setNodeRef(el);
      }}
      data-id={tarefa.id}
      style={{ transform: DndCSS.Translate.toString(transform) }}
      className={cn("touch-manipulation rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-ring", isDragging && "opacity-40", alvo.isOver && !isDragging && "ring-1 ring-primary/60", selecionada && "ring-1 ring-primary/50")}
      {...attributes}
      aria-roledescription="tarefa arrastável"
      aria-label={`#${tarefa.numero} ${tarefa.titulo}. Pressione espaço para mover, Enter para abrir.`}
      {...listeners}
      onClick={onAbrir}
      onMouseEnter={onSelecionar}
      onKeyDown={(e) => {
        if (e.key === "Enter") onAbrir();
      }}
    >
      <CartaoTarefa tarefa={tarefa} pai={pai} pessoa={pessoa} subtarefas={subtarefas} mostrarAvatar={mostrarAvatar} props={exibicao.props} dens={exibicao.dens} hoje={hoje} />
    </div>
  );
}

/** Criação rápida pelo título (Enter cria, Esc cancela), já com status, responsável, prioridade e etiqueta do lugar onde foi aberta. */
function NovaTarefa({ projetoId, pre, onFim, onErro }: { projetoId: string; pre: Pre; onFim: (t?: TarefaLista) => void; onErro: (f: FalhaUI | null) => void }) {
  const [titulo, setTitulo] = useState("");
  const [pendente, startTransition] = useTransition();
  function enviar(e: React.FormEvent) {
    e.preventDefault();
    const t = titulo.trim();
    if (!t) return onFim();
    startTransition(async () => {
      let r: Awaited<ReturnType<typeof criarTarefaAction>>;
      try {
        r = await criarTarefaAction(projetoId, { titulo: t, ...pre });
      } catch {
        onErro(FALHA_CONEXAO);
        return;
      }
      const falha = falhaDe(r, "criar a tarefa");
      if (falha || !("ok" in r) || r.ok !== true || !r.id) return onErro(falha);
      onErro(null);
      onFim({ id: r.id, numero: r.numero ?? 0, titulo: t, descricao: null, status: pre.status, prioridade: pre.prioridade ?? "SEM_PRIORIDADE", posicao: Number.MAX_SAFE_INTEGER, responsavelId: pre.responsavelId, prazo: null, etiquetas: pre.etiquetas ?? [], paiId: null, concluidaEmMs: null, criadoEmMs: Date.now() });
    });
  }
  return (
    <form onSubmit={enviar} className="flex items-center gap-2 rounded-lg border border-ring/60 bg-background p-1.5 ring-2 ring-ring/25">
      <IconeStatus status={pre.status} className="ml-1 size-4" />
      <Input autoFocus value={titulo} onChange={(e) => setTitulo(e.target.value)} onKeyDown={(e) => e.key === "Escape" && onFim()} onBlur={() => !titulo.trim() && onFim()} placeholder={`Nova tarefa em ${ROTULO_STATUS[pre.status]} (Enter cria)`} aria-label="Título da nova tarefa" maxLength={TITULO_MAX} disabled={pendente} className="h-8 border-0 bg-transparent focus-visible:ring-0" />
    </form>
  );
}
