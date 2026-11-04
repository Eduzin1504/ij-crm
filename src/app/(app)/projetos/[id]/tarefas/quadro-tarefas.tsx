"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { StatusTarefa } from "@prisma/client";
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
import { CSS } from "@dnd-kit/utilities";
import { ChevronDown, Plus } from "lucide-react";
import { cn } from "cn";
import { Avatar } from "@/components/avatar";
import { EstadoVazio } from "@/components/estado-vazio";
import { MensagemErro } from "@/components/erros/mensagem-erro";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { executarAcao, falhaDe, FALHA_CONEXAO, type FalhaUI } from "@/lib/erros/cliente";
import { agruparPorResponsavel, COLUNAS, posicaoEntre, SEM_RESPONSAVEL, type Coluna } from "@/lib/tarefas/quadro";
import { TITULO_MAX, type PessoaTarefa, type TarefaLista } from "@/lib/tarefas/modelo";
import { colisaoQuadro } from "../../../kanban/colisao";
import { criarTarefaAction, moverTarefaAction } from "./actions";
import { CartaoTarefa, IconeStatus } from "./cartao-tarefa";
import { DetalheTarefa, type PatchLocal } from "./detalhe-tarefa";

type Props = {
  projetoId: string;
  tarefas: TarefaLista[];
  pessoas: PessoaTarefa[];
  /** `YYYY-MM-DD` de hoje no fuso de negócio (vem do servidor: sem diferença de hidratação). */
  hoje: string;
};

/** Id do alvo de drop: uma célula (status × linha). Soltar sobre um card cai na célula dele. */
const idCelula = (status: StatusTarefa, linha: string) => `cel:${status}:${linha}`;
const lerCelula = (id: string | number | undefined): { status: StatusTarefa; linha: string } | null => {
  const s = String(id ?? "");
  if (!s.startsWith("cel:")) return null;
  const [, status, ...linha] = s.split(":");
  return { status: status as StatusTarefa, linha: linha.join(":") };
};

/**
 * Quadro de tarefas do projeto: colunas por status, uma linha por responsável
 * (padrão da spec §4). Otimista: o estado parte do servidor e é re-sincronizado
 * quando chegam props novas (revalidate após cada action; e ao voltar à aba).
 */
