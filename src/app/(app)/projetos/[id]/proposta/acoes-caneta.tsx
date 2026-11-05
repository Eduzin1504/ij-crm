"use client";

import { useId, useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { MensagemErro } from "@/components/erros/mensagem-erro";
import { executarAcao, type FalhaUI } from "@/lib/erros/cliente";
import { MOTIVOS_PERDA } from "@/lib/projetos/terminal-regras";
import { MOTIVO_INVIAVEL_MAX, type AcaoCaneta } from "@/lib/propostas/caneta";
import { PEDIDO_REVISAO_MAX, ROTULO_RESPOSTA, RESPOSTAS_CLIENTE, type AcaoEnvio, type RespostaCliente } from "@/lib/propostas/envio";
import { NOTA_VERSAO_MAX } from "@/lib/propostas/regras";
import {
  concluirRevisaoAction,
  concordarAction,
  devolverAction,
  marcarEnviadaAction,
  marcarInviavelAction,
  passarCanetaAction,
  pegarCanetaAction,
  reabrirAction,
  registrarRespostaAction,
} from "./actions";

export type PessoaCaneta = { id: string; nome: string };

/** O que o editor manda junto (revisão atual, texto, dados alterados) — ou por que não dá agora. */
export type Preparo = { revisao: number; documento?: unknown; estruturado?: unknown } | { erro: string };

/** Ações da caneta (GAB-87) e do envio ao cliente (GAB-89) num painel só. */
export type AcaoTela = AcaoCaneta | AcaoEnvio;

const ROTULO: Record<AcaoTela, string> = {
  enviar: "Marcar como enviada",
  responder: "Registrar resposta do cliente",
  concluirRevisao: "Concluir revisão",
  passar: "Passar a caneta",
  devolver: "Devolver",
  concordar: "Concordar",
  pegar: "Pegar a caneta",
  reabrir: "Reabrir para ajuste",
  inviavel: "Marcar inviável",
};

const VERBO: Record<AcaoTela, string> = {
  enviar: "marcar como enviada",
  responder: "registrar a resposta do cliente",
  concluirRevisao: "concluir a revisão",
  passar: "passar a caneta",
  devolver: "devolver a proposta",
  concordar: "concordar",
  pegar: "pegar a caneta",
  reabrir: "reabrir a proposta",
  inviavel: "marcar como inviável",
};

const CLASSE_SELECT =
  "h-8 w-full min-w-0 flex-1 rounded-lg border border-input bg-input/30 px-2.5 text-sm text-foreground outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";

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
  envio = [],
  versaoPdf = null,
  secundarias,
}: {
  projetoId: string;
  acoes: readonly AcaoCaneta[];
  /** GAB-89: o que a pessoa pode fazer no envio (`acoesDeEnvio`). */
  envio?: readonly AcaoEnvio[];
  /** Versão final (a do PDF): marcar enviada confirma que é ela. */
  versaoPdf?: number | null;
  mesmoLado: readonly PessoaCaneta[];
  outroLado: readonly PessoaCaneta[];
  rotuloOutroLado: string;
  revisao: number;
  preparar?: (acao: AcaoTela) => Promise<Preparo>;
  /** Revisão nova devolvida pelo servidor (o editor adota antes do refresh). */
  aoConcluir?: (revisao: number) => void;
  /** GAB-100: logo abaixo da ação principal ("Salvar versão", "Ver PDF"). */
  secundarias?: ReactNode;
}) {
  const router = useRouter();
  const base = useId();
  const [aberta, setAberta] = useState<AcaoTela | null>(null);
  const [resposta, setResposta] = useState<RespostaCliente | "">("");
  const [motivoPerda, setMotivoPerda] = useState("");
  const [detalhe, setDetalhe] = useState("");
  const [pedido, setPedido] = useState("");
  const [paraId, setParaId] = useState("");
  const [nota, setNota] = useState("");
  const [motivo, setMotivo] = useState("");
  const [falha, setFalha] = useState<FalhaUI | null>(null);
  const [pendente, startTransition] = useTransition();

  const lista: AcaoTela[] = [...envio, ...acoes];
  if (lista.length === 0 && !secundarias) return null;
  // Coral só na ação principal (§4.5.1): a do envio, se houver; senão "Passar a caneta" (spec proposta-folha §3).
  const principal: AcaoTela | undefined = envio[0] ?? (acoes.includes("passar") ? "passar" : lista[0]);
  const demais = lista.filter((a) => a !== principal);

  function abrir(a: AcaoTela) {
    setFalha(null);
    setParaId("");
    setAberta(aberta === a ? null : a);
  }

  function confirmar(a: AcaoTela) {
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
          case "enviar":
            return marcarEnviadaAction(projetoId, versaoPdf ?? 0);
          case "responder":
            return registrarRespostaAction(projetoId, { resposta, motivo: motivoPerda || undefined, detalhe: detalhe || undefined, pedido: pedido || undefined });
          case "concluirRevisao":
            return concluirRevisaoAction(projetoId, p.revisao, { documento: p.documento, estruturado: p.estruturado, nota });
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
        setResposta("");
        setMotivoPerda("");
        setDetalhe("");
        setPedido("");
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

  const botao = (a: AcaoTela, destaque: boolean) => (
    <Button key={a} type="button" size="sm" className="w-full" variant={destaque ? "default" : a === "inviavel" ? "destructive" : "outline"} aria-expanded={aberta === a} disabled={pendente} onClick={() => abrir(a)}>
      {ROTULO[a]}
    </Button>
  );

  return (
    <section className="space-y-2 rounded-xl border border-border bg-surface p-3" aria-label="Caneta">
      {principal ? botao(principal, true) : null}
      {secundarias}
      {demais.length ? <div className="grid grid-cols-1 gap-1.5">{demais.map((a) => botao(a, false))}</div> : null}
      {lista.length === 0 ? null : <p className="text-xs text-fg-mute">
        {envio.includes("concluirRevisao")
          ? "O cliente pediu revisão. Mudou só o texto? Conclua a revisão e reenvie. Mudou valor, prazo, escopo ou entregas? Devolva para projetos avaliar."
          : envio.includes("responder")
            ? "A proposta está com o cliente. Registre a resposta quando ela vier."
            : envio.includes("enviar")
              ? "Pronta para envio: baixe o PDF, mande ao cliente pelo canal que quiser e marque como enviada."
              : acoes.includes("devolver")
                ? `Terminou? Devolva para ${rotuloOutroLado.toLowerCase()} avaliar (salva uma versão) ou, se a última versão veio de lá e está boa, concorde.`
                : "O que você pode fazer na proposta agora:"}
      </p>}
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
            <Input aria-label="Nota da versão (opcional)" placeholder="Nota (opcional): o que mudou" maxLength={NOTA_VERSAO_MAX} value={nota} disabled={pendente} onChange={(e) => setNota(e.target.value)} className="min-w-0 flex-1 basis-full" />
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

      {aberta === "enviar" ? (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <p className="flex-1 text-xs text-fg-soft">
            Confirma que a versão {versaoPdf ? `v${versaoPdf}` : "final"} (a do PDF) foi enviada ao cliente? O CRM não manda nada: só registra. Depois, registre a resposta.
          </p>
          <Button type="button" size="sm" disabled={pendente || !versaoPdf} onClick={() => confirmar("enviar")}>
            Confirmar envio
          </Button>
        </div>
      ) : null}

      {aberta === "concluirRevisao" ? (
        <div className="mt-3 space-y-2">
          <p className="text-xs text-fg-soft">
            Salva uma versão com o que está no editor e a proposta volta a Pronta para envio, sem passar por projetos — só se valor, prazo, escopo e entregas são os mesmos da versão enviada.
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <Input aria-label="Nota da versão (opcional)" placeholder="Nota (opcional): o que mudou" maxLength={NOTA_VERSAO_MAX} value={nota} disabled={pendente} onChange={(e) => setNota(e.target.value)} className="min-w-0 flex-1 basis-full" />
            <Button type="button" size="sm" disabled={pendente} onClick={() => confirmar("concluirRevisao")}>
              Concluir revisão
            </Button>
          </div>
        </div>
      ) : null}

      {aberta === "responder" ? (
        <div className="mt-3 space-y-2">
          <fieldset className="flex flex-wrap gap-x-4 gap-y-1 text-sm" disabled={pendente}>
            <legend className="mb-1 text-xs text-fg-soft">O que o cliente respondeu?</legend>
            {RESPOSTAS_CLIENTE.map((r) => (
              <label key={r} className="inline-flex items-center gap-1.5">
                <input type="radio" name={`${base}-resposta`} value={r} checked={resposta === r} onChange={() => setResposta(r)} />
                {ROTULO_RESPOSTA[r]}
              </label>
            ))}
          </fieldset>
          {resposta === "ACEITA" ? <p className="text-xs text-fg-soft">O projeto vai para Montando contrato.</p> : null}
          {resposta === "RECUSADA" ? (
            <div className="space-y-2">
              <p className="text-xs text-fg-soft">O projeto vai para Perdido com este motivo.</p>
              <select aria-label="Motivo da recusa" value={motivoPerda} disabled={pendente} onChange={(e) => setMotivoPerda(e.target.value)} className={CLASSE_SELECT}>
                <option value="">Motivo…</option>
                {MOTIVOS_PERDA.map((m) => (
                  <option key={m.chave} value={m.chave}>
                    {m.rotulo}
                  </option>
                ))}
              </select>
              <Input aria-label="Detalhe do motivo" placeholder={motivoPerda === "outro" ? "Detalhe (obrigatório)" : "Detalhe (opcional)"} maxLength={500} value={detalhe} disabled={pendente} onChange={(e) => setDetalhe(e.target.value)} />
            </div>
          ) : null}
          {resposta === "REVISAO_PEDIDA" ? (
            <div className="space-y-1">
              <p className="text-xs text-fg-soft">A caneta volta para você. Mudou valor, prazo, escopo ou entregas? A proposta passa por projetos de novo.</p>
              <textarea
                aria-label="O que o cliente pediu (opcional)"
                placeholder="O que o cliente pediu (opcional)"
                value={pedido}
                onChange={(e) => setPedido(e.target.value)}
                rows={2}
                maxLength={PEDIDO_REVISAO_MAX}
                disabled={pendente}
                className="w-full resize-y rounded-lg border border-input bg-transparent px-2.5 py-1.5 text-sm outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-50 dark:bg-input/30"
              />
            </div>
          ) : null}
          <div className="flex justify-end">
            <Button
              type="button"
              size="sm"
              variant={resposta === "RECUSADA" ? "destructive" : "default"}
              disabled={pendente || !resposta || (resposta === "RECUSADA" && (!motivoPerda || (motivoPerda === "outro" && !detalhe.trim())))}
              onClick={() => confirmar("responder")}
            >
              Registrar resposta
            </Button>
          </div>
        </div>
      ) : null}

      <MensagemErro falha={falha} className="mt-2" />
    </section>
  );
}
