import Image from "next/image";
import type { ReactNode } from "react";

export type DadosCapa = { empresa: string; data: string; endereco: string };

/**
 * A folha da proposta no modelo da IJ (GAB-100, spec proposta-folha §4): a capa e a
 * folha contínua com a faixa no topo e a rede no rodapé. Só a moldura: o texto vem
 * do editor ou da leitura. A quebra em páginas A4 é só do PDF ("Ver PDF"): a marca de
 * "fim da página" não aparece porque o cálculo do gerador não vale para a largura da
 * tela, e a folha não pode prometer o que o PDF não entrega.
 */
export function Folha({ capa: dados, children }: { capa: DadosCapa; children: ReactNode }) {
  return (
    <div className="folha-pilha" data-folha>
      <section className="folha folha-capa" aria-label="Capa da proposta">
        <Image src="/images/proposta/capa.webp" alt="" fill sizes="(min-width: 1024px) 700px, 100vw" priority />
        <div className="folha-capa-texto">
          <b>PROPOSTA COMERCIAL</b>
          <b>{dados.empresa}</b>
          <div className="folha-capa-data">{dados.data}</div>
        </div>
        <div className="folha-capa-endereco">{dados.endereco}</div>
      </section>
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