export function QuadroTarefas({ projetoId, tarefas: doServidor, pessoas, hoje }: Props) {
  const [base, setBase] = useState(doServidor);
  const [tarefas, setTarefas] = useState(doServidor);
  if (base !== doServidor) {
    setBase(doServidor);
    setTarefas(doServidor);
  }
  const [ativa, setAtiva] = useState<TarefaLista | null>(null);
  const [abertaId, setAbertaId] = useState<string | null>(null);
  const [abertas, setAbertas] = useState<Set<StatusTarefa>>(() => new Set(COLUNAS.filter((c) => !c.recolhida).map((c) => c.status)));
  const [linhasFechadas, setLinhasFechadas] = useState<Set<string>>(new Set());
  const [erro, setErro] = useState<FalhaUI | null>(null);
  const [, startTransition] = useTransition();
  const router = useRouter();

  // Sem tempo real: atualiza ao voltar para a aba (spec §6).
  useEffect(() => {
    const aoVoltar = () => document.visibilityState === "visible" && router.refresh();
    document.addEventListener("visibilitychange", aoVoltar);
    return () => document.removeEventListener("visibilitychange", aoVoltar);
  }, [router]);

  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 8 } }),
    useSensor(KeyboardSensor),
  );

  const porId = useMemo(() => new Map(tarefas.map((t) => [t.id, t])), [tarefas]);
  const pessoaPorId = useMemo(() => new Map(pessoas.map((p) => [p.id, p])), [pessoas]);
  const linhas = useMemo(() => agruparPorResponsavel(tarefas, pessoas), [tarefas, pessoas]);
  const colunasVisiveis = COLUNAS.filter((c) => abertas.has(c.status));
  const aberta = abertaId ? (porId.get(abertaId) ?? null) : null;

  function aplicar(id: string, patch: PatchLocal) {
    setTarefas((ts) => ts.map((t) => (t.id === id ? { ...t, ...patch } : t)));
  }

  function mover(id: string, status: StatusTarefa, linha: string, antesDeId: string | null) {
    const t = porId.get(id);
    if (!t) return;
    const responsavelId = linha === SEM_RESPONSAVEL ? null : linha;
    const mudaLinha = responsavelId !== t.responsavelId;
    // Vizinhos na célula de destino (sem o próprio card), na ordem do quadro.
    const naCelula = tarefas.filter((x) => x.id !== id && x.status === status && (x.responsavelId ?? SEM_RESPONSAVEL) === linha).sort((a, b) => a.posicao - b.posicao);
    const i = antesDeId ? naCelula.findIndex((x) => x.id === antesDeId) : -1;
    const antes = i === -1 ? (naCelula.at(-1)?.posicao ?? null) : i > 0 ? naCelula[i - 1].posicao : null;
    const depois = i === -1 ? null : naCelula[i].posicao;
    const posicao = posicaoEntre(antes, depois);
    const snapshot = tarefas;
    setErro(null);
    setTarefas((ts) => ts.map((x) => (x.id === id ? { ...x, status, posicao, responsavelId: mudaLinha ? responsavelId : x.responsavelId } : x)));
    startTransition(async () => {
      const falha = await executarAcao(() => moverTarefaAction(projetoId, id, { status, posicao, ...(mudaLinha ? { responsavelId } : {}) }), "mover a tarefa");
      if (falha) {
        setTarefas(snapshot);
        setErro(falha);
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
    // Soltou sobre outro card: entra antes dele, na célula dele.
    const alvo = porId.get(String(over));
    if (alvo && alvo.id !== e.active.id) mover(String(e.active.id), alvo.status, alvo.responsavelId ?? SEM_RESPONSAVEL, alvo.id);
  }

  const alternarColuna = (s: StatusTarefa) =>
    setAbertas((a) => {
      const n = new Set(a);
      if (n.has(s)) n.delete(s);
      else n.add(s);
      return n;
    });
  const alternarLinha = (chave: string) =>
    setLinhasFechadas((f) => {
      const n = new Set(f);
      if (n.has(chave)) n.delete(chave);
      else n.add(chave);
      return n;
    });

  const grade = { gridTemplateColumns: `repeat(${colunasVisiveis.length}, 17rem)` };

  return (
    <>
      {erro ? (
        <div className="mb-3 rounded-lg border border-danger/50 bg-surface px-3 py-2">
          <MensagemErro falha={erro} className="text-sm" />
        </div>
      ) : null}
      {tarefas.length === 0 ? (
        <EstadoVazio mascote="cabeca" tamanho="sm" className="mb-4 shrink-0 rounded-xl border border-border bg-surface" titulo="Nenhuma tarefa ainda" texto="Crie a primeira pelo + de uma coluna." />
      ) : null}
      <DndContext
        id={`tarefas-${projetoId}`}
        sensors={sensors}
        collisionDetection={colisaoQuadro}
        measuring={{ droppable: { strategy: MeasuringStrategy.Always } }}
        onDragStart={onDragStart}
        onDragEnd={onDragEnd}
        onDragCancel={() => setAtiva(null)}
      >
        <div className="-mx-4 flex min-h-0 flex-1 gap-3 overflow-auto px-4 pb-2 md:-mx-8 md:px-8">
          <FaixaRecolhida coluna={COLUNAS[0]} aberta={abertas.has("BACKLOG")} total={tarefas.filter((t) => t.status === "BACKLOG").length} onAbrir={() => alternarColuna("BACKLOG")} />

          <div className="flex min-w-0 flex-col">
            {/* Cabeçalhos das colunas: fixos no topo enquanto as linhas rolam. */}
            <div className="sticky top-0 z-10 grid gap-3 bg-background pb-1" style={grade}>
              {colunasVisiveis.map((c) => (
                <CabecalhoColuna key={c.status} coluna={c} total={tarefas.filter((t) => t.status === c.status).length} onRecolher={c.recolhida ? () => alternarColuna(c.status) : undefined} projetoId={projetoId} />
              ))}
            </div>

            {linhas.map((l) => {
              const fechada = linhasFechadas.has(l.chave);
              return (
                <section key={l.chave} aria-label={`${l.nome}, ${l.tarefas.length} tarefa(s)`}>
                  <button
                    type="button"
                    onClick={() => alternarLinha(l.chave)}
                    aria-expanded={!fechada}
                    className="mt-2 flex h-9 w-full items-center gap-2 rounded-md px-1 text-left text-sm font-medium text-foreground hover:bg-surface"
                  >
                    <ChevronDown className={cn("size-3.5 text-fg-faint transition-transform", fechada && "-rotate-90")} />
                    {l.pessoa ? <Avatar nome={l.pessoa.nome} usuarioId={l.pessoa.id} fotoEm={l.pessoa.fotoEm} className="size-5 text-[9px]" /> : <span className="size-5 rounded-full border border-dashed border-border-strong" />}
                    {l.nome}
                    <span className="font-mono text-xs text-fg-faint tabular">{l.tarefas.length}</span>
                  </button>
                  {fechada ? null : (
                    <div className="grid gap-3 py-2" style={grade}>
                      {colunasVisiveis.map((c) => (
                        <Celula
                          key={c.status}
                          id={idCelula(c.status, l.chave)}
                          projetoId={projetoId}
                          status={c.status}
                          responsavelId={l.chave === SEM_RESPONSAVEL ? null : l.chave}
                          tarefas={l.tarefas.filter((t) => t.status === c.status).sort((a, b) => a.posicao - b.posicao)}
                          porId={porId}
                          pessoaPorId={pessoaPorId}
                          hoje={hoje}
                          onAbrir={setAbertaId}
                          onCriada={(t) => setTarefas((ts) => [...ts, t])}
                          onErro={setErro}
                        />
                      ))}
                    </div>
                  )}
                </section>
              );
            })}
          </div>

          <FaixaRecolhida coluna={COLUNAS[5]} aberta={abertas.has("CANCELADA")} total={tarefas.filter((t) => t.status === "CANCELADA").length} onAbrir={() => alternarColuna("CANCELADA")} />
        </div>
        <DragOverlay>{ativa ? <div className="w-[17rem]"><CartaoTarefa tarefa={ativa} pessoa={pessoaPorId.get(ativa.responsavelId ?? "")} mostrarAvatar={false} hoje={hoje} arrastando /></div> : null}</DragOverlay>
      </DndContext>
      <DetalheTarefa projetoId={projetoId} tarefa={aberta} pessoas={pessoas} onFechar={() => setAbertaId(null)} onMudou={aplicar} onExcluida={(id) => { setAbertaId(null); setTarefas((ts) => ts.filter((t) => t.id !== id && t.paiId !== id)); }} />
    </>
  );
}

function CabecalhoColuna({ coluna, total, onRecolher, projetoId }: { coluna: Coluna; total: number; onRecolher?: () => void; projetoId: string }) {
  const [criando, setCriando] = useState(false);
  return (
    <div className="flex flex-col">
      <header className="flex h-9 items-center gap-2 rounded-t-lg bg-muted/60 px-2.5">
        <IconeStatus status={coluna.status} className="size-3.5" />
        <h2 className="min-w-0 flex-1 truncate text-sm font-medium">{coluna.nome}</h2>
        <span className="font-mono text-xs text-fg-faint tabular">{total}</span>
        {onRecolher ? (
          <Button variant="ghost" size="icon-xs" aria-label={`Recolher ${coluna.nome}`} title="Recolher" onClick={onRecolher}>
            <ChevronDown className="rotate-90" />
          </Button>
        ) : null}
        <Button variant="ghost" size="icon-xs" aria-label={`Nova tarefa em ${coluna.nome}`} title="Nova tarefa" onClick={() => setCriando(true)}>
          <Plus />
        </Button>
      </header>
      {criando ? <NovaTarefa projetoId={projetoId} status={coluna.status} responsavelId={null} onFim={() => setCriando(false)} className="mt-1" /> : null}
    </div>
  );
}

/** Backlog e Cancelada começam recolhidas: uma faixa vertical com a contagem; abrem ao clicar ou soltando um card nela. */
function FaixaRecolhida({ coluna, aberta, total, onAbrir }: { coluna: Coluna; aberta: boolean; total: number; onAbrir: () => void }) {
  const { setNodeRef, isOver } = useDroppable({ id: idCelula(coluna.status, SEM_RESPONSAVEL), disabled: aberta });
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
  projetoId,
  status,
  responsavelId,
  tarefas,
  porId,
  pessoaPorId,
  hoje,
  onAbrir,
  onCriada,
  onErro,
}: {
  id: string;
  projetoId: string;
  status: StatusTarefa;
  responsavelId: string | null;
  tarefas: TarefaLista[];
  porId: Map<string, TarefaLista>;
  pessoaPorId: Map<string, PessoaTarefa>;
  hoje: string;
  onAbrir: (id: string) => void;
  onCriada: (t: TarefaLista) => void;
  onErro: (f: FalhaUI | null) => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id });
  const [criando, setCriando] = useState(false);
  return (
    <div ref={setNodeRef} className={cn("group/cel flex min-h-12 flex-col gap-2 rounded-lg p-1 transition-colors", isOver && "bg-primary-soft/20 outline-1 outline-dashed outline-primary/60")}>
      {tarefas.map((t) => (
        <CartaoArrastavel key={t.id} tarefa={t} pai={t.paiId ? (porId.get(t.paiId) ?? null) : null} pessoa={pessoaPorId.get(t.responsavelId ?? "")} hoje={hoje} onAbrir={() => onAbrir(t.id)} />
      ))}
      {criando ? (
        <NovaTarefa projetoId={projetoId} status={status} responsavelId={responsavelId} onFim={(t) => { setCriando(false); if (t) onCriada(t); }} onErro={onErro} />
      ) : (
        <button type="button" onClick={() => setCriando(true)} className="flex h-7 items-center gap-1 rounded-md px-2 text-xs text-fg-faint opacity-0 transition-opacity group-hover/cel:opacity-100 hover:bg-surface hover:text-foreground focus-visible:opacity-100">
          <Plus className="size-3.5" /> Nova tarefa
        </button>
      )}
    </div>
  );
}

