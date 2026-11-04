"use client";

import { createContext, useContext, type ReactNode } from "react";
import { cn } from "cn";
import type { Ancora } from "@/lib/propostas/ancora";
import { linhasInvestimento, tabelaCronograma, TITULO_BLOCO_DADOS } from "@/lib/propostas/blocos-dados";
import type { TipoBlocoDados } from "@/lib/propostas/documento";
import type { Estruturado } from "@/lib/propostas/estruturado";

/** O que os blocos do editor precisam da tela: os dados ao vivo (do cartão) e como comentar. */
export type ContextoFolha = { dados: Estruturado; comentar?: (a: Ancora) => void };
const CtxFolha = createContext<ContextoFolha | null>(null);
export const FolhaProvider = CtxFolha.Provider;
export const useFolha = () => useContext(CtxFolha);

/**
 * Bloco móvel na folha (GAB-100). Usa o MESMO cálculo do PDF (`blocos-dados.ts`), e não
 * é editado aqui: quem edita usa o cartão "Dados da proposta". Sem dados, mostra o aviso
 * de que não sai no PDF, em vez de prometer uma tabela vazia.
 */
export function BlocoDadosView({ tipo, dados, titulo, controles }: { tipo: TipoBlocoDados; dados: Estruturado; titulo?: ReactNode; controles?: ReactNode }) {
  const tabela = tipo === "cronograma" ? tabelaCronograma(dados) : null;
  const linhas = tipo === "investimento" ? linhasInvestimento(dados) : [];
  return (
    <div className="bloco-dados" data-bloco={tipo}>
      {controles}
      <h2>
        {titulo ?? TITULO_BLOCO_DADOS[tipo]}
        {controles ? <span className="bloco-dados-tag">dados da proposta</span> : null}
      </h2>
      {tabela ? (
        <table className="folha-tabela">
          <thead>
            <tr>
              {tabela.colunas.map((c) => (
                <th key={c.titulo} scope="col" className={c.alinhar} style={{ width: `${c.largura * 100}%` }}>
                  {c.titulo}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {tabela.linhas.map((l, i) => (
              <tr key={i}>
                {l.map((v, j) => (
                  <td key={j} className={tabela.colunas[j].alinhar}>
                    {v}
                  </td>
                ))}
              </tr>
            ))}
            {tabela.total ? (
              <tr className="total">
                {tabela.total.map((v, j) => (
                  <td key={j} className={tabela.colunas[j].alinhar}>
                    {v}
                  </td>
                ))}
              </tr>
            ) : null}
          </tbody>
        </table>
      ) : null}
      {linhas.map((l) => (
        <p key={l.rotulo} className={cn("bloco-dados-linha", l.forte && "font-bold")}>
          {l.rotulo}: {l.valor}
        </p>
      ))}
      {!tabela && linhas.length === 0 ? <p className="bloco-dados-vazio">{tipo === "cronograma" ? "Sem entregas em Dados da proposta: este bloco não sai no PDF." : "Sem valor nem prazo em Dados da proposta: este bloco não sai no PDF."}</p> : null}
    </div>
  );
}
