import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import fontkit from "@pdf-lib/fontkit";
import { LARGURA_NOME_CAPA, larguraDoCaractere, nomeDaCapa } from "./nome-capa";

describe("nomeDaCapa", () => {
  it("a estimativa nunca fica abaixo da largura real na Poppins Bold", async () => {
    const fonte = fontkit.create(await readFile("src/lib/pdf/fontes/Poppins-Bold.ttf"));
    const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789ÁÀÃÂÉÊÍÓÕÔÚÇáàãâéêíóõôúç .,:;-–—/&()'\"!?%+@";
    for (const c of chars) expect(larguraDoCaractere(c), c).toBeGreaterThanOrEqual(fonte.layout(c).advanceWidth / fonte.unitsPerEm);
  });

  it("nome curto: uma linha, no tamanho cheio", () => {
    expect(nomeDaCapa("Tropcargo  Logística")).toEqual({ linhas: ["Tropcargo Logística"], tamanho: 19 });
  });

  it("primeiro quebra, em até 3 linhas, sem perder palavra", () => {
    const nome = "Companhia Brasileira de Distribuição e Logística de Alimentos do Sudeste";
    const r = nomeDaCapa(nome);
    expect(r.tamanho).toBe(19);
    expect(r.linhas.length).toBeGreaterThan(1);
    expect(r.linhas.length).toBeLessThanOrEqual(3);
    expect(r.linhas.join(" ")).toBe(nome);
  });

  it("não cabendo em 3 linhas, encolhe; só por último corta com reticências", () => {
    const medio = Array.from({ length: 14 }, () => "Empresa").join(" ");
    const m = nomeDaCapa(medio);
    expect(m.tamanho).toBeLessThan(19);
    expect(m.linhas.join(" ")).toBe(medio);
    const enorme = Array.from({ length: 120 }, () => "Empresa").join(" ");
    const e = nomeDaCapa(enorme);
    expect(e.tamanho).toBe(12);
    expect(e.linhas).toHaveLength(3);
    expect(e.linhas[2].endsWith("…")).toBe(true);
  });

  it("palavra maior que a linha é partida e continua dentro da largura", () => {
    const r = nomeDaCapa("X".repeat(200));
    expect(r.linhas.length).toBeLessThanOrEqual(3);
    for (const l of r.linhas) expect([...l].length * 0.84 * r.tamanho).toBeLessThanOrEqual(LARGURA_NOME_CAPA + r.tamanho);
  });
});
