import { describe, expect, it } from "vitest";
import { pkceConfere, recursoConfere, redirectPermitido } from "./oauth";
import { createHash } from "node:crypto";

describe("redirectPermitido", () => {
  it("https: só o registrado, exato", () => {
    const reg = ["https://claude.ai/api/mcp/auth_callback"];
    expect(redirectPermitido(reg, "https://claude.ai/api/mcp/auth_callback")).toBe(true);
    expect(redirectPermitido(reg, "https://claude.ai/api/mcp/auth_callback?x=1")).toBe(false);
    expect(redirectPermitido(reg, "https://evil.test/api/mcp/auth_callback")).toBe(false);
  });
  it("loopback (Claude Code): porta livre, mesmo caminho, localhost e 127.0.0.1", () => {
    const reg = ["http://localhost/callback", "http://127.0.0.1:3118/callback"];
    expect(redirectPermitido(reg, "http://localhost:54321/callback")).toBe(true);
    expect(redirectPermitido(reg, "http://127.0.0.1:9999/callback")).toBe(true);
    expect(redirectPermitido(reg, "http://localhost:54321/outro")).toBe(false);
    expect(redirectPermitido(["https://app.test/cb"], "http://localhost:1/cb")).toBe(false);
  });
});

describe("pkceConfere (S256)", () => {
  it("base64url(sha256(verifier)) = challenge", () => {
    const verifier = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";
    const challenge = createHash("sha256").update(verifier).digest("base64url");
    expect(pkceConfere(verifier, challenge)).toBe(true);
    expect(pkceConfere(`${verifier}x`, challenge)).toBe(false);
    expect(pkceConfere("curto", challenge)).toBe(false);
  });
});

describe("recursoConfere (RFC 8707)", () => {
  it("aceita o recurso canônico, com barra final ou host maiúsculo; recusa outro", () => {
    expect(recursoConfere(undefined)).toBe(true);
    expect(recursoConfere("http://localhost:3000/api/mcp")).toBe(true);
    expect(recursoConfere("http://LOCALHOST:3000/api/mcp/")).toBe(true);
    expect(recursoConfere("http://localhost:3000/api/outro")).toBe(false);
    expect(recursoConfere("não é url")).toBe(false);
  });
});
