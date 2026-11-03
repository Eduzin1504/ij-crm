// @vitest-environment node
import { extractText, getDocumentProxy } from "unpdf";
import { describe, expect, it } from "vitest";
import { gerarPdf, limparTexto } from "./gerador";
import { TEMPLATE_PROVISORIO } from "./templates/provisorio";
import type { DocumentoPdf } from "./tipos";

async function texto(bytes: Uint8Array) {
  const doc = await getDocumentProxy(new Uint8Array(bytes));
  const r = await extractText(doc, { mergePages: false });
  return { paginas: r.totalPages, texto: (r.text as string[]).map((t) => t.replace(/\s+/g, " ")) };
}

const ACENTOS = "Ação, coração, pão, órgão, É, Ç, ü, à, ê — “aspas” e R$ 12.500,00";

describe("gerarPdf (pdf-lib + Inter embutida)", () => {
  it("acentos/UTF-8 saem como texto de verdade (fonte embutida em subconjunto)", async () => {
    const doc: DocumentoPdf = {
      titulo: "Proposta comercial",
      subtitulo: ["Padaria São João"],
      blocos: [
        { tipo: "titulo", nivel: 2, trechos: [{ texto: "Escopo" }] },
        { tipo: "paragrafo", trechos: [{ texto: ACENTOS }] },
        { tipo: "paragrafo", trechos: [{ texto: "texto " }, { texto: "negrito", negrito: true }, { texto: " e " }, { texto: "itálico", italico: true }] },
        { tipo: "item", marcador: "•", nivel: 0, trechos: [{ texto: "Página inicial" }] },
        { tipo: "item", marcador: "1.", nivel: 1, trechos: [{ texto: "Sub-item numerado" }] },
        { tipo: "linha" },
        { tipo: "campos", linhas: [{ rotulo: "Valor total", valor: "R$ 12.500,00" }, { rotulo: "Prazo", valor: "60 dias corridos" }] },
        { tipo: "tabela", colunas: [{ titulo: "Entrega", largura: 0.6 }, { titulo: "Data", largura: 0.2 }, { titulo: "Valor", largura: 0.2, alinhar: "direita" }], linhas: [["Protótipo", "01/12/2026", "R$ 5.000,00"]] },
      ],
    };
    const bytes = await gerarPdf(doc, TEMPLATE_PROVISORIO);
    expect(Buffer.from(bytes.subarray(0, 5)).toString()).toBe("%PDF-");
    const t = await texto(bytes);
    expect(t.paginas).toBe(1);
    const p1 = t.texto[0];
    for (const s of ["Proposta comercial", "Padaria São João", "Ação, coração, pão, órgão, É, Ç, ü, à, ê", "negrito", "itálico", "Página inicial", "Sub-item numerado", "Valor total", "R$ 12.500,00", "Protótipo", "Inteli Júnior", "Página 1 de 1"]) {
      expect(p1).toContain(s);
    }
    // Subconjunto: o PDF não carrega a fonte inteira (4 × ~400 KB).
    expect(bytes.length).toBeLessThan(200_000);
  });

  it("quebra linha e página; o rodapé numera todas", async () => {
    const longo = Array.from({ length: 400 }, (_, i) => `palavra${i}`).join(" ");
    const doc: DocumentoPdf = {
      titulo: "Longo",
      blocos: [
        ...Array.from({ length: 6 }, (): DocumentoPdf["blocos"][number] => ({ tipo: "paragrafo", trechos: [{ texto: longo }] })),
        { tipo: "tabela", colunas: [{ titulo: "A", largura: 0.5 }, { titulo: "B", largura: 0.5 }], linhas: Array.from({ length: 80 }, (_, i) => [`linha ${i}`, "x".repeat(300)]) },
      ],
    };
    const t = await texto(await gerarPdf(doc, TEMPLATE_PROVISORIO));
    expect(t.paginas).toBeGreaterThan(3);
    t.texto.forEach((p, i) => expect(p).toContain(`Página ${i + 1} de ${t.paginas}`));
    expect(t.texto.join(" ")).toContain("palavra399");
    expect(t.texto.join(" ")).toContain("linha 79");
  });

  it("caractere que a fonte não tem (emoji) vira ? em vez de sumir", async () => {
    const t = await texto(await gerarPdf({ titulo: "X", blocos: [{ tipo: "paragrafo", trechos: [{ texto: "oi 🚀 fim" }] }] }, TEMPLATE_PROVISORIO));
    expect(t.texto[0]).toContain("oi ? fim");
  });
});

describe("limparTexto", () => {
  it("normaliza espaço/controle e troca o que falta", () => {
    expect(limparTexto("a\tb c\u0007d​e🚀", new Set([..."abcde "].map((c) => c.codePointAt(0)!)))).toBe("a b cde?");
  });
  it("compõe acento decomposto (NFD → NFC)", () => {
    expect(limparTexto("ã", new Set(["ã".codePointAt(0)!]))).toBe("ã");
  });
});
