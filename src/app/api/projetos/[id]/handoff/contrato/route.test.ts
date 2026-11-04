// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const { usuarioAtual, anexarContratoNoHandoff } = vi.hoisted(() => ({ usuarioAtual: vi.fn(), anexarContratoNoHandoff: vi.fn() }));
vi.mock("@/lib/auth/atual", () => ({ usuarioAtual }));
vi.mock("@/lib/projetos/handoff", async (orig) => ({ ...(await orig<typeof import("@/lib/projetos/handoff")>()), anexarContratoNoHandoff }));
vi.mock("@/lib/anexos/tipos", async (orig) => ({ ...(await orig<typeof import("@/lib/anexos/tipos")>()), ANEXO_MAX_BYTES: 100 }));

import { POST } from "./route";

const URL_ = "http://localhost:3037/api/projetos/p1/handoff/contrato";
const VEND = { id: "v1", papel: "VENDEDOR" };
const ctx = { params: Promise.resolve({ id: "p1" }) };

function req(corpo: BodyInit | null, headers: Record<string, string> = {}) {
  return new Request(URL_, { method: "POST", body: corpo, headers: { "x-nome-arquivo": encodeURIComponent("c.pdf"), ...headers } });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("POST /api/projetos/[id]/handoff/contrato", () => {
  it("sem sessão → 401; VISUALIZADOR → 403; outro site → 403; nada é gravado", async () => {
    usuarioAtual.mockResolvedValueOnce(null);
    expect((await POST(req("x"), ctx)).status).toBe(401);
    usuarioAtual.mockResolvedValueOnce({ id: "x", papel: "VISUALIZADOR" });
    expect((await POST(req("x"), ctx)).status).toBe(403);
    usuarioAtual.mockResolvedValueOnce(VEND);
    expect((await POST(req("x", { origin: "https://evil.example", host: "localhost:3037" }), ctx)).status).toBe(403);
    expect(anexarContratoNoHandoff).not.toHaveBeenCalled();
  });

  it("sem nome e grande demais são recusados", async () => {
    usuarioAtual.mockResolvedValue(VEND);
    expect((await POST(req("x", { "x-nome-arquivo": "" }), ctx)).status).toBe(400);
    expect((await POST(req("y".repeat(101)), ctx)).status).toBe(413);
  });

  it("repassa ao serviço; erro de regra vira texto; exceção vira ref", async () => {
    usuarioAtual.mockResolvedValue(VEND);
    anexarContratoNoHandoff.mockResolvedValueOnce({ ok: true, anexo: { id: "a", nome: "c.pdf", semTexto: false } });
    const ok = await POST(req("x"), ctx);
    expect(ok.status).toBe(200);
    expect(anexarContratoNoHandoff).toHaveBeenCalledWith("p1", expect.objectContaining({ nome: "c.pdf" }), VEND);

    anexarContratoNoHandoff.mockResolvedValueOnce({ ok: false, erro: "HANDOFF_ENCERRADO" });
    const regra = await POST(req("x"), ctx);
    expect(regra.status).toBe(422);
    expect((await regra.json()).erro).toContain("coluna Handoff");

    anexarContratoNoHandoff.mockRejectedValueOnce(new Error("boom"));
    const quebra = await POST(req("x"), ctx);
    expect(quebra.status).toBe(500);
    expect(await quebra.json()).toMatchObject({ erro: "INESPERADO", ref: expect.any(String) });
  });
});
