// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  exigirUsuario: vi.fn(),
  exigirEscrita: vi.fn(),
  comentar: vi.fn(),
  responderComentario: vi.fn(),
  resolverComentario: vi.fn(),
  reabrirComentario: vi.fn(),
}));
vi.mock("@/lib/auth/atual", () => ({ exigirUsuario: m.exigirUsuario, exigirEscrita: m.exigirEscrita }));
vi.mock("@/lib/propostas/comentarios", async (orig) => ({
  ...(await orig<typeof import("@/lib/propostas/comentarios")>()),
  comentar: m.comentar,
  responderComentario: m.responderComentario,
  resolverComentario: m.resolverComentario,
  reabrirComentario: m.reabrirComentario,
}));

import { comentarAction, resolverComentarioAction, responderComentarioAction } from "./comentarios-actions";

const vera = { id: "u9", papel: "VISUALIZADOR" };
beforeEach(() => {
  vi.clearAllMocks();
  m.exigirUsuario.mockResolvedValue(vera);
});

describe("actions de comentário", () => {
  it("qualquer usuário logado (VISUALIZADOR também): usa exigirUsuario, não exigirEscrita", async () => {
    m.comentar.mockResolvedValue({ ok: true, comentario: { id: "c1" } });
    expect(await comentarAction("p1", "oi", null)).toEqual({ ok: true });
    expect(m.comentar).toHaveBeenCalledWith("p1", { texto: "oi", trecho: null }, vera);
    expect(m.exigirEscrita).not.toHaveBeenCalled();
  });

  it("âncora da tela validada; formato inválido → 'Dados inválidos' sem chamar o serviço", async () => {
    m.comentar.mockResolvedValue({ ok: true, comentario: { id: "c1" } });
    await comentarAction("p1", "oi", { trecho: "30 dias", antes: "de ", depois: "." });
    expect(m.comentar).toHaveBeenLastCalledWith("p1", { texto: "oi", trecho: { trecho: "30 dias", antes: "de ", depois: "." } }, vera);
    m.comentar.mockClear();
    expect(await comentarAction("p1", "oi", { trecho: "" })).toEqual({ ok: false, erro: "Dados inválidos." });
    expect(await comentarAction("", "oi", null)).toEqual({ ok: false, erro: "Dados inválidos." });
    expect(m.comentar).not.toHaveBeenCalled();
  });

  it("erro de regra vira texto; exceção vira INESPERADO com a ref do log", async () => {
    m.responderComentario.mockResolvedValue({ ok: false, erro: "TEXTO_VAZIO" });
    expect(await responderComentarioAction("c1", " ")).toEqual({ ok: false, erro: "Escreva o comentário." });
    const erro = vi.spyOn(console, "error").mockImplementation(() => undefined);
    m.resolverComentario.mockRejectedValue(new Error("banco fora"));
    const r = await resolverComentarioAction("c1", true);
    expect(r).toMatchObject({ ok: false, erro: "INESPERADO", ref: expect.stringMatching(/^[0-9a-f]{8}$/) });
    expect(erro.mock.calls.some((c) => String(c[0]).includes(`ref=${(r as { ref: string }).ref}`))).toBe(true);
  });

  it("reabrir usa o serviço de reabrir", async () => {
    m.reabrirComentario.mockResolvedValue({ ok: true });
    expect(await resolverComentarioAction("c1", false)).toEqual({ ok: true });
    expect(m.reabrirComentario).toHaveBeenCalledWith("c1", vera);
  });
});
