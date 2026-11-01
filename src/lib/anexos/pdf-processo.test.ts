// @vitest-environment node
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { pdfBomba, pdfDeTexto } from "@/test/fixtures/anexos";
import { extrairPdfEmProcesso, scriptDoFilho } from "./pdf-processo";

const enc = new TextEncoder();

describe("extrairPdfEmProcesso (filho com teto de tempo e memória)", () => {
  it("o script do filho fica em src/lib/anexos (o tracing do standalone copia daí)", () => {
    expect(scriptDoFilho()).toMatch(/src\/lib\/anexos\/pdf-filho\.mjs$/);
  });

  it("PDF digital: texto por página", async () => {
    const r = await extrairPdfEmProcesso(pdfDeTexto(["Primeira pagina", "Segunda pagina"]), { textoMax: 1000 });
    expect(r).toEqual({ tipo: "texto", total: 2, paginas: ["Primeira pagina", "Segunda pagina"] });
  });

  it("teto de texto: o filho para de extrair e o pai corta de novo", async () => {
    const r = await extrairPdfEmProcesso(pdfDeTexto(["abcdefghij", "klmnopqrst", "uvwxyz"]), { textoMax: 12 });
    expect(r).toEqual({ tipo: "texto", total: 3, paginas: ["abcdefghij", "kl"] });
  });

  it("PDF que o pdf.js não abre → corrompido", async () => {
    expect(await extrairPdfEmProcesso(enc.encode("%PDF-1.4\nlixo"), { textoMax: 1000 })).toEqual({ tipo: "corrompido" });
  });

  it("bomba de memória (1 MB → 512 MB descompactados): o filho é morto pelo RSS, o pai não incha", async () => {
    const bomba = pdfBomba(512);
    expect(bomba.length).toBeLessThan(1024 * 1024);
    const antes = process.memoryUsage().rss;
    const inicio = Date.now();
    const r = await extrairPdfEmProcesso(bomba, { textoMax: 1000 });
    expect(r).toMatchObject({ tipo: "falha", motivo: expect.stringMatching(/memória acima do teto/) });
    expect(Date.now() - inicio).toBeLessThan(10_000);
    expect(process.memoryUsage().rss - antes).toBeLessThan(100 * 1024 * 1024);
  }, 30_000);

  it("bomba de CPU (Tj repetidos): morto pelo tempo, sem travar o event loop do pai", async () => {
    const bomba = pdfBomba(16, "tj");
    let ticks = 0;
    const t = setInterval(() => ticks++, 50);
    const r = await extrairPdfEmProcesso(bomba, { textoMax: 1000, tempoMaxMs: 1500 });
    clearInterval(t);
    expect(r).toMatchObject({ tipo: "falha" });
    // O pai seguiu atendendo: o timer de 50 ms rodou durante a extração.
    expect(ticks).toBeGreaterThan(10);
  }, 30_000);

  it("uma extração por vez: chamadas simultâneas saem em fila (nunca 2 filhos vivos)", async () => {
    const pdf = pdfDeTexto(["Texto da proposta"]);
    const filhos = () => readFileSync(`/proc/self/task/${process.pid}/children`, "utf8").trim().split(/\s+/).filter(Boolean).length;
    const base = filhos();
    let maximo = 0;
    const amostra = setInterval(() => (maximo = Math.max(maximo, filhos() - base)), 5);
    const ordem: number[] = [];
    await Promise.all([1, 2, 3].map((n) => extrairPdfEmProcesso(pdf, { textoMax: 1000 }).then(() => ordem.push(n))));
    clearInterval(amostra);
    expect(ordem).toEqual([1, 2, 3]);
    expect(maximo).toBe(1);
  }, 30_000);
});
