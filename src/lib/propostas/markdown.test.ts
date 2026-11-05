import { describe, expect, it } from "vitest";
import { documentoComBlocos, documentoDoEditor, herdarBlocos, lerDocumento, normalizarDocumento, type Bloco, type Documento, type NoTexto } from "./documento";
import { documentoParaMarkdown, markdownParaDocumento, normalizarMarkdown } from "./markdown";

const t = (text: string, ...marks: ("bold" | "italic")[]): NoTexto => (marks.length ? { type: "text", text, marks: marks.map((type) => ({ type })) } : { type: "text", text });
const p = (...content: NoTexto[]): Bloco => ({ type: "paragraph", content });
const doc = (...content: Bloco[]): Documento => ({ type: "doc", content });
const item = (...content: Bloco[]) => ({ type: "listItem" as const, content });

/** As duas direções: doc → md é o esperado e md → doc volta ao mesmo doc. */
function idaEVolta(d: Documento, md: string) {
  expect(documentoParaMarkdown(d)).toBe(md);
  expect(markdownParaDocumento(md)).toEqual(d);
}

describe("subconjunto do editor ↔ Markdown (ida e volta exata)", () => {
  it("parágrafos, títulos 1–3 e linha horizontal", () => {
    idaEVolta(
      doc(
        { type: "heading", attrs: { level: 1 }, content: [t("Proposta")] },
        p(t("Olá, mundo.")),
        { type: "heading", attrs: { level: 3 }, content: [t("Escopo")] },
        { type: "horizontalRule" },
        p(t("fim")),
      ),
      "# Proposta\n\nOlá, mundo.\n\n### Escopo\n\n---\n\nfim",
    );
  });

  it("negrito, itálico, os dois juntos e marcas que se cruzam", () => {
    idaEVolta(doc(p(t("a "), t("negrito", "bold"), t(" e "), t("itálico", "italic"), t(" e "), t("ambos", "bold", "italic"))), "a **negrito** e *itálico* e ***ambos***");
    idaEVolta(doc(p(t("x ", "bold"), t("y", "bold", "italic"), t(" z", "bold"))), "**x *y* z**");
    idaEVolta(doc(p(t("tudo ", "italic"), t("isto", "bold", "italic"), t(" junto", "italic"))), "*tudo **isto** junto*");
    idaEVolta(doc(p(t("Valor:", "bold"), t(" R$ 10.000,00"))), "**Valor:** R$ 10.000,00");
  });

  it("listas com marcadores e numeradas, aninhadas, com início próprio", () => {
    idaEVolta(
      doc(
        { type: "bulletList", content: [item(p(t("um")), { type: "bulletList", content: [item(p(t("um.a")))] }), item(p(t("dois")))] },
        { type: "orderedList", attrs: { start: 3 }, content: [item(p(t("três"))), item(p(t("quatro")), { type: "orderedList", attrs: { start: 1 }, content: [item(p(t("sub")))] })] },
      ),
      "- um\n  - um.a\n- dois\n\n3. três\n4. quatro\n   1. sub",
    );
  });

  it("item com dois parágrafos e item que começa por sublista", () => {
    const d = doc({ type: "bulletList", content: [item(p(t("a")), p(t("b"))), item({ type: "paragraph" }, { type: "bulletList", content: [item(p(t("c")))] })] });
    expect(markdownParaDocumento(documentoParaMarkdown(d))).toEqual(d);
  });

  it("numeração com marcador de 2 dígitos mantém a sublista no item certo", () => {
    const itens = Array.from({ length: 11 }, (_, i) => item(p(t(`i${i}`))));
    itens[10] = item(p(t("dez")), { type: "bulletList", content: [item(p(t("sub")))] });
    const d = doc({ type: "orderedList", attrs: { start: 1 }, content: itens });
    expect(markdownParaDocumento(documentoParaMarkdown(d))).toEqual(d);
  });
});

