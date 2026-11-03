// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({ usuarioAtual: vi.fn(), contarNaoLidos: vi.fn(), listarAvisos: vi.fn() }));
vi.mock("@/lib/auth/atual", () => ({ usuarioAtual: m.usuarioAtual }));
vi.mock("@/lib/avisos/avisos", () => ({ contarNaoLidos: m.contarNaoLidos, listarAvisos: m.listarAvisos }));

import { GET } from "./route";

const req = (q = "") => new Request(`http://localhost:3000/api/avisos${q}`);

beforeEach(() => {
  vi.clearAllMocks();
  m.usuarioAtual.mockResolvedValue({ id: "u1", papel: "VISUALIZADOR" });
  m.contarNaoLidos.mockResolvedValue(3);
});

describe("GET /api/avisos (polling do sino)", () => {
  it("sem sessão → 401 e nada é consultado", async () => {
    m.usuarioAtual.mockResolvedValueOnce(null);
    const r = await GET(req());
    expect(r.status).toBe(401);
    expect(m.contarNaoLidos).not.toHaveBeenCalled();
  });

  it("polling: só a contagem do próprio usuário (qualquer papel), sem cache", async () => {
    const r = await GET(req());
    expect(r.status).toBe(200);
    expect(r.headers.get("cache-control")).toBe("no-store");
    expect(await r.json()).toEqual({ naoLidos: 3 });
    expect(m.contarNaoLidos).toHaveBeenCalledWith("u1");
    expect(m.listarAvisos).not.toHaveBeenCalled();
  });

  it("?lista=1: contagem + lista (o sino aberto)", async () => {
    m.listarAvisos.mockResolvedValue([{ id: "a1", titulo: "É sua vez", criadoEm: new Date("2026-11-03T12:00:00Z") }]);
    const r = await GET(req("?lista=1"));
    expect(await r.json()).toEqual({ naoLidos: 3, avisos: [{ id: "a1", titulo: "É sua vez", criadoEm: "2026-11-03T12:00:00.000Z" }] });
    expect(m.listarAvisos).toHaveBeenCalledWith("u1");
  });

  it("erro inesperado → 500 com a ref que está no log", async () => {
    const erro = vi.spyOn(console, "error").mockImplementation(() => undefined);
    m.contarNaoLidos.mockRejectedValueOnce(new Error("banco fora"));
    const r = await GET(req());
    expect(r.status).toBe(500);
    const corpo = await r.json();
    expect(corpo.ref).toMatch(/^[0-9a-f]{8}$/);
    expect(erro.mock.calls.some((c) => String(c[0]).startsWith(`[api.avisos] ref=${corpo.ref}`))).toBe(true);
  });
});
