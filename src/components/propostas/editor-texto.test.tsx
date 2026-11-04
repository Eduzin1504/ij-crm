import { render, screen } from "@testing-library/react";
import { Editor } from "@tiptap/core";
import { describe, expect, it } from "vitest";
import { ancoraDoBloco, textoPlano } from "@/lib/propostas/ancora";
import { documentoParaEditor, lerDocumento, type Documento } from "@/lib/propostas/documento";
import { alternarBloco, blocosNoEditor } from "./bloco-dados-node";
import { ancoraDaSelecao, planoDoEditor } from "./destaques-editor";
import { DocumentoView } from "./documento-view";
import { EXTENSOES, jsonDoEditor } from "./editor-texto";

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

  it("jsonDoEditor devolve só objetos simples (server action descarta attrs sem protótipo)", () => {
    const e = editorCom(doc);
    // causa do bug: o ProseMirror cria attrs com Object.create(null)
    expect(Object.getPrototypeOf((e.getJSON().content as { attrs: object }[])[0].attrs)).toBeNull();
    const json = jsonDoEditor(e);
    const protos: unknown[] = [];
    const visitar = (v: unknown) => {
      if (v && typeof v === "object") {
        if (!Array.isArray(v)) protos.push(Object.getPrototypeOf(v));
        Object.values(v).forEach(visitar);
      }
    };
    visitar(json);
    expect(protos.every((p) => p === Object.prototype)).toBe(true);
    // Documento sem bloco no editor = os dois fora da folha, marcado (`documentoParaEditor` é quem os põe ao abrir).
    expect(lerDocumento(json)).toEqual({ ...doc, content: [...doc.content, { type: "semBlocos" }] });
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

describe("blocos móveis no editor (GAB-100)", () => {
  const texto = (t: string) => ({ type: "paragraph" as const, content: [{ type: "text" as const, text: t }] });
  const bloco = (tipo: "cronograma" | "investimento") => ({ type: "blocoDados" as const, attrs: { tipo } });

  it("bloco entra e sai do editor; o atributo vira objeto simples (server action descarta protótipo nulo)", () => {
    const e = editorCom({ type: "doc", content: [texto("a"), bloco("cronograma"), texto("b")] });
    const json = jsonDoEditor(e);
    const no = json.content[1] as { attrs: object };
    expect(Object.getPrototypeOf(no.attrs)).toBe(Object.prototype);
    expect(lerDocumento(json)?.content.map((b) => b.type)).toEqual(["paragraph", "blocoDados", "paragraph"]);
    e.destroy();
  });

  it("proposta antiga abre com os dois no fim e, sem mexer, continua com o mesmo Markdown", () => {
    const antiga: Documento = { type: "doc", content: [texto("a")] };
    const e = editorCom(documentoParaEditor(antiga));
    expect(blocosNoEditor(e)).toEqual({ cronograma: true, investimento: true });
    expect(lerDocumento(jsonDoEditor(e))).toEqual(antiga);
    e.destroy();
  });

  it("sem nenhum bloco no editor os dois saíram da folha: fica marcado, e reabre sem eles", () => {
    const e = editorCom(documentoParaEditor({ type: "doc", content: [texto("a")] }));
    alternarBloco(e, "cronograma");
    alternarBloco(e, "investimento");
    const lido = lerDocumento(jsonDoEditor(e))!;
    expect(lido.content.at(-1)).toEqual({ type: "semBlocos" });
    const reaberto = editorCom(documentoParaEditor(lido));
    expect(blocosNoEditor(reaberto)).toEqual({ cronograma: false, investimento: false });
    e.destroy();
    reaberto.destroy();
  });

  it("um de cada, mesmo colando outro igual", () => {
    const e = editorCom({ type: "doc", content: [bloco("cronograma"), texto("a")] });
    e.commands.insertContentAt(e.state.doc.content.size, bloco("cronograma"));
    expect(lerDocumento(jsonDoEditor(e))?.content.filter((b) => b.type === "blocoDados")).toHaveLength(1);
    e.destroy();
  });

  it("digitar com o bloco selecionado escreve depois dele, sem apagá-lo", () => {
    const e = editorCom({ type: "doc", content: [texto("a"), bloco("cronograma")] });
    e.commands.setNodeSelection(3);
    const { view } = e;
    const digitar = (t: string) => view.someProp("handleTextInput", (f) => f(view, view.state.selection.from, view.state.selection.to, t, () => view.state.tr));
    expect(digitar("x")).toBe(true);
    const lido = lerDocumento(jsonDoEditor(e))!;
    expect(lido.content.map((b) => b.type)).toEqual(["paragraph", "blocoDados", "paragraph"]);
    expect(lido.content[2]).toEqual(texto("x"));
    e.destroy();
  });

  it("colar bloco de tipo desconhecido não vira nó (o servidor recusaria o documento)", () => {
    const e = editorCom('<div data-bloco-dados="lixo"></div><p>a</p>');
    expect(blocosNoEditor(e)).toEqual({ cronograma: false, investimento: false });
    expect(lerDocumento(jsonDoEditor(e))).not.toBeNull();
    e.destroy();
  });

  it("bloco só no nível de cima: a lista não aceita (nem o esquema)", () => {
    const e = editorCom({ type: "doc", content: [texto("a")] });
    expect(e.schema.nodes.listItem.contentMatch.matchType(e.schema.nodes.blocoDados)).toBeFalsy();
    expect(e.schema.nodes.doc.contentMatch.matchType(e.schema.nodes.blocoDados)).toBeTruthy();
    e.destroy();
  });

  it("texto plano do editor bate com o do servidor, e a âncora do bloco é a mesma", () => {
    const doc: Documento = { type: "doc", content: [texto("a"), bloco("investimento"), texto("b")] };
    const e = editorCom(doc);
    expect(planoDoEditor(e.state.doc).texto).toBe(textoPlano(doc).texto);
    e.commands.setNodeSelection(3);
    expect(ancoraDaSelecao(e.state)).toEqual(ancoraDoBloco(doc, "investimento"));
    e.destroy();
  });
});