describe("texto com caracteres do Markdown é escapado (vira texto, nunca formatação)", () => {
  const casos = [
    "# não é título",
    "- não é lista",
    "+ nem esta",
    "1. nem esta",
    "2) nem esta",
    "> nem citação",
    "---",
    "***",
    "*asterisco* e _sublinhado_ e `crase`",
    "[link](https://x.com) e ![img](y)",
    "<script>alert(1)</script>",
    "a \\ barra \\* escapada",
    "~~riscado~~ e ~til~",
    "&amp; &lt;b&gt; &#42;",
    "| a | b |",
    "100% * 2 = 200%",
    "C:\\pasta\\arquivo",
    "#crm no começo",
    "R$ 1.500,00 (à vista) [opcional]",
  ];
  for (const texto of casos) {
    it(JSON.stringify(texto), () => {
      const d = doc(p(t(texto)));
      expect(markdownParaDocumento(documentoParaMarkdown(d))).toEqual(d);
    });
  }

  it("dentro de título e de item de lista também", () => {
    const d = doc({ type: "heading", attrs: { level: 2 }, content: [t("Fase # 2 ##")] }, { type: "bulletList", content: [item(p(t("# x"))), item(p(t("1. y")))] });
    expect(markdownParaDocumento(documentoParaMarkdown(d))).toEqual(d);
  });
});

describe("Markdown de fora (MCP) vira o subconjunto; o resto entra como texto literal", () => {
  it("HTML e script nunca viram elemento: ficam como texto", () => {
    const d = markdownParaDocumento('Oi <img src=x onerror="alert(1)"> fim\n\n<div>bloco</div>\n\n<script>alert(2)</script>');
    const texto = JSON.stringify(d);
    expect(d.content.every((b) => b.type === "paragraph")).toBe(true);
    expect(texto).toContain('<img src=x onerror=\\"alert(1)\\">');
    expect(texto).toContain("<script>alert(2)</script>");
  });

  it("links e imagens ficam como o texto original (sem href na tela)", () => {
    expect(markdownParaDocumento("ver [site](javascript:alert(1)) e ![a](b.png)")).toEqual(doc(p(t("ver [site](javascript:alert(1)) e ![a](b.png)"))));
  });

  it("variações de sintaxe viram a forma canônica", () => {
    expect(normalizarMarkdown("Título\n======\n\n__forte__ _ênfase_\n\n* a\n* b\n\n#### fundo")).toBe("# Título\n\n**forte** *ênfase*\n\n- a\n- b\n\n### fundo");
  });

  it("citação, código e tabela: conteúdo preservado como parágrafos de texto", () => {
    const d = markdownParaDocumento("> citado\n\n```\nlinha 1\nlinha 2\n```\n\n| a | b |\n|---|---|\n| 1 | 2 |");
    expect(d).toEqual(doc(p(t("citado")), p(t("linha 1")), p(t("linha 2")), p(t("a | b")), p(t("1 | 2"))));
  });

  it("quebra de linha simples dentro do parágrafo vira espaço", () => {
    expect(markdownParaDocumento("linha um\nlinha dois")).toEqual(doc(p(t("linha um linha dois"))));
  });

  it("vazio ↔ documento vazio", () => {
    expect(markdownParaDocumento("")).toEqual(doc());
    expect(documentoParaMarkdown(doc())).toBe("");
  });
});

describe("normalização", () => {
  it("espaço e pontuação na ponta da marca saem dela (o Markdown não representaria)", () => {
    expect(normalizarDocumento(doc(p(t("a"), t(" negrito ", "bold"), t("b"))))).toEqual(doc(p(t("a "), t("negrito", "bold"), t(" b"))));
    expect(normalizarDocumento(doc(p(t("Nota:", "bold"), t("texto"))))).toEqual(doc(p(t("Nota", "bold"), t(":texto"))));
  });

  it("marcas que se cruzam viram aninhadas; marca no meio da palavra dentro de outra sai", () => {
    expect(normalizarDocumento(doc(p(t("a", "bold"), t(" b", "bold", "italic"), t(" c", "italic"))))).toEqual(doc(p(t("a b", "bold"), t(" "), t("c", "italic"))));
    expect(normalizarDocumento(doc(p(t("x", "bold"), t("y", "bold", "italic"), t(" z", "bold"))))).toEqual(doc(p(t("xy z", "bold"))));
  });

  it("listas vizinhas do mesmo tipo viram uma (o Markdown não separa)", () => {
    const l = (x: string) => ({ type: "bulletList" as const, content: [item(p(t(x)))] });
    expect(normalizarDocumento(doc(l("a"), l("b")))).toEqual(doc({ type: "bulletList", content: [item(p(t("a"))), item(p(t("b")))] }));
  });

  it("lerDocumento recusa o que não é do subconjunto (link, imagem, código…)", () => {
    expect(lerDocumento({ type: "doc", content: [{ type: "image", attrs: { src: "x" } }] })).toBeNull();
    expect(lerDocumento({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "a", marks: [{ type: "link", attrs: { href: "javascript:x" } }] }] }] })).toBeNull();
    expect(lerDocumento("<p>oi</p>")).toBeNull();
    // atributos extras do Tiptap são ignorados
    expect(lerDocumento({ type: "doc", content: [{ type: "orderedList", attrs: { start: 2, type: null }, content: [{ type: "listItem", content: [{ type: "paragraph", attrs: {}, content: [{ type: "text", text: "a" }] }] }] }] })).toEqual(
      doc({ type: "orderedList", attrs: { start: 2 }, content: [item(p(t("a")))] }),
    );
  });
});

