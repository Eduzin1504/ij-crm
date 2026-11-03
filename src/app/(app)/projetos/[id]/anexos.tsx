"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { FileImage, FileText, Paperclip, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { MensagemErro } from "@/components/erros/mensagem-erro";
import { AcaoConfirmada } from "@/components/lixeira/acao-confirmada";
import type { AnexoDoProjeto } from "@/lib/anexos/anexos";
import { enviarAnexo } from "@/lib/anexos/cliente";
import { ANEXO_MAX_BYTES, EXTENSOES_ACEITAS, formatarTamanho, ROTULO_TIPO_ANEXO } from "@/lib/anexos/tipos";
import type { FalhaUI } from "@/lib/erros/cliente";
import { formatarDataHora } from "@/lib/projetos/formatar";
import { excluirAnexoAction } from "../../_lixeira/actions";

const IMAGEM = new Set(["PNG", "JPEG", "WEBP"]);

async function enviar(cardId: string, arquivo: File): Promise<FalhaUI | null> {
  const r = await enviarAnexo(cardId, arquivo);
  return r.ok ? null : r.falha;
}

/** Bloco "Anexos" do Projeto (GAB-84): lista com download e texto extraído; quem escreve anexa e exclui. */
export function AnexosDoProjeto({ cardId, anexos, somenteLeitura }: { cardId: string; anexos: AnexoDoProjeto[]; somenteLeitura: boolean }) {
  const router = useRouter();
  const campo = useRef<HTMLInputElement>(null);
  const [erro, setErro] = useState<FalhaUI | null>(null);
  const [pendente, startTransition] = useTransition();

  function aoEscolher(e: React.ChangeEvent<HTMLInputElement>) {
    const arquivo = e.target.files?.[0];
    e.target.value = ""; // o mesmo arquivo pode ser escolhido de novo depois de um erro
    if (!arquivo) return;
    setErro(null);
    startTransition(async () => {
      const falha = await enviar(cardId, arquivo);
      setErro(falha);
      if (!falha) router.refresh();
    });
  }

  return (
    <section className="rounded-xl border border-border bg-surface p-4">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="text-sm font-medium">
          Anexos <span className="font-mono text-xs text-fg-mute tabular">{anexos.length}</span>
        </h2>
        {somenteLeitura ? null : (
          <>
            <input ref={campo} type="file" aria-label="Anexar arquivo" accept={EXTENSOES_ACEITAS.join(",")} className="sr-only" onChange={aoEscolher} disabled={pendente} />
            <Button type="button" variant="outline" size="sm" disabled={pendente} onClick={() => campo.current?.click()}>
              <Paperclip aria-hidden /> {pendente ? "Enviando…" : "Anexar arquivo"}
            </Button>
          </>
        )}
      </div>
      {anexos.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border px-3 py-3 text-sm text-fg-mute">
          Nenhum anexo. PDF, Word (.docx), Markdown, texto ou imagem, até {formatarTamanho(ANEXO_MAX_BYTES)}; o texto é extraído para usar na proposta.
        </p>
      ) : (
        <ul className="divide-y divide-border">
          {anexos.map((a) => {
            const Icone = IMAGEM.has(a.tipo) ? FileImage : FileText;
            return (
              <li key={a.id} className="flex items-start gap-3 py-2">
                <Icone className="mt-0.5 size-4 shrink-0 text-fg-mute" aria-hidden />
                <div className="min-w-0 flex-1">
                  <a href={`/api/anexos/${a.id}`} download className="block truncate text-sm text-foreground underline decoration-fg-faint underline-offset-2 hover:decoration-foreground">
                    {a.nome}
                  </a>
                  <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-fg-mute">
                    <span>
                      {ROTULO_TIPO_ANEXO[a.tipo]} · <span className="font-mono tabular">{formatarTamanho(a.tamanho)}</span> · {a.autor.nome} ·{" "}
                      <span className="font-mono tabular">{formatarDataHora(a.criadoEm)}</span>
                    </span>
                    {a.semTexto ? (
                      <span title="Escaneado ou imagem: o texto vai ser lido pelo OCR (ainda não disponível)." className="rounded-full border border-border px-1.5 font-mono text-[10px] leading-4 uppercase">
                        sem texto
                      </span>
                    ) : (
                      <a href={`/api/anexos/${a.id}/texto`} target="_blank" rel="noopener" className="underline decoration-fg-faint underline-offset-2 hover:text-foreground">
                        texto extraído
                      </a>
                    )}
                  </p>
                </div>
                {somenteLeitura ? null : (
                  <AcaoConfirmada
                    rotulo={
                      <>
                        <Trash2 aria-hidden /> Excluir
                      </>
                    }
                    variante="ghost"
                    tamanho="xs"
                    titulo="Excluir o anexo?"
                    descricao={`“${a.nome}” vai para a lixeira. Gestor ou admin podem restaurar.`}
                    confirmar="Excluir"
                    rotuloAcao="excluir o anexo"
                    acao={excluirAnexoAction.bind(null, a.id)}
                  />
                )}
              </li>
            );
          })}
        </ul>
      )}
      <MensagemErro falha={erro} className="mt-2" />
    </section>
  );
}
