"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { FileUp, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { MensagemErro } from "@/components/erros/mensagem-erro";
import { DocumentoView } from "@/components/propostas/documento-view";
import { enviarAnexo } from "@/lib/anexos/cliente";
import { EXTENSOES_ACEITAS, ROTULO_TIPO_ANEXO } from "@/lib/anexos/tipos";
import { FALHA_CONEXAO, type FalhaUI } from "@/lib/erros/cliente";
import type { Documento } from "@/lib/propostas/documento";
import { ROTULO_CAMPO_SUGESTAO, type CamposSugeridos, type ItemRevisar } from "@/lib/propostas/sugestao";
import { sugerirDeAnexoAction, type RespostaSugestao, type SugestaoUI } from "./preencher-actions";

export type AnexoBase = { id: string; nome: string; tipo: keyof typeof ROTULO_TIPO_ANEXO; semTexto: boolean };

const rotulo = "font-mono text-[11px] text-fg-mute uppercase";

function falhaDaResposta(r: RespostaSugestao): FalhaUI | null {
  if (r.ok === true) return null;
  if (r.erro === "INESPERADO") return { texto: "Não foi possível ler o arquivo. Erro no servidor. O rascunho não foi alterado.", ref: r.ref };
  return { texto: r.erro, ref: "ref" in r ? r.ref : undefined };
}

function ListaRevisar({ itens }: { itens: ItemRevisar[] }) {
  if (itens.length === 0) return null;
  return (
    <div className="rounded-lg border border-warn/60 bg-warn-soft p-3 text-xs">
      <p className="mb-1 font-medium text-foreground">Para revisar (não preenchido — confira no arquivo)</p>
      <ul className="space-y-1 text-fg-soft">
        {itens.map((i, k) => (
          <li key={k}>
            <strong className="text-foreground">{ROTULO_CAMPO_SUGESTAO[i.campo]}</strong>: {i.motivo}
            {i.lido ? (
              <>
                {" "}
                · lido: <code className="font-mono">{i.lido}</code>
              </>
            ) : null}
            {i.trecho ? <span className="text-fg-mute"> · “{i.trecho}”</span> : null}
          </li>
        ))}
      </ul>
    </div>
  );
}

function Campos({ c }: { c: CamposSugeridos }) {
  const linhas: [string, string | null][] = [
    [ROTULO_CAMPO_SUGESTAO.valor, c.valor ? `R$ ${c.valor}` : null],
    [ROTULO_CAMPO_SUGESTAO.prazoDias, c.prazoDias],
    [ROTULO_CAMPO_SUGESTAO.escopoResumo, c.escopoResumo],
    [ROTULO_CAMPO_SUGESTAO.entregas, c.entregas ? c.entregas.map((e) => `${e.titulo} (${e.dia}${e.valor ? `, R$ ${e.valor}` : ""})`).join("; ") : null],
  ];
  return (
    <dl className="grid gap-x-4 gap-y-1 text-sm sm:grid-cols-[10rem_1fr]">
      {linhas.map(([k, v]) => (
        <div key={k} className="contents">
          <dt className={rotulo}>{k}</dt>
          <dd className={v ? "text-foreground" : "text-fg-faint"}>{v ?? "— (fica como está)"}</dd>
        </div>
      ))}
    </dl>
  );
}

/**
 * "Usar arquivo como base" (GAB-90): escolhe um anexo do Projeto (ou envia um
 * novo, que vira anexo), a IA lê e devolve uma SUGESTÃO para revisar. Nada é
 * gravado até "Aplicar ao rascunho", que entrega texto e dados ao editor
 * (`aoAplicar`), e o editor grava pelo caminho de sempre.
 */
