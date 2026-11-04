// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const { usuarioAtual, marcarContratoAssinado } = vi.hoisted(() => ({ usuarioAtual: vi.fn(), marcarContratoAssinado: vi.fn() }));
vi.mock("@/lib/auth/atual", () => ({ usuarioAtual }));
vi.mock("@/lib/projetos/contrato-assinado", async (orig) => ({ ...(await orig<typeof import("@/lib/projetos/contrato-assinado")>()), marcarContratoAssinado }));
vi.mock("@/lib/anexos/tipos", async (orig) => ({ ...(await orig<typeof import("@/lib/anexos/tipos")>()), ANEXO_MAX_BYTES: 100 }));

import { POST } from "./route";

const URL_ = "http://localhost:3037/api/projetos/p1/contrato-assinado";
const VEND = { id: "v1", papel: "VENDEDOR" };
const ctx = { params: Promise.resolve({ id: "p1" }) };

function req(corpo: BodyInit | null, headers: Record<string, string> = {}) {
  return new Request(URL_, { method: "POST", body: corpo, headers: { "x-nome-arquivo": encodeURIComponent("contrato.pdf"), ...headers } });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("POST /api/projetos/[id]/contrato-assinado", () => {
  it("sem sessão → 401; VISUALIZADOR → 403; outro site → 403; nada é gravado", async () => {
    usuarioAtual.mockResolvedValueOnce(null);
    expect((await POST(req("x"), ctx)).status).toBe(401);
    usuarioAtual.mockResolvedValueOnce({ id: "x", papel: "VISUALIZADOR" });
    expect((await POST(req("x"), ctx)).status).toBe(403);
    usuarioAtual.mockResolvedValueOnce(VEND);
    expect((await POST(req("x", { origin: "https://malicioso.example" }), ctx)).status).toBe(403);
    expect(marcarContratoAssinado).not.toHaveBeenCalled();
  });

  it("acima do limite → 413; sem nome → 400", async () => {
    usuarioAtual.mockResolvedValue(VEND);
    expect((await POST(req("x".repeat(101)), ctx)).status).toBe(413);
    expect((await POST(req("x", { "x-nome-arquivo": "" }), ctx)).status).toBe(400);
    expect(marcarContratoAssinado).not.toHaveBeenCalled();
  });

  it("repassa valor, nome e bytes ao serviço", async () => {
    usuarioAtual.mockResolvedValue(VEND);
    marcarContratoAssinado.mockResolvedValue({ ok: true, mudou: true, anexo: { id: "a", nome: "Ação.pdf", semTexto: false } });
    const r = await POST(req("%PDF-", { "x-nome-arquivo": encodeURIComponent("Ação.pdf"), "x-valor-fechado": encodeURIComponent("12.500,00") }), ctx);
    expect(r.status).toBe(200);
    expect(await r.json()).toMatchObject({ ok: true, mudou: true });
    const [id, dados, ator] = marcarContratoAssinado.mock.calls[0];
    expect(id).toBe("p1");
    expect(dados.valorFechado).toBe("12.500,00");
    expect(dados.arquivo.nome).toBe("Ação.pdf");
    expect(new TextDecoder().decode(dados.arquivo.bytes)).toBe("%PDF-");
    expect(ator).toBe(VEND);
  });

  it("erro de regra vira texto; exceção vira INESPERADO com ref", async () => {
    usuarioAtual.mockResolvedValue(VEND);
    marcarContratoAssinado.mockResolvedValueOnce({ ok: false, erro: "GANHO_SO_DE_MONTANDO_CONTRATO" });
    let r = await POST(req("%PDF-"), ctx);
    expect(r.status).toBe(422);
    expect((await r.json()).erro).toMatch(/só a partir de Montando contrato/);
    marcarContratoAssinado.mockRejectedValueOnce(new Error("boom"));
    r = await POST(req("%PDF-"), ctx);
    expect(r.status).toBe(500);
    expect(await r.json()).toMatchObject({ erro: "INESPERADO", ref: expect.any(String) });
  });
});
