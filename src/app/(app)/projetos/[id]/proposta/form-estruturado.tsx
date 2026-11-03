"use client";

import { ArrowDown, ArrowUp, CalendarArrowDown, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ENTREGAS_MAX, ESCOPO_RESUMO_MAX, TITULO_ENTREGA_MAX, type FormularioEstruturado } from "@/lib/propostas/estruturado";

export type FormEstruturadoValor = FormularioEstruturado;
type EntregaForm = FormEstruturadoValor["entregas"][number];

const rotulo = "mb-1 block font-mono text-[11px] text-fg-mute uppercase";

/**
 * Parte estruturada da proposta: valor, prazo, escopo resumido e cronograma
 * de entregas (ordenável: setas ou "ordenar por data"). Só ajuda a digitar —
 * quem valida é o servidor (`interpretarEstruturado`), que devolve a mensagem.
 */
export function FormEstruturado({ valor, onChange, desativado }: { valor: FormEstruturadoValor; onChange: (v: FormEstruturadoValor) => void; desativado?: boolean }) {
  const set = <K extends keyof FormEstruturadoValor>(k: K, v: FormEstruturadoValor[K]) => onChange({ ...valor, [k]: v });
  const entregas = valor.entregas;
  const setEntrega = (i: number, patch: Partial<EntregaForm>) => set("entregas", entregas.map((e, j) => (j === i ? { ...e, ...patch } : e)));
  const mover = (i: number, d: -1 | 1) => {
    const n = [...entregas];
    [n[i], n[i + d]] = [n[i + d], n[i]];
    set("entregas", n);
  };
  // datas vazias/inválidas vão para o fim; empate mantém a ordem atual
  const ordenarPorData = () => set("entregas", [...entregas].sort((a, b) => (a.dia || "9999") < (b.dia || "9999") ? -1 : (a.dia || "9999") > (b.dia || "9999") ? 1 : 0));

  return (
    <fieldset disabled={desativado} className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block">
          <span className={rotulo}>Valor total (R$)</span>
          <Input inputMode="decimal" placeholder="12.500,00" value={valor.valor} onChange={(e) => set("valor", e.target.value)} />
        </label>
        <label className="block">
          <span className={rotulo}>Prazo (dias corridos)</span>
          <Input inputMode="numeric" placeholder="60" value={valor.prazoDias} onChange={(e) => set("prazoDias", e.target.value)} />
        </label>
      </div>
      <label className="block">
        <span className={rotulo}>Escopo resumido</span>
        <textarea
          rows={3}
          maxLength={ESCOPO_RESUMO_MAX}
          value={valor.escopoResumo}
          onChange={(e) => set("escopoResumo", e.target.value)}
          className="w-full resize-y rounded-lg border border-input bg-input/30 px-2.5 py-1.5 text-sm text-foreground outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
        />
      </label>

      <div>
        <div className="mb-2 flex items-center gap-2">
          <span className={rotulo + " mb-0"}>Cronograma de entregas</span>
          <span className="flex-1" />
          {entregas.length > 1 ? (
            <Button type="button" variant="ghost" size="xs" onClick={ordenarPorData}>
              <CalendarArrowDown /> Ordenar por data
            </Button>
          ) : null}
        </div>
        {entregas.length === 0 ? <p className="mb-2 text-xs text-fg-faint">Nenhuma entrega ainda.</p> : null}
        <ol className="space-y-2">
          {entregas.map((e, i) => (
            <li key={i} className="grid grid-cols-[1.5rem_minmax(0,1fr)] gap-2 rounded-lg border border-border p-2">
              <span className="pt-1.5 text-center font-mono text-xs text-fg-faint tabular">{i + 1}</span>
              <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_9.5rem_8rem_auto]">
                <Input aria-label={`Entrega ${i + 1}: nome`} placeholder="Entrega" maxLength={TITULO_ENTREGA_MAX} value={e.titulo} onChange={(x) => setEntrega(i, { titulo: x.target.value })} />
                <Input aria-label={`Entrega ${i + 1}: data`} type="date" value={e.dia} onChange={(x) => setEntrega(i, { dia: x.target.value })} />
                <Input aria-label={`Entrega ${i + 1}: valor/parcela`} inputMode="decimal" placeholder="parcela" value={e.valor ?? ""} onChange={(x) => setEntrega(i, { valor: x.target.value })} />
                <div className="flex items-center gap-0.5">
                  <Button type="button" variant="ghost" size="icon-xs" aria-label={`Subir entrega ${i + 1}`} disabled={i === 0} onClick={() => mover(i, -1)}>
                    <ArrowUp />
                  </Button>
                  <Button type="button" variant="ghost" size="icon-xs" aria-label={`Descer entrega ${i + 1}`} disabled={i === entregas.length - 1} onClick={() => mover(i, 1)}>
                    <ArrowDown />
                  </Button>
                  <Button type="button" variant="ghost" size="icon-xs" aria-label={`Remover entrega ${i + 1}`} onClick={() => set("entregas", entregas.filter((_, j) => j !== i))}>
                    <Trash2 />
                  </Button>
                </div>
              </div>
            </li>
          ))}
        </ol>
        {entregas.length < ENTREGAS_MAX ? (
          <Button type="button" variant="outline" size="xs" className="mt-2" onClick={() => set("entregas", [...entregas, { titulo: "", dia: "", valor: "" }])}>
            <Plus /> Adicionar entrega
          </Button>
        ) : null}
      </div>
    </fieldset>
  );
}
