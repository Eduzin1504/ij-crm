import { Fragment, type ReactNode } from "react";
import { cn } from "cn";
import { segmentosDeDestaque, textoPlano, type Destaque } from "@/lib/propostas/ancora";
import type { Bloco, Documento, ItemLista, NoTexto } from "@/lib/propostas/documento";

/**
 * Desenha o documento da proposta como elementos React (leitura: versões,
 * quem não edita). Nunca usa HTML cru: todo texto passa pelo escape do React,
 * então Markdown/HTML vindo do MCP aparece como texto, sem injetar nada.
 * As classes são as mesmas do editor (`.proposta-texto`), para ler igual.
 *
 * GAB-91 (`destaques`): cada pedaço de texto sai num `<span data-o>` com o seu
 * offset no texto plano (`lib/propostas/ancora.ts`) — é assim que a seleção do
 * leitor vira âncora — e os trechos comentados num `<mark data-comentario>`.
 * Realce só visual: o documento não muda.
 */
type Anotacao = { inicios: Map<object, number>; destaques: readonly Destaque[]; ativo: string | null };

function comMarcas(n: NoTexto, texto: string): ReactNode {
  let el: ReactNode = texto;
  const marcas = new Set((n.marks ?? []).map((m) => m.type));
  if (marcas.has("italic")) el = <em>{el}</em>;
  if (marcas.has("bold")) el = <strong>{el}</strong>;
  return el;
}

function Inline({ nos, bloco, anot }: { nos: NoTexto[] | undefined; bloco: Bloco; anot: Anotacao | null }) {
  const inicio = anot?.inicios.get(bloco);
  if (!anot || inicio === undefined) return <>{(nos ?? []).map((n, i) => <Fragment key={i}>{comMarcas(n, n.text)}</Fragment>)}</>;
  let off = inicio;
  const partes: ReactNode[] = [];
  for (const n of nos ?? []) {
    for (const s of segmentosDeDestaque(off, n.text.length, anot.destaques)) {
      const el = comMarcas(n, n.text.slice(s.inicio - off, s.fim - off));
      partes.push(
        s.ids.length ? (
          <mark
            key={s.inicio}
            data-o={s.inicio}
            data-comentario={s.ids.includes(anot.ativo ?? "") ? anot.ativo! : s.ids[0]}
            className={cn("comentario-destaque", anot.ativo && s.ids.includes(anot.ativo) && "comentario-destaque-ativo")}
          >
            {el}
          </mark>
        ) : (
          <span key={s.inicio} data-o={s.inicio}>
            {el}
          </span>
        ),
      );
    }
    off += n.text.length;
  }
  return <>{partes}</>;
}

function Itens({ itens, anot }: { itens: ItemLista[]; anot: Anotacao | null }) {
  return (
    <>
      {itens.map((it, i) => (
        <li key={i}>
          <Blocos blocos={it.content} anot={anot} />
        </li>
      ))}
    </>
  );
}

function Blocos({ blocos, anot }: { blocos: Bloco[]; anot: Anotacao | null }) {
  return (
    <>
      {blocos.map((b, i) => {
        switch (b.type) {
          case "paragraph":
            return (
              <p key={i}>
                <Inline nos={b.content} bloco={b} anot={anot} />
              </p>
            );
          case "heading": {
            const H = (`h${b.attrs.level}` as "h1" | "h2" | "h3");
            return (
              <H key={i}>
                <Inline nos={b.content} bloco={b} anot={anot} />
              </H>
            );
          }
          case "horizontalRule":
            return <hr key={i} />;
          case "bulletList":
            return (
              <ul key={i}>
                <Itens itens={b.content} anot={anot} />
              </ul>
            );
          case "orderedList":
            return (
              <ol key={i} start={b.attrs.start}>
                <Itens itens={b.content} anot={anot} />
              </ol>
            );
        }
      })}
    </>
  );
}

export function DocumentoView({
  documento,
  className,
  destaques,
  ativo = null,
}: {
  documento: Documento;
  className?: string;
  /** GAB-91: com isto, o texto sai anotado (offsets + trechos comentados). */
  destaques?: readonly Destaque[];
  ativo?: string | null;
}) {
  if (documento.content.length === 0) return <p className={cn("text-sm text-fg-faint", className)}>Sem texto.</p>;
  const anot = destaques ? { inicios: textoPlano(documento).inicios, destaques, ativo } : null;
  return (
    <div data-testid="documento-proposta" className={cn("proposta-texto", className)}>
      <Blocos blocos={documento.content} anot={anot} />
    </div>
  );
}
