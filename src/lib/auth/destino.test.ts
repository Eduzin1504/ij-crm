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
});
