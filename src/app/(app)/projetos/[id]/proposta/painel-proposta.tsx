"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { ControleEditor } from "@/components/propostas/editor-texto";
import { Autosave, type EstadoAutosave, type RespostaGravacao } from "@/lib/propostas/autosave";
import type { Documento } from "@/lib/propostas/documento";
import { mensagemConflito, NOTA_VERSAO_MAX } from "@/lib/propostas/regras";
import type { AcaoCaneta } from "@/lib/propostas/caneta";
import { AcoesCaneta, type PessoaCaneta, type Preparo } from "./acoes-caneta";
import { mesclarSugestao, type CamposSugeridos } from "@/lib/propostas/sugestao";
import { salvarEstruturadoAction, salvarTextoAction, salvarVersaoAction, type ConflitoUI } from "./actions";
import { FormEstruturado, type FormEstruturadoValor } from "./form-estruturado";
import { PreencherDeArquivo, type AnexoBase } from "./preencher-de-arquivo";

// Tiptap só no navegador e só nesta página (fora do bundle do resto do app).
const EditorTexto = dynamic(() => import("@/components/propostas/editor-texto"), {
  ssr: false,
  loading: () => <div className="proposta-texto min-h-72 rounded-lg border border-input px-4 py-3 text-fg-faint">Carregando editor…</div>,
});

const ATRASO_AUTOSAVE_MS = 1200;
const HORA = new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", hour: "2-digit", minute: "2-digit", second: "2-digit" });

/** Resposta da action → forma do Autosave (`INESPERADO` vira texto com a ref do log). */
function paraGravacao(r: Awaited<ReturnType<typeof salvarTextoAction>>): RespostaGravacao {
  if (r.ok === true) return { ok: true, revisao: r.revisao };
  if (r.erro === "INESPERADO") return { ok: false, erro: "Não foi possível salvar. Erro no servidor.", ref: "ref" in r ? r.ref : undefined };
  return { ok: false, erro: r.erro, ...("conflito" in r && r.conflito ? { conflito: r.conflito } : {}) };
}

function Status({ estado, tentar }: { estado: EstadoAutosave; tentar: () => void }) {
  switch (estado.tipo) {
    case "salvo":
      return <span className="text-fg-faint">{estado.em ? `Rascunho salvo às ${HORA.format(estado.em)}` : "Rascunho salvo"}</span>;
    case "pendente":
      return <span className="text-fg-mute">Alterações não salvas…</span>;
    case "salvando":
      return <span className="text-fg-mute">Salvando…</span>;
    case "erro":
      return (
        <span role="alert" className="text-danger">
          {estado.texto}
          {estado.ref ? (
            <>
              {" "}
              <span className="text-fg-soft">
                (ref: <code className="font-mono select-all">{estado.ref}</code>)
              </span>
            </>
          ) : null}{" "}
          <button type="button" onClick={tentar} className="underline underline-offset-2">
            Tentar de novo
          </button>
        </span>
      );
    case "conflito":
      return <span className="text-warn">Conflito de edição — veja abaixo</span>;
  }
}

/**
 * Edição da proposta: texto (autosave), parte estruturada e "Salvar versão".
 * Tudo grava pela mesma fila (`Autosave`) com a revisão atual; conflito com
 * outra aba/pessoa/o MCP nunca sobrescreve sem a pessoa escolher.
 * Só aparece para o dono da caneta (GAB-87), com as ações dela no fim.
 */
