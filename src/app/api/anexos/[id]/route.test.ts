// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const { usuarioAtual, obterAnexoParaDownload, lerTextoDoAnexo, lerArquivo } = vi.hoisted(() => ({
  usuarioAtual: vi.fn(),
  obterAnexoParaDownload: vi.fn(),
  lerTextoDoAnexo: vi.fn(),
  lerArquivo: vi.fn(),
}));
vi.mock("@/lib/auth/atual", () => ({ usuarioAtual }));
vi.mock("@/lib/anexos/anexos", () => ({ obterAnexoParaDownload, lerTextoDoAnexo }));
vi.mock("@/lib/anexos/armazenamento", async (orig) => ({ ...(await orig<typeof import("@/lib/anexos/armazenamento")>()), lerArquivo }));

import { GET } from "./route";
import { GET as GET_TEXTO } from "./texto/route";

const ID = "a".repeat(32);
const ctx = (id = ID) => ({ params: Promise.resolve({ id }) });
const req = () => new Request(`http://localhost:3037/api/anexos/${ID}`);

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("GET /api/anexos/[id] (download)", () => {
  it("sem sessão → 401 sem tocar no banco nem no disco", async () => {
    usuarioAtual.mockResolvedValue(null);
    const r = await GET(req(), ctx());
    expect(r.status).toBe(401);
    expect(obterAnexoParaDownload).not.toHaveBeenCalled();
    expect(lerArquivo).not.toHaveBeenCalled();
  });

  it("VISUALIZADOR baixa: attachment com nome sanitizado, mime validado, nosniff e CSP sandbox", async () => {
    usuarioAtual.mockResolvedValue({ id: "x", papel: "VISUALIZADOR" });
    obterAnexoParaDownload.mockResolvedValue({ id: ID, nome: "Proposta Ação.pdf", mime: "application/pdf", tamanho: 3 });
    lerArquivo.mockResolvedValue(Buffer.from([1, 2, 3]));
    const r = await GET(req(), ctx());
    expect(r.status).toBe(200);
    expect(r.headers.get("content-type")).toBe("application/pdf");
    expect(r.headers.get("content-disposition")).toBe(`attachment; filename="Proposta Acao.pdf"; filename*=UTF-8''Proposta%20A%C3%A7%C3%A3o.pdf`);
    expect(r.headers.get("x-content-type-options")).toBe("nosniff");
    expect(r.headers.get("content-security-policy")).toContain("sandbox");
    expect(r.headers.get("cache-control")).toContain("private");
    expect([...new Uint8Array(await r.arrayBuffer())]).toEqual([1, 2, 3]);
    expect(lerArquivo).toHaveBeenCalledWith(ID);
  });

  it("id fora do formato ou anexo inexistente/excluído → 404 (nunca vira caminho)", async () => {
    usuarioAtual.mockResolvedValue({ id: "x", papel: "VENDEDOR" });
    expect((await GET(req(), ctx("../../etc/passwd"))).status).toBe(404);
    expect(obterAnexoParaDownload).not.toHaveBeenCalled();
    obterAnexoParaDownload.mockResolvedValue(null);
    expect((await GET(req(), ctx())).status).toBe(404);
    expect(lerArquivo).not.toHaveBeenCalled();
  });

  it("arquivo sumiu do disco → 500 com ref no corpo e no log", async () => {
    usuarioAtual.mockResolvedValue({ id: "x", papel: "VENDEDOR" });
    obterAnexoParaDownload.mockResolvedValue({ id: ID, nome: "a.pdf", mime: "application/pdf", tamanho: 3 });
    lerArquivo.mockRejectedValue(Object.assign(new Error("ENOENT: no such file"), { code: "ENOENT" }));
    const r = await GET(req(), ctx());
    expect(r.status).toBe(500);
    const ref = r.headers.get("x-erro-ref");
    expect(ref).toMatch(/^[0-9a-f]{8}$/);
    expect(await r.text()).toContain(`ref: ${ref}`);
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining(`[api.anexos.download] ref=${ref}`));
  });
});

describe("GET /api/anexos/[id]/texto", () => {
  it("texto extraído como text/plain; sem texto → 404 explicando", async () => {
    usuarioAtual.mockResolvedValue({ id: "x", papel: "VISUALIZADOR" });
    lerTextoDoAnexo.mockResolvedValueOnce({ id: ID, nome: "a.pdf", semTexto: false, texto: "<b>oi</b>" });
    let r = await GET_TEXTO(req(), ctx());
    expect(r.status).toBe(200);
    expect(r.headers.get("content-type")).toBe("text/plain; charset=utf-8");
    expect(r.headers.get("x-content-type-options")).toBe("nosniff");
    expect(await r.text()).toBe("<b>oi</b>");
    lerTextoDoAnexo.mockResolvedValueOnce({ id: ID, nome: "a.png", semTexto: true, texto: null });
    r = await GET_TEXTO(req(), ctx());
    expect(r.status).toBe(404);
    expect(await r.text()).toMatch(/sem texto/);
  });

  it("sem sessão → 401", async () => {
    usuarioAtual.mockResolvedValue(null);
    expect((await GET_TEXTO(req(), ctx())).status).toBe(401);
    expect(lerTextoDoAnexo).not.toHaveBeenCalled();
  });
});