// ---------------------------------------------------------------- propriedade (aleatório com semente fixa)

function gerador(semente: number) {
  let s = semente;
  return () => {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    return s / 0x7fffffff;
  };
}

const PEDACOS = ["a", "b", "ção", "R$", "10", "1.", "2)", " ", " ", " ", "*", "**", "_", "#", "-", "+", ">", "<", "[", "]", "(", ")", "!", "\\", "`", "~", "&", ";", ":", ".", ",", "|", "=", "'", '"', "é", "😀"];

function docAleatorio(r: () => number): Documento {
  const inline = (): NoTexto[] => {
    const n = 1 + Math.floor(r() * 5);
    return Array.from({ length: n }, () => {
      const texto = Array.from({ length: 1 + Math.floor(r() * 6) }, () => PEDACOS[Math.floor(r() * PEDACOS.length)]).join("");
      const marks: ("bold" | "italic")[] = [];
      if (r() < 0.3) marks.push("bold");
      if (r() < 0.3) marks.push("italic");
      return t(texto, ...marks);
    });
  };
  const bloco = (nivel: number): Bloco => {
    const x = r();
    if (x < 0.45 || nivel > 2) return p(...inline());
    if (x < 0.6) return { type: "heading", attrs: { level: (1 + Math.floor(r() * 3)) as 1 | 2 | 3 }, content: inline() };
    if (x < 0.65) return { type: "horizontalRule" };
    const itens = Array.from({ length: 1 + Math.floor(r() * 3) }, () => item(p(...inline()), ...(r() < 0.3 ? [bloco(nivel + 1)] : [])));
    return x < 0.82 ? { type: "bulletList", content: itens } : { type: "orderedList", attrs: { start: Math.floor(r() * 12) }, content: itens };
  };
  return normalizarDocumento(doc(...Array.from({ length: 1 + Math.floor(r() * 5) }, () => bloco(0))));
}

describe("propriedade: qualquer documento normalizado faz ida e volta exata", () => {
  it("2000 documentos aleatórios: doc → md → doc idêntico e md canônico estável", () => {
    // SEMENTE/N no ambiente rodam mais casos à mão (ex.: SEMENTE=7 N=20000); o CI usa o padrão.
    const r = gerador(Number(process.env.SEMENTE ?? 42));
    for (let i = 0; i < Number(process.env.N ?? 2000); i++) {
      const d = docAleatorio(r);
      const md = documentoParaMarkdown(d);
      const volta = markdownParaDocumento(md);
      if (JSON.stringify(volta) !== JSON.stringify(d)) {
        // forma compacta (marcas "b"/"i") para achar o caso na saída do teste
        const c = (x: Documento) => JSON.stringify(x.content, (k, v) => (k === "marks" ? (v as { type: string }[]).map((m) => m.type[0]).join("") : v));
        const [a, b] = [c(volta), c(d)];
        let k = 0;
        while (a[k] === b[k]) k++;
        expect({ i, md, volta: a.slice(Math.max(0, k - 150), k + 150) }).toEqual({ i, md, volta: b.slice(Math.max(0, k - 150), k + 150) });
      }
      expect(documentoParaMarkdown(volta)).toBe(md);
    }
  });

  it("Markdown arbitrário: a forma canônica é ponto fixo (md → canônico → canônico)", () => {
    const r = gerador(7);
    const linhas = ["# t", "- a", "1. b", "  - c", "> q", "**x** _y_", "***z***", "---", "", "", "a*b*c", "<b>h</b>", "[l](u)", "`c`", "\\*", "x  ", "    code", "| a | b |", "|---|---|"];
    for (let i = 0; i < 1000; i++) {
      const md = Array.from({ length: 1 + Math.floor(r() * 8) }, () => linhas[Math.floor(r() * linhas.length)]).join("\n");
      const um = normalizarMarkdown(md);
      expect(normalizarMarkdown(um), JSON.stringify(md)).toBe(um);
    }
  });
});