export function PreencherDeArquivo({
  projetoId,
  anexos,
  aoAplicar,
  desativado,
}: {
  projetoId: string;
  anexos: AnexoBase[];
  aoAplicar: (s: { documento: Documento; campos: CamposSugeridos }) => void;
  desativado?: boolean;
}) {
  const router = useRouter();
  const arquivo = useRef<HTMLInputElement>(null);
  const [aberto, setAberto] = useState(false);
  const [escolhido, setEscolhido] = useState(anexos[0]?.id ?? "");
  const [sugestao, setSugestao] = useState<SugestaoUI | null>(null);
  const [aplicada, setAplicada] = useState<ItemRevisar[] | null>(null);
  const [erro, setErro] = useState<FalhaUI | null>(null);
  const [etapa, setEtapa] = useState<string | null>(null);
  const [, startTransition] = useTransition();
  const ocupado = etapa !== null;

  function ler(anexoId: string) {
    setErro(null);
    setSugestao(null);
    setAplicada(null);
    setEtapa("Lendo o arquivo… (escaneado ou imagem pode levar até 2 minutos)");
    startTransition(async () => {
      try {
        const r = await sugerirDeAnexoAction(projetoId, anexoId);
        const f = falhaDaResposta(r);
        setErro(f);
        if (r.ok === true) setSugestao(r.sugestao);
      } catch {
        setErro(FALHA_CONEXAO);
      } finally {
        setEtapa(null);
      }
    });
  }

  function aoEscolherArquivo(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (!f) return;
    setErro(null);
    setEtapa("Enviando o arquivo…");
    startTransition(async () => {
      const r = await enviarAnexo(projetoId, f);
      if (!r.ok) {
        setErro(r.falha);
        setEtapa(null);
        return;
      }
      setEscolhido(r.anexo.id);
      router.refresh(); // o anexo novo aparece na lista (e no Projeto)
      ler(r.anexo.id);
    });
  }

  function aplicar() {
    if (!sugestao) return;
    aoAplicar({ documento: sugestao.documento, campos: sugestao.campos });
    setAplicada(sugestao.revisar);
    setSugestao(null);
  }

  if (!aberto) {
    return (
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" size="sm" variant="outline" disabled={desativado} onClick={() => setAberto(true)}>
          <Sparkles className="size-3.5" /> Usar arquivo como base
        </Button>
        {aplicada ? <span className="text-xs text-fg-mute">Arquivo aplicado ao rascunho: revise o texto e os dados.</span> : null}
        {aplicada ? <ListaRevisar itens={aplicada} /> : null}
      </div>
    );
  }

  return (
    <section className="rounded-xl border border-border bg-surface p-4" aria-label="Usar arquivo como base">
      <div className="mb-3 flex items-center gap-2">
        <h2 className="text-sm font-medium">Usar arquivo como base</h2>
        <span className="flex-1" />
        <Button type="button" size="xs" variant="ghost" disabled={ocupado} onClick={() => setAberto(false)}>
          Fechar
        </Button>
      </div>
      <p className="mb-3 text-xs text-fg-mute">
        A IA lê o arquivo e sugere o texto e os dados (valor, prazo, escopo, entregas). Nada muda até você aplicar; o que o arquivo não deixa claro fica em branco para você conferir.
      </p>

      <div className="flex flex-wrap items-center gap-2">
        {anexos.length > 0 ? (
          <>
            <select
              aria-label="Anexo do projeto"
              className="h-8 min-w-48 flex-1 rounded-md border border-input bg-transparent px-2 text-sm"
              value={escolhido}
              disabled={ocupado || desativado}
              onChange={(e) => setEscolhido(e.target.value)}
            >
              {anexos.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.nome} · {ROTULO_TIPO_ANEXO[a.tipo]}
                  {a.semTexto ? " (escaneado: lido pela IA)" : ""}
                </option>
              ))}
            </select>
            <Button type="button" size="sm" disabled={ocupado || desativado || !escolhido} onClick={() => ler(escolhido)}>
              Ler arquivo
            </Button>
          </>
        ) : (
          <span className="text-xs text-fg-mute">Este projeto ainda não tem anexos.</span>
        )}
        <input ref={arquivo} type="file" className="hidden" aria-label="Enviar arquivo para usar como base" accept={EXTENSOES_ACEITAS.join(",")} onChange={aoEscolherArquivo} />
        <Button type="button" size="sm" variant="outline" disabled={ocupado || desativado} onClick={() => arquivo.current?.click()}>
          <FileUp className="size-3.5" /> Enviar arquivo
        </Button>
      </div>

      {etapa ? (
        <p role="status" className="mt-3 text-xs text-fg-mute">
          {etapa}
        </p>
      ) : null}
      <MensagemErro falha={erro} className="mt-3" />

      {sugestao ? (
        <div className="mt-4 space-y-4">
          <p className="text-xs text-fg-mute">
            Sugestão a partir de <strong className="text-foreground">{sugestao.anexo.nome}</strong> ({sugestao.origem === "arquivo" ? "lido pela IA" : "texto do arquivo; dados preenchidos pela IA"}).
          </p>
          <div>
            <p className={`${rotulo} mb-1`}>Dados que serão preenchidos</p>
            <Campos c={sugestao.campos} />
          </div>
          <ListaRevisar itens={sugestao.revisar} />
          <div>
            <p className={`${rotulo} mb-1`}>Texto</p>
            <div className="max-h-80 overflow-y-auto rounded-lg border border-input px-4 py-3">
              <DocumentoView documento={sugestao.documento} />
            </div>
          </div>
          <p className="text-xs text-warn">Aplicar substitui o texto atual do rascunho (salve uma versão antes se quiser guardar o atual). Dados em branco acima ficam como estão.</p>
          <div className="flex flex-wrap justify-end gap-2">
            <Button type="button" size="sm" variant="ghost" onClick={() => setSugestao(null)}>
              Descartar
            </Button>
            <Button
              type="button"
              size="sm"
              disabled={desativado}
              onClick={() => {
                aplicar();
                setAberto(false);
              }}
            >
              Aplicar ao rascunho
            </Button>
          </div>
        </div>
      ) : null}
    </section>
  );
}
