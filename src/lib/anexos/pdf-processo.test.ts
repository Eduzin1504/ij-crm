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

  // Sem teto de RSS que alcance (1 GB): a bomba Tj também cresce em memória (~150 MB em
  // ~0,6 s, ~240 MB em 6 s) e o teto de produção a mataria antes do tempo — aqui o caminho
  // testado é o do relógio (o da memória é o teste acima).
  const SEM_TETO_RSS = 1024 * 1024 * 1024;

  it("bomba de CPU (Tj repetidos): morto pelo tempo, sem travar o event loop do pai", async () => {
    const bomba = pdfBomba(16, "tj");
    let pendente = true;
    const extracao = extrairPdfEmProcesso(bomba, { textoMax: 1000, tempoMaxMs: 1500, rssMaxBytes: SEM_TETO_RSS }).finally(() => {
      pendente = false;
    });
    // O pai segue atendendo timers ENQUANTO o filho trabalha: 5 voltas de 50 ms do event
    // loop terminam com a extração ainda pendente. Se o pdf.js rodasse no processo do pai
    // (síncrono), nenhum timer rodaria antes de a extração acabar. Não conta ticks por
    // duração: só a ordem dos eventos importa (folga de ~6× até o teto de 1,5 s).
    for (let i = 0; i < 5; i++) {
      await new Promise((r) => setTimeout(r, 50));
      expect(pendente).toBe(true);
    }
    const r = await extracao;
    expect(r).toEqual({ tipo: "falha", motivo: "tempo esgotado (1500 ms)" });
  }, 30_000);

  it("uma extração por vez: chamadas simultâneas saem em fila (nunca 2 filhos vivos)", async () => {
    // Cada extração dura ~400 ms (bomba de CPU morta pelo tempo): em fila, as 3 somam ≥ 1,2 s;
    // em paralelo, ~0,4 s. A amostragem de /proc confirma que nunca há 2 filhos.
    const pdf = pdfBomba(16, "tj");
    const filhos = () => readFileSync(`/proc/self/task/${process.pid}/children`, "utf8").trim().split(/\s+/).filter(Boolean).length;
    const base = filhos();
    let maximo = 0;
    const amostra = setInterval(() => (maximo = Math.max(maximo, filhos() - base)), 20);
    const inicio = Date.now();
    const rs = await Promise.all([1, 2, 3].map(() => extrairPdfEmProcesso(pdf, { textoMax: 1000, tempoMaxMs: 400, rssMaxBytes: SEM_TETO_RSS })));
    clearInterval(amostra);
    expect(rs).toEqual(Array(3).fill({ tipo: "falha", motivo: "tempo esgotado (400 ms)" }));
    expect(Date.now() - inicio).toBeGreaterThanOrEqual(1200);
    expect(maximo).toBe(1);
  }, 30_000);
});
