"use client";

import { useId, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { MensagemErro } from "@/components/erros/mensagem-erro";
import { executarAcao, type FalhaUI } from "@/lib/erros/cliente";
import { MOTIVO_INVIAVEL_MAX, type AcaoCaneta } from "@/lib/propostas/caneta";
import { NOTA_VERSAO_MAX } from "@/lib/propostas/regras";
import { concordarAction, devolverAction, marcarInviavelAction, passarCanetaAction, pegarCanetaAction, reabrirAction } from "./actions";

export type PessoaCaneta = { id: string; nome: string };

/** O que o editor manda junto (revisão atual, texto, dados alterados) — ou por que não dá agora. */
export type Preparo = { revisao: number; documento?: unknown; estruturado?: unknown } | { erro: string };

const ROTULO: Record<AcaoCaneta, string> = {
  passar: "Passar a caneta",
  devolver: "Devolver",
  concordar: "Concordar",
  pegar: "Pegar a caneta",
  reabrir: "Reabrir para ajuste",
  inviavel: "Marcar inviável",
};

const VERBO: Record<AcaoCaneta, string> = {
  passar: "passar a caneta",
  devolver: "devolver a proposta",
  concordar: "concordar",
  pegar: "pegar a caneta",
  reabrir: "reabrir a proposta",
  inviavel: "marcar como inviável",
};

const CLASSE_SELECT =
  "h-8 min-w-48 flex-1 rounded-lg border border-input bg-input/30 px-2.5 text-sm text-foreground outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";

/**
 * Botões da caneta (GAB-87): só aparecem as ações que o servidor diz que a
 * pessoa pode fazer agora (`acoesPossiveis`); o servidor confere de novo.
 * Dentro do editor, `preparar` grava o pendente antes e manda o texto junto
 * (devolver salva a versão do que está no editor).
 */
export function AcoesCaneta({
  projetoId,
  acoes,
  mesmoLado,
  outroLado,
  rotuloOutroLado,
  revisao,
  preparar,
  aoConcluir,
}: {
  projetoId: string;
  acoes: readonly AcaoCaneta[];
  mesmoLado: readonly PessoaCaneta[];
  outroLado: readonly PessoaCaneta[];
  rotuloOutroLado: string;
  revisao: number;
  preparar?: (acao: AcaoCaneta) => Promise<Preparo>;
  /** Revisão nova devolvida pelo servidor (o editor adota antes do refresh). */
  aoConcluir?: (revisao: number) => void;
}) {
  const router = useRouter();
  const base = useId();
  const [aberta, setAberta] = useState<AcaoCaneta | null>(null);
  const [paraId, setParaId] = useState("");
  const [nota, setNota] = useState("");
  const [motivo, setMotivo] = useState("");
  const [falha, setFalha] = useState<FalhaUI | null>(null);
  const [pendente, startTransition] = useTransition();

  if (acoes.length === 0) return null;

  function abrir(a: AcaoCaneta) {
    setFalha(null);
    setParaId("");
    setAberta(aberta === a ? null : a);
  }

  function confirmar(a: AcaoCaneta) {
    setFalha(null);
    startTransition(async () => {
      const p: Preparo = preparar ? await preparar(a) : { revisao };
      if ("erro" in p) {
        setFalha({ texto: p.erro });
        return;
      }
      const chamar = () => {
        switch (a) {
          case "passar":
            return passarCanetaAction(projetoId, paraId);
          case "devolver":
            return devolverAction(projetoId, p.revisao, { paraId, documento: p.documento, estruturado: p.estruturado, nota });
          case "concordar":
            return concordarAction(projetoId, p.revisao);
          case "pegar":
            return pegarCanetaAction(projetoId);
          case "reabrir":
            return reabrirAction(projetoId);
          case "inviavel":
            return marcarInviavelAction(projetoId, motivo);
        }
      };
      let revisaoNova: number | undefined;
      const f = await executarAcao(async () => {
        const r = await chamar();
        if (r.ok === true) revisaoNova = r.revisao;
        return r;
      }, VERBO[a]);
      setFalha(f);
      if (!f) {
        if (revisaoNova !== undefined) aoConcluir?.(revisaoNova);
        setAberta(null);
        setNota("");
        setMotivo("");
        router.refresh();
      }
    });
  }

  const seletor = (pessoas: readonly PessoaCaneta[], rotulo: string) => (
    <select id={`${base}-para`} aria-label={rotulo} value={paraId} disabled={pendente} onChange={(e) => setParaId(e.target.value)} className={CLASSE_SELECT}>
      <option value="">{pessoas.length ? `${rotulo}…` : "ninguém disponível"}</option>
      {pessoas.map((p) => (
        <option key={p.id} value={p.id}>
          {p.nome}
        </option>
      ))}
    </select>
  );

  return (
    <section className="rounded-xl border border-border bg-surface p-4" aria-label="Caneta">
      <h2 className="mb-1 text-sm font-medium">Caneta</h2>
      <p className="mb-3 text-xs text-fg-mute">
        {acoes.includes("devolver")
          ? `Terminou? Devolva para ${rotuloOutroLado.toLowerCase()} avaliar (salva uma versão) ou, se a última versão veio de lá e está boa, concorde.`
          : "O que você pode fazer na proposta agora:"}
      </p>
      <div className="flex flex-wrap gap-2">
        {acoes.map((a) => (
          <Button
            key={a}
            type="button"
            size="sm"
            variant={a === "devolver" || a === "concordar" ? "default" : a === "inviavel" ? "destructive" : "outline"}
            aria-expanded={aberta === a}
            disabled={pendente}
            onClick={() => abrir(a)}
          >
            {ROTULO[a]}
          </Button>
        ))}
      </div>

      {aberta === "passar" ? (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {seletor(mesmoLado, "Passar para")}
          <Button type="button" size="sm" disabled={pendente || !paraId} onClick={() => confirmar("passar")}>
            Passar
          </Button>
        </div>
      ) : null}

      {aberta === "devolver" ? (
        <div className="mt-3 space-y-2">
          <div className="flex flex-wrap items-center gap-2">{seletor(outroLado, `Devolver para (${rotuloOutroLado.toLowerCase()})`)}</div>
          <div className="flex flex-wrap items-center gap-2">
            <Input aria-label="Nota da versão (opcional)" placeholder="Nota (opcional): o que mudou" maxLength={NOTA_VERSAO_MAX} value={nota} disabled={pendente} onChange={(e) => setNota(e.target.value)} className="min-w-48 flex-1" />
            <Button type="button" size="sm" disabled={pendente || !paraId} onClick={() => confirmar("devolver")}>
              Salvar versão e devolver
            </Button>
          </div>
        </div>
      ) : null}

      {aberta === "concordar" || aberta === "pegar" || aberta === "reabrir" ? (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <p className="flex-1 text-xs text-fg-soft">
            {aberta === "concordar"
              ? "Concordar aceita a última versão do outro lado sem editar: a proposta fica pronta para envio."
              : aberta === "pegar"
                ? "Você é GP deste lado: a caneta passa para você (fica na Timeline)."
                : "A proposta volta para ajuste com você; depois de mudar, ela passa por projetos de novo."}
          </p>
          <Button type="button" size="sm" disabled={pendente} onClick={() => confirmar(aberta)}>
            Confirmar
          </Button>
        </div>
      ) : null}

      {aberta === "inviavel" ? (
        <div className="mt-3 space-y-2">
          <label htmlFor={`${base}-motivo`} className="text-xs text-fg-soft">
            Motivo (obrigatório). O projeto vai para Perdido no quadro de Vendas.
          </label>
          <textarea
            id={`${base}-motivo`}
            value={motivo}
            onChange={(e) => setMotivo(e.target.value)}
            rows={2}
            maxLength={MOTIVO_INVIAVEL_MAX}
            disabled={pendente}
            className="w-full resize-y rounded-lg border border-input bg-transparent px-2.5 py-1.5 text-sm outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-50 dark:bg-input/30"
          />
          <div className="flex justify-end">
            <Button type="button" size="sm" variant="destructive" disabled={pendente || !motivo.trim()} onClick={() => confirmar("inviavel")}>
              Marcar inviável
            </Button>
          </div>
        </div>
      ) : null}

      <MensagemErro falha={falha} className="mt-2" />
    </section>
  );
}