describe("limite de custo (conteúdo vem do MCP)", () => {
  it("100 mil caracteres com marcas alternadas convertem rápido (sem custo quadrático)", () => {
    const md = Array.from({ length: 12_000 }, (_, i) => (i % 3 === 0 ? "**ab** " : i % 3 === 1 ? "*cd* " : "e ")).join("").slice(0, 100_000);
    const inicio = performance.now();
    const um = normalizarMarkdown(md);
    expect(normalizarMarkdown(um)).toBe(um);
    expect(performance.now() - inicio).toBeLessThan(3000);
  });
});

describe("blocos móveis (GAB-100)", () => {
  const p = (text: string): Bloco => ({ type: "paragraph", content: [{ type: "text", text }] });
  const b = (tipo: "cronograma" | "investimento"): Bloco => ({ type: "blocoDados", attrs: { tipo } });

  it("ida e volta: bloco no meio do texto", () => {
    const d: Documento = { type: "doc", content: [p("Antes."), b("cronograma"), p("Depois."), b("investimento"), p("Fim.")] };
    const md = documentoParaMarkdown(d);
    expect(md).toBe("Antes.\n\n<!-- bloco:cronograma -->\n\nDepois.\n\n<!-- bloco:investimento -->\n\nFim.");
    expect(markdownParaDocumento(md)).toEqual(d);
    expect(normalizarMarkdown(md)).toBe(md);
  });

  it("os dois no fim, nessa ordem, são a posição padrão: o Markdown fica igual ao de proposta antiga", () => {
    const d: Documento = { type: "doc", content: [p("Texto."), b("cronograma"), b("investimento")] };
    expect(documentoParaMarkdown(d)).toBe("Texto.");
    expect(documentoParaMarkdown({ type: "doc", content: [p("Texto."), b("cronograma"), b("investimento"), { type: "paragraph" }] })).toBe("Texto.");
    expect(documentoParaMarkdown({ type: "doc", content: [p("Texto."), b("investimento"), b("cronograma")] })).toBe("Texto.\n\n<!-- bloco:investimento -->\n\n<!-- bloco:cronograma -->");
    expect(documentoParaMarkdown({ type: "doc", content: [p("Texto."), b("investimento")] })).toBe("Texto.\n\n<!-- bloco:investimento -->");
  });

  it("os dois fora da folha é diferente de proposta antiga: fica marcado", () => {
    const md = documentoParaMarkdown(documentoDoEditor({ type: "doc", content: [p("Texto.")] }));
    expect(md).toBe("Texto.\n\n<!-- bloco:nenhum -->");
    expect(documentoComBlocos(markdownParaDocumento(md)).content.map((x) => x.type)).toEqual(["paragraph"]);
    expect(documentoComBlocos(markdownParaDocumento("Texto.")).content.map((x) => x.type)).toEqual(["paragraph", "blocoDados", "blocoDados"]);
    expect(normalizarMarkdown(md)).toBe(md);
    // Com bloco na folha o marcador não diz nada.
    expect(normalizarMarkdown("<!-- bloco:nenhum -->\n\nTexto.\n\n<!-- bloco:cronograma -->\n\nFim.")).toBe("Texto.\n\n<!-- bloco:cronograma -->\n\nFim.");
  });

  it("um de cada: o segundo some", () => {
    expect(normalizarMarkdown("<!-- bloco:cronograma -->\n\nA\n\n<!-- bloco:cronograma -->\n\nB")).toBe("<!-- bloco:cronograma -->\n\nA\n\nB");
  });

  it("duplicado entre duas listas: tirá-lo une as listas sem deixar de ser ponto fixo", () => {
    const md = normalizarMarkdown("- a\n\n<!-- bloco:nenhum -->\n\n- b");
    expect(md).toBe("- a\n- b\n\n<!-- bloco:nenhum -->");
    expect(normalizarMarkdown(md)).toBe(md);
  });

  it("marcador só vale sozinho no nível de cima; o resto continua texto literal", () => {
    expect(markdownParaDocumento("Veja <!-- bloco:cronograma --> aqui").content).toEqual([p("Veja <!-- bloco:cronograma --> aqui")]);
    expect(markdownParaDocumento("<!-- bloco:outra-coisa -->").content).toEqual([p("<!-- bloco:outra-coisa -->")]);
    expect(markdownParaDocumento("<!-- oi -->").content).toEqual([p("<!-- oi -->")]);
    const lista = markdownParaDocumento("- <!-- bloco:cronograma -->").content[0];
    expect(lista.type).toBe("bulletList");
    expect(JSON.stringify(lista)).not.toContain("blocoDados");
    expect(JSON.stringify(markdownParaDocumento("> <!-- bloco:cronograma -->"))).not.toContain("blocoDados");
  });

  it("texto que parece marcador sai escapado: nunca vira bloco", () => {
    const d: Documento = { type: "doc", content: [p("<!-- bloco:cronograma -->")] };
    const md = documentoParaMarkdown(d);
    expect(md).toBe("\\<!-- bloco:cronograma -->");
    expect(markdownParaDocumento(md)).toEqual(d);
  });

  it("texto puro de OCR, com formatação qualquer, passa sem ganhar nem perder bloco", () => {
    const ocr = "PROPOSTA\nCliente: ACME <acme@x.com>\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\n```\ncódigo\n```";
    const md = normalizarMarkdown(ocr);
    expect(md).not.toContain("bloco:");
    expect(normalizarMarkdown(md)).toBe(md);
    expect(md).toContain("código");
  });

  it("documentos aleatórios com blocos continuam ponto fixo", () => {
    let semente = 1234;
    const rnd = (n: number) => {
      semente = (semente * 48271) % 2147483647;
      return semente % n;
    };
    for (let k = 0; k < 300; k++) {
      const content: Bloco[] = [];
      const n = 1 + rnd(7);
      for (let i = 0; i < n; i++) {
        const t = rnd(6);
        if (t === 0) content.push(b("cronograma"));
        else if (t === 1) content.push(b("investimento"));
        else if (t === 2) content.push({ type: "bulletList", content: [{ type: "listItem", content: [p(`item ${i}`)] }] });
        else if (t === 3) content.push({ type: "semBlocos" });
        else content.push(p(`texto ${i}`));
      }
      const d = normalizarDocumento({ type: "doc", content });
      expect(markdownParaDocumento(documentoParaMarkdown(d))).toEqual(d);
      expect(normalizarDocumento(d)).toEqual(d);
    }
  });

  it("herdarBlocos: texto novo mantém quais blocos estão na folha, no fim", () => {
    const novo: Documento = { type: "doc", content: [p("Novo.")] };
    expect(herdarBlocos(novo, { type: "doc", content: [p("A"), b("cronograma"), p("B"), b("investimento"), p("C")] }).content).toEqual([p("Novo.")]);
    expect(herdarBlocos(novo, { type: "doc", content: [p("A"), b("investimento"), p("B")] }).content).toEqual([p("Novo."), b("investimento")]);
    expect(herdarBlocos(novo, { type: "doc", content: [p("A"), { type: "semBlocos" }] }).content).toEqual([p("Novo."), { type: "semBlocos" }]);
    expect(herdarBlocos(novo, { type: "doc", content: [p("A")] }).content).toEqual([p("Novo.")]);
  });

  it("JSON do editor: bloco válido entra; tipo desconhecido é recusado; dentro de lista não é do subconjunto", () => {
    expect(lerDocumento({ type: "doc", content: [{ type: "blocoDados", attrs: { tipo: "cronograma" } }, p("a")] })?.content[0]).toEqual(b("cronograma"));
    expect(lerDocumento({ type: "doc", content: [{ type: "blocoDados", attrs: { tipo: "outro" } }] })).toBeNull();
    const dentro = lerDocumento({ type: "doc", content: [{ type: "bulletList", content: [{ type: "listItem", content: [p("a"), b("cronograma")] }] }] });
    expect(JSON.stringify(dentro)).not.toContain("blocoDados");
  });
});