function CartaoArrastavel({ tarefa, pai, pessoa, hoje, onAbrir }: { tarefa: TarefaLista; pai: TarefaLista | null; pessoa?: PessoaTarefa; hoje: string; onAbrir: () => void }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({ id: tarefa.id });
  const alvo = useDroppable({ id: tarefa.id });
  return (
    <div
      ref={(el) => {
        setNodeRef(el);
        alvo.setNodeRef(el);
      }}
      style={{ transform: CSS.Translate.toString(transform) }}
      className={cn("touch-manipulation rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-ring", isDragging && "opacity-40", alvo.isOver && !isDragging && "ring-1 ring-primary/60")}
      {...attributes}
      aria-roledescription="tarefa arrastável"
      aria-label={`#${tarefa.numero} ${tarefa.titulo}. Pressione espaço para mover, Enter para abrir.`}
      {...listeners}
      onClick={onAbrir}
      onKeyDown={(e) => {
        if (e.key === "Enter") onAbrir();
      }}
    >
      <CartaoTarefa tarefa={tarefa} pai={pai} pessoa={pessoa} mostrarAvatar={false} hoje={hoje} />
    </div>
  );
}

/** Criação rápida pelo título (Enter cria, Esc cancela), já com o status e o responsável da célula. */
function NovaTarefa({ projetoId, status, responsavelId, onFim, onErro, className }: { projetoId: string; status: StatusTarefa; responsavelId: string | null; onFim: (t?: TarefaLista) => void; onErro?: (f: FalhaUI | null) => void; className?: string }) {
  const [titulo, setTitulo] = useState("");
  const [pendente, startTransition] = useTransition();
  function enviar(e: React.FormEvent) {
    e.preventDefault();
    const t = titulo.trim();
    if (!t) return onFim();
    startTransition(async () => {
      let r: Awaited<ReturnType<typeof criarTarefaAction>>;
      try {
        r = await criarTarefaAction(projetoId, { titulo: t, status, responsavelId });
      } catch {
        onErro?.(FALHA_CONEXAO);
        return;
      }
      const falha = falhaDe(r, "criar a tarefa");
      if (falha || !("ok" in r) || r.ok !== true || !r.id) return onErro?.(falha);
      onErro?.(null);
      onFim({ id: r.id, numero: r.numero ?? 0, titulo: t, descricao: null, status, prioridade: "SEM_PRIORIDADE", posicao: Number.MAX_SAFE_INTEGER, responsavelId, prazo: null, etiquetas: [], paiId: null, concluidaEmMs: null, criadoEmMs: Date.now() });
    });
  }
  return (
    <form onSubmit={enviar} className={cn("rounded-lg border border-ring/60 bg-background p-1.5 ring-2 ring-ring/25", className)}>
      <Input autoFocus value={titulo} onChange={(e) => setTitulo(e.target.value)} onKeyDown={(e) => e.key === "Escape" && onFim()} onBlur={() => !titulo.trim() && onFim()} placeholder="Título da tarefa (Enter cria)" aria-label="Título da nova tarefa" maxLength={TITULO_MAX} disabled={pendente} className="h-8 border-0 bg-transparent focus-visible:ring-0" />
    </form>
  );
}
