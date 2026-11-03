import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Documento } from "@/lib/propostas/documento";

const acoes = vi.hoisted(() => ({ comentarAction: vi.fn(), responderComentarioAction: vi.fn(), resolverComentarioAction: vi.fn() }));
vi.mock("./comentarios-actions", () => acoes);

const { ATRASO_TEXTO_MS, BotaoComentarTrecho, ComentariosProvider, INTERVALO_COMENTARIOS_MS, SESSAO_EXPIRADA, TextoComentavel, useComentarios } = await import("./comentarios-contexto");
const { PainelComentarios } = await import("./painel-comentarios");

const doc: Documento = { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Prazo de 30 dias para o site." }] }] };

const thread = (over: object = {}) => ({
  id: "c1",
  autor: { id: "u2", nome: "Paula" },
  texto: "30 é pouco <b>mesmo</b>",
  criadoEm: "2026-11-03T12:00:00.000Z",
  viaMcp: false,
  ancora: { trecho: "30 dias", antes: "Prazo de ", depois: " para o site." },
  trechoAlterado: false,
  resolvido: null,
  respostas: [],
  ...over,
});

let fetchMock: ReturnType<typeof vi.fn>;
const resposta = (corpo: object, status = 200) => Promise.resolve(new Response(JSON.stringify(corpo), { status }));

function montar(threads = [thread()], documento = doc) {
  return render(
    <ComentariosProvider projetoId="p1" euId="u1" inicial={{ versao: "1.1", threads }}>
      <BotaoComentarTrecho />
      <TextoComentavel documento={documento} />
      <PainelComentarios />
    </ComentariosProvider>,
  );
}

function ocultar(oculta: boolean) {
  Object.defineProperty(document, "hidden", { configurable: true, get: () => oculta });
  document.dispatchEvent(new Event("visibilitychange"));
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  fetchMock = vi.fn(() => resposta({ versao: "1.1" }));
  vi.stubGlobal("fetch", fetchMock);
  ocultar(false);
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("comentários ao vivo", () => {
  it("mostra a thread com o trecho e realça o trecho no texto; HTML do comentário sai como texto", () => {
    montar();
    expect(screen.getByText("30 é pouco <b>mesmo</b>")).toBeTruthy();
    expect([...document.querySelectorAll("b")].some((b) => b.textContent === "mesmo")).toBe(false);
    expect(document.querySelector("mark[data-comentario='c1']")?.textContent).toBe("30 dias");
    expect(screen.queryByText("trecho alterado")).toBeNull();
  });

  it("trecho que não está mais no texto: 'trecho alterado', sem realce, comentário visível", () => {
    montar([thread()], { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Prazo de 45 dias." }] }] });
    expect(screen.getByText("trecho alterado")).toBeTruthy();
    expect(document.querySelector("mark")).toBeNull();
    expect(screen.getByText("30 é pouco <b>mesmo</b>")).toBeTruthy();
  });

  it("polling a cada 5 s com a versão; comentário novo aparece sozinho; pausa com a aba oculta", async () => {
    montar([]);
    expect(screen.getByText("Nenhum comentário ainda.")).toBeTruthy();
    fetchMock.mockImplementationOnce(() => resposta({ versao: "2.2", comentarios: [thread({ texto: "Novo da Paula" })] }));
    await act(async () => vi.advanceTimersByTimeAsync(INTERVALO_COMENTARIOS_MS));
    expect(fetchMock).toHaveBeenCalledWith("/api/projetos/p1/comentarios?v=1.1", { cache: "no-store" });
    expect(screen.getByText("Novo da Paula")).toBeTruthy();

    await act(async () => vi.advanceTimersByTimeAsync(INTERVALO_COMENTARIOS_MS));
    expect(fetchMock).toHaveBeenLastCalledWith("/api/projetos/p1/comentarios?v=2.2", { cache: "no-store" });
    const n = fetchMock.mock.calls.length;
    act(() => ocultar(true));
    await act(async () => vi.advanceTimersByTimeAsync(INTERVALO_COMENTARIOS_MS * 4));
    expect(fetchMock.mock.calls.length).toBe(n);
    await act(async () => ocultar(false)); // volta: consulta na hora
    expect(fetchMock.mock.calls.length).toBe(n + 1);
  });

  it("erro do servidor no polling mostra a ref do log", async () => {
    montar([]);
    fetchMock.mockImplementationOnce(() => resposta({ erro: "Erro no servidor.", ref: "abcd1234" }, 500));
    await act(async () => vi.advanceTimersByTimeAsync(INTERVALO_COMENTARIOS_MS));
    expect(screen.getByRole("alert").textContent).toContain("ref: abcd1234");
  });

  it("comentário geral: chama a action e recarrega; erro inesperado mostra a ref", async () => {
    montar([]);
    acoes.comentarAction.mockResolvedValueOnce({ ok: false, erro: "INESPERADO", ref: "f00dbabe" });
    fireEvent.change(screen.getByLabelText("Comentário geral"), { target: { value: "Faltou o valor" } });
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Comentar" })));
    expect(acoes.comentarAction).toHaveBeenCalledWith("p1", "Faltou o valor", null);
    expect(screen.getByRole("alert").textContent).toContain("ref: f00dbabe");

    acoes.comentarAction.mockResolvedValueOnce({ ok: true });
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Comentar" })));
    expect(fetchMock).toHaveBeenCalled();
    expect((screen.getByLabelText("Comentário geral") as HTMLTextAreaElement).value).toBe("");
  });

  it("'Comentar trecho' cita a seleção do texto; sem seleção, explica", async () => {
    montar([]);
    fireEvent.click(screen.getByRole("button", { name: /Comentar trecho/ }));
    expect(screen.getByRole("status").textContent).toMatch(/Selecione um trecho/);

    const no = document.querySelector("[data-o]")!.firstChild!;
    const r = document.createRange();
    r.setStart(no, 9);
    r.setEnd(no, 16);
    window.getSelection()!.removeAllRanges();
    window.getSelection()!.addRange(r);
    fireEvent.click(screen.getByRole("button", { name: /Comentar trecho/ }));
    expect(screen.getByText("“30 dias”")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Comentário sobre o trecho"), { target: { value: "pouco" } });
    acoes.comentarAction.mockResolvedValueOnce({ ok: true });
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Comentar" })));
    expect(acoes.comentarAction).toHaveBeenCalledWith("p1", "pouco", { trecho: "30 dias", antes: "Prazo de ", depois: " para o site." });
  });

  it("resolver, reabrir e responder chamam as actions", async () => {
    montar([thread(), thread({ id: "c2", ancora: null, texto: "geral", resolvido: { por: "Ana", em: "2026-11-03T13:00:00.000Z" } })]);
    acoes.resolverComentarioAction.mockResolvedValue({ ok: true });
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Resolver" })));
    expect(acoes.resolverComentarioAction).toHaveBeenCalledWith("c1", true);

    fireEvent.click(screen.getByRole("button", { name: "Ver resolvidos (1)" }));
    expect(screen.getByText(/Resolvido por Ana/)).toBeTruthy();
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Reabrir" })));
    expect(acoes.resolverComentarioAction).toHaveBeenCalledWith("c2", false);

    acoes.responderComentarioAction.mockResolvedValue({ ok: true });
    fireEvent.click(screen.getAllByRole("button", { name: "Responder" })[0]);
    fireEvent.change(screen.getByLabelText("Sua resposta"), { target: { value: "concordo" } });
    await act(async () => fireEvent.submit(screen.getByLabelText("Sua resposta").closest("form")!));
    expect(acoes.responderComentarioAction).toHaveBeenCalledWith("c1", "concordo");
  });

  it("401: para o polling e pede para recarregar", async () => {
    montar([]);
    fetchMock.mockImplementationOnce(() => resposta({ erro: "Sessão expirada." }, 401));
    await act(async () => vi.advanceTimersByTimeAsync(INTERVALO_COMENTARIOS_MS));
    expect(screen.getByRole("alert").textContent).toBe(SESSAO_EXPIRADA);
    const n = fetchMock.mock.calls.length;
    await act(async () => vi.advanceTimersByTimeAsync(INTERVALO_COMENTARIOS_MS * 3));
    await act(async () => ocultar(false));
    expect(fetchMock.mock.calls.length).toBe(n);
  });

  it("respostas fora de ordem: a velha que chega depois é descartada", async () => {
    montar([]);
    let soltarVelha: (r: Response) => void = () => undefined;
    fetchMock.mockImplementationOnce(() => new Promise<Response>((ok) => (soltarVelha = ok)));
    fetchMock.mockImplementationOnce(() => resposta({ versao: "3.3", comentarios: [thread({ texto: "Novo" })] }));
    await act(async () => vi.advanceTimersByTimeAsync(INTERVALO_COMENTARIOS_MS)); // 1ª (fica pendurada)
    await act(async () => vi.advanceTimersByTimeAsync(INTERVALO_COMENTARIOS_MS)); // 2ª chega
    expect(screen.getByText("Novo")).toBeTruthy();
    await act(async () => soltarVelha(new Response(JSON.stringify({ versao: "2.2", comentarios: [] }))));
    expect(screen.getByText("Novo")).toBeTruthy();
  });

  it("texto do editor: 'trecho alterado' recalculado com pausa e no formato canônico (dois espaços acham o trecho)", async () => {
    let informar: ((d: Documento) => void) | undefined;
    function Fonte() {
      informar = useComentarios()!.informarTexto;
      return null;
    }
    const p = (t: string): Documento => ({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: t }] }] });
    render(
      <ComentariosProvider projetoId="p1" euId="u1" inicial={{ versao: "1.1", threads: [thread()] }}>
        <Fonte />
        <PainelComentarios />
      </ComentariosProvider>,
    );
    act(() => informar!(p("Prazo de  30   dias para o site."))); // 1ª vez: na hora; espaços extras não importam
    expect(screen.queryByText("trecho alterado")).toBeNull();
    act(() => informar!(p("Prazo de 45 dias.")));
    expect(screen.queryByText("trecho alterado")).toBeNull(); // ainda na pausa
    await act(async () => vi.advanceTimersByTimeAsync(ATRASO_TEXTO_MS));
    expect(screen.getByText("trecho alterado")).toBeTruthy();
  });
});
