import { Editor } from "@tiptap/core";
import { describe, expect, it } from "vitest";
import { lerDocumento, type Documento } from "@/lib/propostas/documento";
import { textoPlano } from "@/lib/propostas/ancora";
import { documentoParaMarkdown, markdownParaDocumento } from "@/lib/propostas/markdown";
import { EXTENSOES } from "./editor-texto";
import { ancoraDaSelecao, chaveDestaques, DestaquesComentarios, planoDoEditor } from "./destaques-editor";

const doc: Documento = {
  type: "doc",
  content: [
    { type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "Escopo" }] },
    { type: "paragraph", content: [{ type: "text", text: "Site " }, { type: "text", text: "com loja", marks: [{ type: "bold" }] }] },
    { type: "bulletList", content: [{ type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "item um" }] }] }] },
  ],
};

const novo = () => new Editor({ extensions: [...EXTENSOES, DestaquesComentarios], content: doc });

describe("texto plano do editor = o da visualização", () => {
  it("mesmo texto que textoPlano(documento) (a âncora vale nos dois)", () => {
    const e = novo();
    expect(planoDoEditor(e.state.doc).texto).toBe(textoPlano(doc).texto);
    e.destroy();
  });
});

describe("ancoraDaSelecao", () => {
  it("seleção do editor → trecho + contexto no texto plano", () => {
    const e = novo();
    const { texto, segmentos } = planoDoEditor(e.state.doc);
    const seg = segmentos[1]; // "Site com loja"
    e.commands.setTextSelection({ from: seg.posicoes[0] + 5, to: seg.posicoes[0] + 13 });
    expect(ancoraDaSelecao(e.state)).toEqual({ trecho: "com loja", antes: texto.slice(0, 12), depois: "\nitem um" });
    e.destroy();
  });

  it("seleção vazia → null", () => {
    const e = novo();
    e.commands.setTextSelection(3);
    expect(ancoraDaSelecao(e.state)).toBeNull();
    e.destroy();
  });

  it("seleção atravessando blocos inclui o \\n", () => {
    const e = novo();
    const { segmentos } = planoDoEditor(e.state.doc);
    e.commands.setTextSelection({ from: segmentos[0].posicoes[0] + 3, to: segmentos[1].posicoes[0] + 4 });
    expect(ancoraDaSelecao(e.state)?.trecho).toBe("opo\nSite");
    e.destroy();
  });
});

describe("decoração do trecho comentado (só visual)", () => {
  it("destaca onde a âncora está, acompanha a edição e some quando o trecho muda — o documento não ganha marca", () => {
    const e = novo();
    e.view.dispatch(e.state.tr.setMeta(chaveDestaques, { destaques: [{ id: "c1", ancora: { trecho: "com loja", antes: "Site ", depois: "" } }], ativo: "c1" }));
    const marcas = () => [...e.view.dom.querySelectorAll("[data-comentario]")].map((n) => [n.textContent, n.className]);
    expect(marcas()).toEqual([["com loja", "comentario-destaque comentario-destaque-ativo"]]);
    // O JSON (o que vai para o Markdown) continua só com o subconjunto.
    expect(lerDocumento(e.getJSON())).toEqual(doc);

    e.commands.insertContentAt(1, "Novo "); // texto antes: a âncora continua achada
    expect(marcas().map(([t]) => t)).toEqual(["com loja"]);

    const { segmentos } = planoDoEditor(e.state.doc);
    e.commands.insertContentAt(segmentos[1].posicoes[0] + 7, "X"); // dentro do trecho: "coXm loja"
    expect(marcas()).toEqual([]);
    e.destroy();
  });
});

describe("espaços que o Markdown não guarda (editor ao vivo × canônico)", () => {
  const cru: Documento = {
    type: "doc",
    content: [{ type: "paragraph", content: [{ type: "text", text: "  Prazo:  30\tdias  " }] }],
  };
  const editor = () => new Editor({ extensions: [...EXTENSOES, DestaquesComentarios], content: cru });
  // O que o servidor e os leitores veem: ida e volta pelo Markdown canônico.
  const canonico = () => textoPlano(markdownParaDocumento(documentoParaMarkdown(cru))).texto;

  it("texto plano do editor = o do documento canônico", () => {
    const e = editor();
    expect(canonico()).toBe("Prazo: 30 dias");
    expect(planoDoEditor(e.state.doc).texto).toBe(canonico());
    e.destroy();
  });

  it("selecionar 'Prazo:  30' (dois espaços) no editor dá a âncora canônica", () => {
    const e = editor();
    const p0 = 1; // início do texto do parágrafo
    e.commands.setTextSelection({ from: p0 + 2, to: p0 + 12 }); // "Prazo:  30"
    expect(ancoraDaSelecao(e.state)).toEqual({ trecho: "Prazo: 30", antes: "", depois: " dias" });
    e.destroy();
  });

  it("trecho citado por um leitor ('Prazo: 30 dias') é achado e destacado no editor cru", () => {
    const e = editor();
    e.view.dispatch(e.state.tr.setMeta(chaveDestaques, { destaques: [{ id: "c1", ancora: { trecho: "Prazo: 30 dias", antes: "", depois: "" } }], ativo: null }));
    const marcas = [...e.view.dom.querySelectorAll("[data-comentario]")].map((n) => n.textContent).join("");
    expect(marcas).toBe("Prazo:  30\tdias");
    e.destroy();
  });
});
