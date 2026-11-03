import { render, screen } from "@testing-library/react";
import { Editor } from "@tiptap/core";
import { describe, expect, it } from "vitest";
import { lerDocumento, type Documento } from "@/lib/propostas/documento";
import { DocumentoView } from "./documento-view";
import { EXTENSOES } from "./editor-texto";

const doc: Documento = {
  type: "doc",
  content: [
    { type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "Escopo" }] },
    { type: "paragraph", content: [{ type: "text", text: "Site " }, { type: "text", text: "com loja", marks: [{ type: "bold" }] }, { type: "text", text: " e " }, { type: "text", text: "blog", marks: [{ type: "italic" }] }] },
    {
      type: "orderedList",
      attrs: { start: 3 },
      content: [
        { type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "três" }] }, { type: "bulletList", content: [{ type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "sub" }] }] }] }] },
      ],
    },
    { type: "horizontalRule" },
  ],
};

function editorCom(content: Documento | string) {
  return new Editor({ extensions: EXTENSOES, content });
}

describe("Tiptap com só as extensões do subconjunto", () => {
  it("o documento canônico entra e sai do editor igual (getJSON → lerDocumento)", () => {
    const e = editorCom(doc);
    expect(lerDocumento(e.getJSON())).toEqual(doc);
    e.destroy();
  });

  it("HTML colado/carregado de fora vira o subconjunto: sem script, link, imagem nem atributos", () => {
    const e = editorCom('<p>Oi <a href="javascript:alert(1)">clique</a> <img src=x onerror="alert(1)"><script>alert(2)</script><strong>forte</strong></p><table><tr><td>célula</td></tr></table><pre><code>x</code></pre>');
    const json = JSON.stringify(e.getJSON());
    expect(json).not.toMatch(/javascript|onerror|img|script|link|href|table|code/);
    expect(lerDocumento(e.getJSON())).not.toBeNull();
    expect(json).toContain("clique");
    expect(json).toContain("forte");
    e.destroy();
  });
});

describe("DocumentoView (leitura)", () => {
  it("desenha títulos, marcas e listas como elementos; texto com HTML aparece literal", () => {
    render(<DocumentoView documento={{ type: "doc", content: [...doc.content, { type: "paragraph", content: [{ type: "text", text: "<script>alert(1)</script>" }] }] }} />);
    expect(screen.getByRole("heading", { level: 2, name: "Escopo" })).toBeInTheDocument();
    expect(screen.getByText("com loja").tagName).toBe("STRONG");
    expect(screen.getByText("blog").tagName).toBe("EM");
    expect(screen.getAllByRole("list")).toHaveLength(2);
    expect(document.querySelector("ol")?.getAttribute("start")).toBe("3");
    expect(screen.getByText("<script>alert(1)</script>")).toBeInTheDocument();
    expect(document.querySelector("script")).toBeNull();
  });

  it("vazio diz que não há texto", () => {
    render(<DocumentoView documento={{ type: "doc", content: [] }} />);
    expect(screen.getByText("Sem texto.")).toBeInTheDocument();
  });
});
