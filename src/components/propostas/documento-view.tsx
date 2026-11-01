import { Fragment, type ReactNode } from "react";
import { cn } from "cn";
import type { Bloco, Documento, ItemLista, NoTexto } from "@/lib/propostas/documento";

/**
 * Desenha o documento da proposta como elementos React (leitura: versões,
 * quem não edita). Nunca usa HTML cru: todo texto passa pelo escape do React,
 * então Markdown/HTML vindo do MCP aparece como texto, sem injetar nada.
 * As classes são as mesmas do editor (`.proposta-texto`), para ler igual.
 */
function Inline({ nos }: { nos: NoTexto[] | undefined }) {
  return (
    <>
      {(nos ?? []).map((n, i) => {
        let el: ReactNode = n.text;
        const marcas = new Set((n.marks ?? []).map((m) => m.type));
        if (marcas.has("italic")) el = <em>{el}</em>;
        if (marcas.has("bold")) el = <strong>{el}</strong>;
        return <Fragment key={i}>{el}</Fragment>;
      })}
    </>
  );
}

function Itens({ itens }: { itens: ItemLista[] }) {
  return (
    <>
      {itens.map((it, i) => (
        <li key={i}>
          <Blocos blocos={it.content} />
        </li>
      ))}
    </>
  );
}

function Blocos({ blocos }: { blocos: Bloco[] }) {
  return (
    <>
      {blocos.map((b, i) => {
        switch (b.type) {
          case "paragraph":
            return (
              <p key={i}>
                <Inline nos={b.content} />
              </p>
            );
          case "heading": {
            const H = (`h${b.attrs.level}` as "h1" | "h2" | "h3");
            return (
              <H key={i}>
                <Inline nos={b.content} />
              </H>
            );
          }
          case "horizontalRule":
            return <hr key={i} />;
          case "bulletList":
            return (
              <ul key={i}>
                <Itens itens={b.content} />
              </ul>
            );
          case "orderedList":
            return (
              <ol key={i} start={b.attrs.start}>
                <Itens itens={b.content} />
              </ol>
            );
        }
      })}
    </>
  );
}

export function DocumentoView({ documento, className }: { documento: Documento; className?: string }) {
  if (documento.content.length === 0) return <p className={cn("text-sm text-fg-faint", className)}>Sem texto.</p>;
  return (
    <div data-testid="documento-proposta" className={cn("proposta-texto", className)}>
      <Blocos blocos={documento.content} />
    </div>
  );
}