export function PainelProposta({
  projetoId,
  revisao,
  documento,
  estruturado,
  ultimaVersao,
  caneta,
  anexos = [],
}: {
  projetoId: string;
  revisao: number;
  documento: Documento;
  estruturado: FormEstruturadoValor;
  ultimaVersao: number | null;
  caneta?: { acoes: AcaoCaneta[]; mesmoLado: PessoaCaneta[]; outroLado: PessoaCaneta[]; rotuloOutroLado: string };
  /** Anexos do Projeto para "Usar arquivo como base" (GAB-90). */
  anexos?: AnexoBase[];
}) {
  const router = useRouter();
  const editor = useRef<ControleEditor>(null);
  const [estado, setEstado] = useState<EstadoAutosave>({ tipo: "salvo", em: null });
  // Props só na montagem: o `router.refresh()` (depois de salvar versão) traz props novas
  // e elas não podem atropelar o que está no editor/formulário.
  const [inicial] = useState(documento);
  const [form, setForm] = useState(estruturado);
  const [formSujo, setFormSujo] = useState(false);
  const [nota, setNota] = useState("");
  const [aviso, setAviso] = useState<string | null>(null);
  const [ocupado, startTransition] = useTransition();
  const [autosave] = useState(
    () =>
      new Autosave<Documento>({
        revisao,
        atrasoMs: ATRASO_AUTOSAVE_MS,
        salvarTexto: async (rev, doc) => paraGravacao(await salvarTextoAction(projetoId, rev, doc)),
        aoMudar: setEstado,
      }),
  );

  // Fechar/recarregar com texto ainda não gravado: o navegador pergunta.
  useEffect(() => {
    const antes = (e: BeforeUnloadEvent) => {
      if (autosave.temPendencia || formSujo) e.preventDefault();
    };
    window.addEventListener("beforeunload", antes);
    return () => window.removeEventListener("beforeunload", antes);
  }, [autosave, formSujo]);

  const conflito = estado.tipo === "conflito" ? (estado.conflito as unknown as ConflitoUI) : null;

  function salvarDados(dados: FormEstruturadoValor = form) {
    setAviso(null);
    startTransition(async () => {
      const r = await autosave.executar(async (rev) => paraGravacao(await salvarEstruturadoAction(projetoId, rev, dados)));
      if (r?.ok) {
        setFormSujo(false);
        setAviso("Dados salvos no rascunho.");
      }
    });
  }

  function salvarVersao() {
    setAviso(null);
    startTransition(async () => {
      let numero: number | undefined;
      const r = await autosave.executar(async (rev) => {
        const resp = await salvarVersaoAction(projetoId, rev, {
          documento: editor.current?.documento(),
          ...(formSujo ? { estruturado: form } : {}),
          nota,
        });
        if (resp.ok === true) numero = resp.numero;
        return paraGravacao(resp);
      }, true);
      if (r?.ok) {
        setNota("");
        setFormSujo(false);
        setAviso(`Versão v${numero} salva.`);
        router.refresh();
      }
    });
  }

  /**
   * Antes de passar/devolver/concordar: grava o texto pendente (a caneta vai sair
   * da mão) e confere que o rascunho está são. Devolver leva o editor e os dados
   * alterados junto (a versão entregue é o que está na tela).
   */
  async function preparar(acao: AcaoCaneta): Promise<Preparo> {
    await autosave.agora();
    const e = autosave.situacao;
    if (e.tipo === "conflito") return { erro: "Resolva o conflito de edição do rascunho antes." };
    if (e.tipo === "erro") return { erro: "O rascunho não foi salvo (veja o aviso no texto). Tente de novo antes." };
    if (acao === "concordar" && formSujo) return { erro: "Há dados da proposta alterados e não salvos: concordar é aceitar sem editar. Descarte-os ou devolva." };
    if (acao !== "devolver") return { revisao: autosave.revisaoAtual };
    return { revisao: autosave.revisaoAtual, documento: editor.current?.documento(), ...(formSujo ? { estruturado: form } : {}) };
  }

  /**
   * GAB-90: a sugestão revisada entra no editor e no formulário e é gravada
   * pelos MESMOS caminhos da edição manual (autosave do texto + "Salvar dados",
   * na mesma fila e com a revisão atual). Dados que a sugestão não preenche
   * ficam como estão.
   */
  function aplicarSugestao(s: { documento: Documento; campos: CamposSugeridos }) {
    editor.current?.substituir(s.documento);
    autosave.alterou(s.documento);
    const dados = mesclarSugestao(form, s.campos);
    setForm(dados);
    setFormSujo(true);
    salvarDados(dados);
  }

  function usarDoServidor(c: ConflitoUI) {
    editor.current?.substituir(c.documento);
    setForm(c.estruturado);
    setFormSujo(false);
    autosave.usarDoServidor(c.revisao);
  }

  /**
   * Mantém o que é MEU por cima da revisão nova. Dados sem alteração local passam a
   * ser os do servidor (senão o formulário velho, já com a revisão nova, desfaria a
   * mudança do outro no próximo "Salvar dados"). Dados alterados aqui: a escolha diz
   * que sobrescreve também, e eles são gravados logo em seguida.
   */
  function manterMeu(c: ConflitoUI) {
    const doc = editor.current?.documento();
    const meusDados = formSujo ? form : null;
    if (!meusDados) setForm(c.estruturado);
    startTransition(async () => {
      if (doc) await autosave.manterMeu(c.revisao, doc);
      if (meusDados) {
        const r = await autosave.executar(async (rev) => paraGravacao(await salvarEstruturadoAction(projetoId, rev, meusDados)));
        if (r?.ok) setFormSujo(false);
      }
    });
  }

  return (
    <div className="space-y-6">
      <PreencherDeArquivo projetoId={projetoId} anexos={anexos} aoAplicar={aplicarSugestao} desativado={ocupado || conflito !== null} />
      <section className="rounded-xl border border-border bg-surface p-4">
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <h2 className="text-sm font-medium">Texto</h2>
          <span className="flex-1" />
          <span className="font-mono text-[11px]" aria-live="polite">
            <Status estado={estado} tentar={() => void autosave.agora()} />
          </span>
        </div>

        {conflito ? (
          <div role="alert" className="mb-3 rounded-lg border border-warn/60 bg-warn-soft p-3 text-sm">
            <p className="text-foreground">{mensagemConflito(conflito)}</p>
            <p className="mt-1 text-xs text-fg-mute">O seu texto continua no editor e não foi gravado. Escolha:</p>
            <div className="mt-2 flex flex-wrap gap-2">
              <Button type="button" size="xs" variant="outline" onClick={() => usarDoServidor(conflito)}>
                Carregar a versão atual (descarta a minha)
              </Button>
              <Button type="button" size="xs" variant="ghost" onClick={() => manterMeu(conflito)}>
                {formSujo ? "Manter os meus (texto e dados) e sobrescrever" : "Manter o meu texto e sobrescrever"}
              </Button>
            </div>
          </div>
        ) : null}

        <EditorTexto inicial={inicial} aoMudar={(d) => autosave.alterou(d)} controle={editor} />
        <p className="mt-2 text-xs text-fg-faint">
          Rascunho salvo sozinho enquanto você escreve (não vira versão). Atalhos: <code className="font-mono"># </code> título,{" "}
          <code className="font-mono">- </code> lista, <code className="font-mono">**negrito**</code>.
        </p>
      </section>

      <section className="rounded-xl border border-border bg-surface p-4">
        <h2 className="mb-4 text-sm font-medium">Dados da proposta</h2>
        <FormEstruturado
          valor={form}
          onChange={(v) => {
            setForm(v);
            setFormSujo(true);
          }}
          desativado={ocupado}
        />
        <div className="mt-4 flex items-center justify-end gap-2">
          {formSujo ? <span className="text-xs text-fg-mute">Dados alterados, não salvos</span> : null}
          <Button type="button" size="sm" variant="outline" disabled={ocupado || !formSujo || conflito !== null} onClick={() => salvarDados()}>
            Salvar dados
          </Button>
        </div>
      </section>

      <section className="rounded-xl border border-border bg-surface p-4">
        <h2 className="mb-1 text-sm font-medium">Salvar versão</h2>
        <p className="mb-3 text-xs text-fg-mute">
          Congela o texto e os dados de agora como {ultimaVersao ? `v${ultimaVersao + 1}` : "v1"} (imutável, vai para a Timeline do projeto).
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <Input aria-label="Nota da versão (opcional)" placeholder="Nota (opcional): o que mudou" maxLength={NOTA_VERSAO_MAX} value={nota} onChange={(e) => setNota(e.target.value)} className="min-w-48 flex-1" />
          <Button type="button" size="sm" disabled={ocupado || conflito !== null} onClick={salvarVersao}>
            Salvar versão
          </Button>
        </div>
        {aviso ? (
          <p role="status" className="mt-2 text-xs text-fg-soft">
            {aviso}
          </p>
        ) : null}
      </section>

      {caneta ? <AcoesCaneta projetoId={projetoId} revisao={revisao} preparar={preparar} aoConcluir={(r) => autosave.adotarRevisao(r)} {...caneta} /> : null}
    </div>
  );
}
