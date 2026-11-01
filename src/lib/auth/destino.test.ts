import { describe, expect, it } from "vitest";
import { destinoSeguro } from "./destino";

describe("destinoSeguro (voltar depois do login)", () => {
  it("aceita caminho interno com query", () => {
    expect(destinoSeguro("/oauth/autorizar?client_id=x&state=y")).toBe("/oauth/autorizar?client_id=x&state=y");
    expect(destinoSeguro("/kanban")).toBe("/kanban");
  });
  it("recusa URL absoluta, protocol-relative, barra invertida e lixo (open redirect)", () => {
    for (const v of ["https://evil.test", "//evil.test", "/\\evil.test", "javascript:alert(1)", "", null, undefined, 42, `/${"a".repeat(5000)}`]) {
      expect(destinoSeguro(v)).toBeNull();
    }
  });
  it("recusa TAB/CR/LF e controles: o navegador os remove e /\\t/evil.com vira //evil.com", () => {
    // `/%09/evil.com` chega já decodificado pelo searchParams do Next.
    for (const v of [decodeURIComponent("/%09/evil.com"), "/\t/evil.com", "/\n/evil.com", "/\r/evil.com", "/\t\\evil.com", "/\x00/evil.com", "/\x7f/evil.com", "/a\\b"]) {
      expect(destinoSeguro(v), JSON.stringify(v)).toBeNull();
    }
  });
  it("devolve só caminho + query resolvidos (sem fragmento nem outro host)", () => {
    expect(destinoSeguro("/a/../kanban?x=1#y")).toBe("/kanban?x=1");
  });
});
