"use client";

import Image from "next/image";
import { useId, useState, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "cn";
import { nomeDaCapa } from "@/lib/pdf/nome-capa";

export type DadosCapa = { empresa: string; data: string; endereco: string };

/** Pontos da A4 → unidade da folha, como `lib/pdf/templates/ij.ts`. */
const pt = (n: number) => `${(n * 100) / 595.28}cqw`;

function Capa({ dados }: { dados: DadosCapa }) {
  const nome = nomeDaCapa(dados.empresa);
  return (
    <section className="folha folha-capa" aria-label="Capa da proposta">
      <Image src="/images/proposta/capa.webp" alt="" fill sizes="(min-width: 1024px) 700px, 100vw" />
      <div className="folha-capa-texto">
        <b>PROPOSTA COMERCIAL</b>
        {/* Mesmas linhas do PDF. */}
        {nome.linhas.map((l, i) => (
          <b key={i} style={{ fontSize: pt(nome.tamanho) }}>
            {l}
          </b>
        ))}
        <div className="folha-capa-data">{dados.data}</div>
      </div>
      <div className="folha-capa-endereco">{dados.endereco}</div>
    </section>
  );
}

/**
 * A folha da proposta no modelo da IJ (GAB-100, spec proposta-folha §4): a capa e a
 * folha contínua com a faixa no topo e a rede no rodapé. Só a moldura: o texto vem
 * do editor ou da leitura. A quebra em páginas A4 é só do PDF ("Ver PDF"): a marca de
 * "fim da página" não aparece porque o cálculo do gerador não vale para a largura da
 * tela, e a folha não pode prometer o que o PDF não entrega.
 *
 * `recolhivel`: na tela de trabalho a capa começa recolhida, para o texto vir logo em
 * seguida. O PDF não muda.
 */
export function Folha({ capa: dados, recolhivel = false, children }: { capa: DadosCapa; recolhivel?: boolean; children: ReactNode }) {
  const [recolhida, setRecolhida] = useState(recolhivel);
  const idCapa = useId();
  return (
    <div className="folha-pilha" data-folha>
      {recolhivel ? (
        <div className="flex min-w-0 items-center gap-3 rounded-[10px] border border-border bg-surface p-2">
          {recolhida ? <Image src="/images/proposta/capa.webp" alt="" width={36} height={51} className="shrink-0 rounded-sm bg-white" /> : null}
          <p className="min-w-0 flex-1 truncate text-xs text-fg-soft">
            {dados.empresa} · {dados.data}
          </p>
          <button
            type="button"
            aria-expanded={!recolhida}
            aria-controls={idCapa}
            onClick={() => setRecolhida((r) => !r)}
            className="inline-flex shrink-0 items-center gap-1 rounded-md border border-border px-2 py-1 text-xs hover:bg-surface-hover"
          >
            Capa <ChevronDown aria-hidden className={cn("size-3.5 transition-transform", !recolhida && "rotate-180")} />
          </button>
        </div>
      ) : null}
      <div id={idCapa} hidden={recolhida}>
        {recolhida ? null : <Capa dados={dados} />}
      </div>
      <section className="folha folha-corpo" aria-label="Texto da proposta">
        <Image src="/images/proposta/faixa.webp" alt="" width={1132} height={155} className="block h-auto w-full" />
        <div className="folha-miolo">
          <h2 className="folha-titulo">Proposta Comercial de Projeto</h2>
          {children}
        </div>
        <Image src="/images/proposta/rodape.webp" alt="" width={1128} height={147} className="mt-auto block h-auto w-full" />
      </section>
    </div>
  );
}
