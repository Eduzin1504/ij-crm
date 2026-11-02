// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const { usuarioAtual, anexarArquivo } = vi.hoisted(() => ({ usuarioAtual: vi.fn(), anexarArquivo: vi.fn() }));
vi.mock("@/lib/auth/atual", () => ({ usuarioAtual }));
vi.mock("@/lib/anexos/anexos", () => ({ anexarArquivo }));
vi.mock("@/lib/anexos/tipos", async (orig) => ({ ...(await orig<typeof import("@/lib/anexos/tipos")>()), ANEXO_MAX_BYTES: 100 }));

import { POST } from "./route";

const URL_ = "http://localhost:3037/api/projetos/p1/anexos";
const VEND = { id: "v1", papel: "VENDEDOR" };
const ctx = { params: Promise.resolve({ id: "p1" }) };

function req(corpo: BodyInit | null, headers: Record<string, string> = {}) {
  return new Request(URL_, { method: "POST", body: corpo, headers: { "x-nome-arquivo": encodeURIComponent("proposta.pdf"), ...headers } });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("POST /api/projetos/[id]/anexos", () => {
  it("sem sessão → 401; VISUALIZADOR → 403; nada é lido nem gravado", async () => {
    usuarioAtual.mockResolvedValueOnce(null);
    let r = await POST(req("x"), ctx);
    expect(r.status).toBe(401);
    usuarioAtual.mockResolvedValueOnce({ id: "x", papel: "VISUALIZADOR" });
    r = await POST(req("x"), ctx);
    expect(r.status).toBe(403);
    expect((await r.json()).erro).toMatch(/só de leitura/);
    expect(anexarArquivo).not.toHaveBeenCalled();
  });

  it("origem de outro site → 403", async () => {
    usuarioAtual.mockResolvedValue(VEND);
    const r = await POST(req("x", { origin: "https://malicioso.example" }), ctx);
    expect(r.status).toBe(403);
    expect(anexarArquivo).not.toHaveBeenCalled();
  });

  it("acima do limite → 413 (pelo Content-Length ou contando o corpo)", async () => {
    usuarioAtual.mockResolvedValue(VEND);
    let r = await POST(req("x", { "content-length": "101" }), ctx);
    expect(r.status).toBe(413);
    r = await POST(req("x".repeat(101)), ctx);
    expect(r.status).toBe(413);
    expect((await r.json()).erro).toMatch(/limite/);
    expect(anexarArquivo).not.toHaveBeenCalled();
  });

  it("sem nome ou nome mal codificado → 400", async () => {
    usuarioAtual.mockResolvedValue(VEND);
    expect((await POST(req("x", { "x-nome-arquivo": "" }), ctx)).status).toBe(400);
    expect((await POST(req("x", { "x-nome-arquivo": "%E0%A4%A" }), ctx)).status).toBe(400);
  });

  it("repassa nome e bytes ao serviço; sucesso → 201", async () => {
    usuarioAtual.mockResolvedValue(VEND);
    anexarArquivo.mockResolvedValue({ ok: true, anexo: { id: "a".repeat(32), nome: "Ação.pdf", semTexto: false } });
    const r = await POST(req("%PDF-", { "x-nome-arquivo": encodeURIComponent("Ação.pdf"), origin: "http://localhost:3037" }), ctx);
    expect(r.status).toBe(201);
    expect(await r.json()).toEqual({ ok: true, anexo: { id: "a".repeat(32), nome: "Ação.pdf", semTexto: false } });
    const [projetoId, arquivo, ator] = anexarArquivo.mock.calls[0];
    expect(projetoId).toBe("p1");
    expect(arquivo.nome).toBe("Ação.pdf");
    expect(new TextDecoder().decode(arquivo.bytes)).toBe("%PDF-");
    expect(ator).toBe(VEND);
  });

  it("erro de regra → status e mensagem em português; exceção → 500 com ref", async () => {
    usuarioAtual.mockResolvedValue(VEND);
    anexarArquivo.mockResolvedValueOnce({ ok: false, erro: "EXTENSAO_NAO_CONFERE" });
    let r = await POST(req("x"), ctx);
    expect(r.status).toBe(422);
    expect((await r.json()).erro).toMatch(/não confere com a extensão/);
    anexarArquivo.mockResolvedValueOnce({ ok: false, erro: "DUPLICADO" });
    expect((await POST(req("x"), ctx)).status).toBe(409);
    anexarArquivo.mockResolvedValueOnce({ ok: false, erro: "CARD_NAO_ENCONTRADO" });
    expect((await POST(req("x"), ctx)).status).toBe(404);
    anexarArquivo.mockRejectedValueOnce(new Error("disco cheio"));
    r = await POST(req("x"), ctx);
    expect(r.status).toBe(500);
    expect(await r.json()).toEqual({ ok: false, erro: "INESPERADO", ref: expect.stringMatching(/^[0-9a-f]{8}$/) });
    expect(console.error).toHaveBeenCalledWith(expect.stringMatching(/\[api\.projetos\.anexos\] ref=[0-9a-f]{8} Error: disco cheio/));
  });
});
