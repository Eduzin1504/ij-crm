import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const acao = vi.hoisted(() => ({ marcar: vi.fn() }));
vi.mock("./sino-actions", () => ({ marcarAvisosLidosAction: acao.marcar }));

import { INTERVALO_SINO_MS, Sino } from "./sino";

const fetchMock = vi.fn();
let oculto = false;

function resposta(corpo: unknown, status = 200) {
  return Promise.resolve(new Response(JSON.stringify(corpo), { status, headers: { "content-type": "application/json" } }));
}

const AVISO = { id: "a1", tipo: "SUA_VEZ", titulo: 'Ana devolveu para você a proposta de "Site"', href: "/projetos/p1/proposta", lido: false, criadoEm: "2026-11-03T13:00:00.000Z", whatsappFalhouRef: null };

beforeEach(() => {
  vi.useFakeTimers();
  oculto = false;
  Object.defineProperty(document, "hidden", { configurable: true, get: () => oculto });
  fetchMock.mockReset();
  fetchMock.mockImplementation((url: string) => (url.includes("lista=1") ? resposta({ naoLidos: 2, avisos: [AVISO, { ...AVISO, id: "a2", lido: true, titulo: "Velho", whatsappFalhouRef: "abcd1234" }] }) : resposta({ naoLidos: 2 })));
  vi.stubGlobal("fetch", fetchMock);
  acao.marcar.mockReset();
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const contagens = () => fetchMock.mock.calls.filter(([u]) => u === "/api/avisos").length;
const flush = () => act(async () => {
  await vi.advanceTimersByTimeAsync(0);
});

describe("sino de avisos (GAB-88)", () => {
  it("conta ao montar, a cada 30 s, e pausa com a aba oculta (volta consultando)", async () => {
    render(<Sino />);
    await flush();
    expect(contagens()).toBe(1);
    expect(screen.getByRole("button", { name: "Avisos: 2 não lidos" })).toHaveTextContent("2");

    await act(async () => {
      await vi.advanceTimersByTimeAsync(INTERVALO_SINO_MS);
    });
    expect(contagens()).toBe(2);

    oculto = true;
    act(() => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(INTERVALO_SINO_MS * 3);
    });
    expect(contagens()).toBe(2);

    oculto = false;
    act(() => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await flush();
    expect(contagens()).toBe(3);
  });

  it("aberto: lista com link, não lidos marcados, falha do WhatsApp com ref; marcar um e todos", async () => {
    acao.marcar.mockResolvedValueOnce({ ok: true, naoLidos: 1 }).mockResolvedValueOnce({ ok: true, naoLidos: 0 });
    render(<Sino />);
    await flush();
    fireEvent.click(screen.getByRole("button", { name: /Avisos/ }));
    await flush();
    expect(screen.getByRole("link", { name: AVISO.titulo })).toHaveAttribute("href", "/projetos/p1/proposta");
    expect(screen.getAllByLabelText("não lido")).toHaveLength(1);
    expect(screen.getByText("abcd1234")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Marcar como lido" }));
    await flush();
    expect(acao.marcar).toHaveBeenLastCalledWith(["a1"]);
    expect(screen.queryAllByLabelText("não lido")).toHaveLength(0);
    expect(screen.getByRole("button", { name: "Avisos: 1 não lido" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Marcar todos como lidos" }));
    await flush();
    expect(acao.marcar).toHaveBeenLastCalledWith(undefined);
    expect(screen.getByRole("button", { name: "Avisos" })).toBeInTheDocument();
  });

  it("erro do servidor mostra a ref do log", async () => {
    fetchMock.mockImplementation((url: string) => (url.includes("lista=1") ? resposta({ erro: "Erro no servidor.", ref: "deadbeef" }, 500) : resposta({ naoLidos: 0 })));
    render(<Sino />);
    await flush();
    fireEvent.click(screen.getByRole("button", { name: "Avisos" }));
    await flush();
    expect(screen.getByRole("alert")).toHaveTextContent("ref: deadbeef");
  });

  it("falha ao marcar mostra a ref", async () => {
    acao.marcar.mockResolvedValueOnce({ ok: false, erro: "INESPERADO", ref: "cafe0001" });
    render(<Sino />);
    await flush();
    fireEvent.click(screen.getByRole("button", { name: /Avisos/ }));
    await flush();
    fireEvent.click(screen.getByRole("button", { name: "Marcar todos como lidos" }));
    await flush();
    expect(screen.getByRole("alert")).toHaveTextContent("ref: cafe0001");
  });
});
