import { describe, expect, it } from "vitest";
import nextConfig from "../../../next.config";
import { CABECALHOS_SEGURANCA } from "./seguranca";

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
