// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const { usuarioAtual, pdfDaProposta, pdfDoRascunho } = vi.hoisted(() => ({ usuarioAtual: vi.fn(), pdfDaProposta: vi.fn(), pdfDoRascunho: vi.fn() }));
vi.mock("@/lib/auth/atual", () => ({ usuarioAtual }));
vi.mock("@/lib/propostas/propostas", async (orig) => ({ ...(await orig<typeof import("@/lib/propostas/propostas")>()), pdfDaProposta, pdfDoRascunho }));

import { GET } from "./route";

const ctx = (id = "p1") => ({ params: Promise.resolve({ id }) });
const req = (q = "") => new Request(`http://localhost:3037/api/projetos/p1/proposta/pdf${q}`);

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("GET /api/projetos/[id]/proposta/pdf (GAB-89)", () => {
  it("sem sessão → 401 sem gerar nada", async () => {
    usuarioAtual.mockResolvedValue(null);
    expect((await GET(req(), ctx())).status).toBe(401);
    expect(pdfDaProposta).not.toHaveBeenCalled();
  });

  it("quem vê a proposta baixa: attachment com o nome, application/pdf, sem cache", async () => {
    usuarioAtual.mockResolvedValue({ id: "x", papel: "ADMIN", area: null, cargos: [] });
    pdfDaProposta.mockResolvedValue({ ok: true, bytes: new Uint8Array([37, 80, 68, 70]), numero: 2, nomeArquivo: "Proposta - Padaria São João - v2.pdf" });
    const r = await GET(req("?versao=2"), ctx());
    expect(r.status).toBe(200);
    expect(pdfDaProposta).toHaveBeenCalledWith("p1", 2);
    expect(r.headers.get("content-type")).toBe("application/pdf");
    expect(r.headers.get("content-disposition")).toContain("filename*=UTF-8''Proposta%20-%20Padaria%20S%C3%A3o%20Jo%C3%A3o%20-%20v2.pdf");
    expect(r.headers.get("cache-control")).toContain("no-store");
    expect([...new Uint8Array(await r.arrayBuffer())]).toEqual([37, 80, 68, 70]);
  });

  it("GAB-100: rascunho=1 é a prévia, aberta no navegador; não passa pelo PDF de envio", async () => {
    usuarioAtual.mockResolvedValue({ id: "x", papel: "ADMIN", area: null, cargos: [] });
    pdfDoRascunho.mockResolvedValue({ ok: true, bytes: new Uint8Array([37, 80, 68, 70]), nomeArquivo: "Proposta - Site - rascunho.pdf" });
    const r = await GET(req("?rascunho=1"), ctx());
    expect(r.status).toBe(200);
    expect(pdfDoRascunho).toHaveBeenCalledWith("p1");
    expect(pdfDaProposta).not.toHaveBeenCalled();
    expect(r.headers.get("content-disposition")).toMatch(/^inline; filename=/);
  });

  it("regra → texto em português: versão velha 409, proposta inexistente 404, link torto 400", async () => {
    usuarioAtual.mockResolvedValue({ id: "x", papel: "ADMIN", area: null, cargos: [] });
    pdfDaProposta.mockResolvedValueOnce({ ok: false, erro: "VERSAO_FINAL_MUDOU" });
    const r = await GET(req("?versao=1"), ctx());
    expect(r.status).toBe(409);
    expect(await r.text()).toMatch(/versão final da proposta mudou/);
    pdfDaProposta.mockResolvedValueOnce({ ok: false, erro: "PROPOSTA_NAO_ENCONTRADA" });
    expect((await GET(req(), ctx())).status).toBe(404);
    expect((await GET(req("?versao=abc"), ctx())).status).toBe(400);
  });

  it("limite de gerações simultâneas → 503 com mensagem, ref (a mesma do log) e retry-after", async () => {
    usuarioAtual.mockResolvedValue({ id: "x", papel: "ADMIN", area: null, cargos: [] });
    pdfDaProposta.mockResolvedValue({ ok: false, erro: "PDF_OCUPADO" });
    const aviso = vi.spyOn(console, "warn").mockImplementation(() => {});
    const r = await GET(req(), ctx());
    expect(r.status).toBe(503);
    const ref = r.headers.get("x-erro-ref")!;
    expect(ref).toMatch(/^[0-9a-f]{8}$/);
    expect(r.headers.get("retry-after")).toBe("5");
    const texto = await r.text();
    expect(texto).toMatch(/já está gerando 2 PDFs/);
    expect(texto).toContain(`(ref: ${ref})`);
    expect(aviso).toHaveBeenCalledWith(expect.stringContaining(`[api.proposta.pdf] ref=${ref} PDF_OCUPADO`));
  });

  it("erro inesperado → 500 com a ref no corpo e no header (a mesma do log)", async () => {
    usuarioAtual.mockResolvedValue({ id: "x", papel: "ADMIN", area: null, cargos: [] });
    pdfDaProposta.mockRejectedValue(new Error("fonte sumiu"));
    const r = await GET(req(), ctx());
    expect(r.status).toBe(500);
    const ref = r.headers.get("x-erro-ref")!;
    expect(ref).toMatch(/^[0-9a-f]{8}$/);
    expect(await r.text()).toContain(ref);
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining(`[api.proposta.pdf] ref=${ref}`));
  });

  it("GAB-98: quem não vê a proposta → 403, sem gerar", async () => {
    usuarioAtual.mockResolvedValue({ id: "x", papel: "VISUALIZADOR", area: null, cargos: [] });
    pdfDaProposta.mockClear();
    const r = await GET(req(""), ctx());
    expect(r.status).toBe(403);
    expect(pdfDaProposta).not.toHaveBeenCalled();
  });
});
