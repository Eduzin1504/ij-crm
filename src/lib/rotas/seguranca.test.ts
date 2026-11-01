import { describe, expect, it } from "vitest";
import nextConfig from "../../../next.config";
import { CABECALHOS_SEGURANCA, CSP_ANEXO } from "./seguranca";

describe("cabeçalhos anti-clickjacking (GAB-83)", () => {
  it("valem para todas as rotas, sem quebrar os redirects", async () => {
    const headers = await nextConfig.headers!();
    const todas = headers.find((h) => h.source === "/:path*");
    expect(todas?.headers).toEqual(CABECALHOS_SEGURANCA);
    expect(CABECALHOS_SEGURANCA).toEqual(
      expect.arrayContaining([
        { key: "X-Frame-Options", value: "DENY" },
        { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
      ]),
    );
    expect((await nextConfig.redirects!()).length).toBeGreaterThan(0);
  });
});

describe("anexos (GAB-84): CSP sandbox não é engolida pela regra geral", () => {
  it("regra de /api/anexos vem DEPOIS da geral (a última vence) e mantém o frame-ancestors", async () => {
    const headers = await nextConfig.headers!();
    const geral = headers.findIndex((h) => h.source === "/:path*");
    const anexos = headers.findIndex((h) => h.source === "/api/anexos/:path*");
    expect(anexos).toBeGreaterThan(geral);
    expect(headers[anexos].headers).toEqual([{ key: "Content-Security-Policy", value: CSP_ANEXO }]);
    expect(CSP_ANEXO).toMatch(/default-src 'none'/);
    expect(CSP_ANEXO).toMatch(/\bsandbox\b/);
    expect(CSP_ANEXO).toMatch(/frame-ancestors 'none'/);
  });
});
