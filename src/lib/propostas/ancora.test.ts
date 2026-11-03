import { describe, expect, it } from "vitest";
import type { Documento } from "./documento";
import { CONTEXTO_ANCORA, criarAncora, localizarAncora, segmentosDeDestaque, textoPlano, TRECHO_MAX } from "./ancora";

const doc: Documento = {
  type: "doc",
  content: [
    { type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "Escopo" }] },
    { type: "paragraph", content: [{ type: "text", text: "Site " }, { type: "text", text: "com loja", marks: [{ type: "bold" }] }] },
    { type: "paragraph" },
    { type: "bulletList", content: [{ type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "item" }] }] }] },
    { type: "horizontalRule" },
  ],
};

describe("textoPlano: o texto corrido em que a âncora vive", () => {
  it("blocos de texto não vazios, na ordem do documento, separados por \\n", () => {
    const p = textoPlano(doc);
    expect(p.texto).toBe("Escopo\nSite com loja\nitem");
    expect(p.inicios.get(doc.content[0])).toBe(0);
    expect(p.inicios.get(doc.content[1])).toBe(7);
    expect(p.inicios.has(doc.content[2])).toBe(false); // parágrafo vazio não conta
  });
});

describe("criarAncora: trecho + contexto curto em volta", () => {
  const t = "Escopo\nSite com loja\nitem";
  it("guarda o trecho e até CONTEXTO_ANCORA caracteres de cada lado", () => {
    expect(criarAncora(t, 7, 11)).toEqual({ trecho: "Site", antes: "Escopo\n", depois: " com loja\nitem" });
    const longo = "a".repeat(100) + "X" + "b".repeat(100);
    const a = criarAncora(longo, 100, 101)!;
    expect(a.antes).toHaveLength(CONTEXTO_ANCORA);
    expect(a.depois).toHaveLength(CONTEXTO_ANCORA);
  });

  it("apara espaços da seleção; seleção vazia ou só espaço → null", () => {
    expect(criarAncora(t, 6, 12)).toEqual({ trecho: "Site", antes: "Escopo\n", depois: " com loja\nitem" });
    expect(criarAncora(t, 3, 3)).toBeNull();
    expect(criarAncora("a   b", 1, 4)).toBeNull();
  });

  it("trecho maior que TRECHO_MAX → null (a tela pede um trecho menor)", () => {
    const grande = "x".repeat(TRECHO_MAX + 1);
    expect(criarAncora(grande, 0, grande.length)).toBeNull();
    expect(criarAncora(grande, 0, TRECHO_MAX)).not.toBeNull();
  });
});

describe("localizarAncora: reencontra o trecho no documento atual", () => {
  it("achado uma vez: a posição", () => {
    const t = "Escopo\nSite com loja\nitem";
    expect(localizarAncora(t, { trecho: "com loja", antes: "Site ", depois: "\nitem" })).toEqual({ inicio: 12, fim: 20 });
  });

  it("texto mudou em volta: o trecho intacto continua achado", () => {
    expect(localizarAncora("Novo começo. Site com loja e blog", { trecho: "com loja", antes: "Site ", depois: "\nitem" })).toEqual({ inicio: 18, fim: 26 });
  });

  it("várias ocorrências: escolhe a de contexto mais parecido", () => {
    const t = "prazo de 30 dias para o site; prazo de 30 dias para o app";
    const a = criarAncora(t, t.lastIndexOf("30 dias"), t.lastIndexOf("30 dias") + 7)!;
    expect(localizarAncora(t, a)).toEqual({ inicio: t.lastIndexOf("30 dias"), fim: t.lastIndexOf("30 dias") + 7 });
    const b = criarAncora(t, t.indexOf("30 dias"), t.indexOf("30 dias") + 7)!;
    expect(localizarAncora(t, b)).toEqual({ inicio: t.indexOf("30 dias"), fim: t.indexOf("30 dias") + 7 });
  });

  it("trecho editado ou apagado → null (\"trecho alterado\")", () => {
    expect(localizarAncora("Site com loja virtual", { trecho: "com blog", antes: "", depois: "" })).toBeNull();
    expect(localizarAncora("", { trecho: "x", antes: "", depois: "" })).toBeNull();
  });
});

describe("segmentosDeDestaque: um bloco de texto cortado nas bordas dos destaques", () => {
  it("corta nas bordas e diz quais comentários cobrem cada pedaço", () => {
    const s = segmentosDeDestaque(10, 10, [
      { id: "a", inicio: 12, fim: 15 },
      { id: "b", inicio: 14, fim: 30 },
      { id: "c", inicio: 0, fim: 5 }, // fora do bloco
    ]);
    expect(s).toEqual([
      { inicio: 10, fim: 12, ids: [] },
      { inicio: 12, fim: 14, ids: ["a"] },
      { inicio: 14, fim: 15, ids: ["a", "b"] },
      { inicio: 15, fim: 20, ids: ["b"] },
    ]);
  });

  it("sem destaques: um pedaço só", () => {
    expect(segmentosDeDestaque(0, 4, [])).toEqual([{ inicio: 0, fim: 4, ids: [] }]);
  });
});
