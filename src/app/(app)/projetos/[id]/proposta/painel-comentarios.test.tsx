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
    expect(acoes.comentarAction).toHaveBeenCalledWith("p1", "pouco", { trecho: "30 dias", antes: "Prazo de ", depois: " para o site.\n\uE001\n\uE002" });
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

  it("respostas fora de ordem: a velha (polling) que chega depois da recarga pós-ação é descartada", async () => {
    montar([]);
    let soltarVelha: (r: Response) => void = () => undefined;
    fetchMock.mockImplementationOnce(() => new Promise<Response>((ok) => (soltarVelha = ok)));
    fetchMock.mockImplementationOnce(() => resposta({ versao: "3.3", comentarios: [thread({ texto: "Novo" })] }));
    await act(async () => vi.advanceTimersByTimeAsync(INTERVALO_COMENTARIOS_MS)); // polling (fica pendurado)
    acoes.comentarAction.mockResolvedValueOnce({ ok: true });
    fireEvent.change(screen.getByLabelText("Comentário geral"), { target: { value: "x" } });
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Comentar" }))); // recarga chega
    expect(screen.getByText("Novo")).toBeTruthy();
    await act(async () => soltarVelha(new Response(JSON.stringify({ versao: "2.2", comentarios: [] }))));
    expect(screen.getByText("Novo")).toBeTruthy();
  });

  it("rede lenta (> 5 s): o tick não empilha requisição; a resposta lenta atualiza a tela", async () => {
    montar([]);
    let soltar: (r: Response) => void = () => undefined;
    fetchMock.mockImplementationOnce(() => new Promise<Response>((ok) => (soltar = ok)));
    await act(async () => vi.advanceTimersByTimeAsync(INTERVALO_COMENTARIOS_MS));
    await act(async () => vi.advanceTimersByTimeAsync(INTERVALO_COMENTARIOS_MS * 3)); // ainda pendurada
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await act(async () => soltar(new Response(JSON.stringify({ versao: "2.2", comentarios: [thread({ texto: "Chegou devagar" })] }))));
    expect(screen.getByText("Chegou devagar")).toBeTruthy();
    await act(async () => vi.advanceTimersByTimeAsync(INTERVALO_COMENTARIOS_MS));
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("depois do 401, uma recarga ok (após uma ação) limpa o aviso e retoma o polling", async () => {
    montar([]);
    fetchMock.mockImplementationOnce(() => resposta({ erro: "Sessão expirada." }, 401));
    await act(async () => vi.advanceTimersByTimeAsync(INTERVALO_COMENTARIOS_MS));
    expect(screen.getByRole("alert").textContent).toBe(SESSAO_EXPIRADA);
    acoes.comentarAction.mockResolvedValueOnce({ ok: true });
    fireEvent.change(screen.getByLabelText("Comentário geral"), { target: { value: "x" } });
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Comentar" })));
    expect(screen.queryByText(SESSAO_EXPIRADA)).toBeNull();
    const n = fetchMock.mock.calls.length;
    await act(async () => vi.advanceTimersByTimeAsync(INTERVALO_COMENTARIOS_MS));
    expect(fetchMock.mock.calls.length).toBe(n + 1);
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

  it("rascunho e resposta sobrevivem a fechar o painel no celular (o provider guarda)", () => {
    const Tela = ({ aberto }: { aberto: boolean }) => (
      <ComentariosProvider projetoId="p1" euId="u1" inicial={{ versao: "1.1", threads: [thread()] }}>
        <TextoComentavel documento={doc} />
        {aberto ? <PainelComentarios /> : null}
      </ComentariosProvider>
    );
    const { rerender } = render(<Tela aberto />);
    fireEvent.change(screen.getByLabelText("Comentário geral"), { target: { value: "quase pronto" } });
    fireEvent.click(screen.getByRole("button", { name: /Responder/ }));
    fireEvent.change(screen.getByLabelText("Sua resposta"), { target: { value: "minha resposta" } });
    rerender(<Tela aberto={false} />);
    rerender(<Tela aberto />);
    expect(screen.getByLabelText("Comentário geral")).toHaveValue("quase pronto");
    expect(screen.getByLabelText("Sua resposta")).toHaveValue("minha resposta");
  });

  it("trecho citado de um bloco aparece pelo título; o caractere reservado não vaza", () => {
    montar([thread({ ancora: { trecho: "\uE001", antes: "", depois: "" } })], { type: "doc", content: [{ type: "blocoDados", attrs: { tipo: "cronograma" } }] });
    expect(screen.getByText("“Cronograma”")).toBeTruthy();
  });

  it("tocar num trecho destacado pede para abrir o painel (celular)", () => {
    const Pedido = () => <output data-testid="pedido">{useComentarios()?.pedidoPainel}</output>;
    render(
      <ComentariosProvider projetoId="p1" euId="u1" inicial={{ versao: "1.1", threads: [thread()] }}>
        <TextoComentavel documento={doc} />
        <Pedido />
      </ComentariosProvider>,
    );
    fireEvent.click(document.querySelector("mark[data-comentario='c1']")!);
    expect(screen.getByTestId("pedido")).toHaveTextContent("1");
  });

  it("foco no campo só em citação nova: reabrir o painel não foca de novo", () => {
    let citar: ((a: { trecho: string; antes: string; depois: string }) => void) | undefined;
    const Citador = () => {
      citar = useComentarios()?.citar;
      return null;
    };
    const Tela = ({ aberto }: { aberto: boolean }) => (
      <ComentariosProvider projetoId="p1" euId="u1" inicial={{ versao: "1.1", threads: [] }}>
        <Citador />
        {aberto ? <PainelComentarios /> : null}
      </ComentariosProvider>
    );
    const { rerender } = render(<Tela aberto={false} />);
    act(() => citar!({ trecho: "x", antes: "", depois: "" }));
    rerender(<Tela aberto />);
    const campo = screen.getByLabelText("Comentário sobre o trecho");
    expect(document.activeElement).toBe(campo);
    rerender(<Tela aberto={false} />);
    (document.activeElement as HTMLElement | null)?.blur?.();
    rerender(<Tela aberto />);
    expect(document.activeElement).not.toBe(screen.getByLabelText("Comentário sobre o trecho"));
  });

  it("toque em trecho dentro do editor não pede para abrir o painel", () => {
    const Pedido = () => <output data-testid="pedido">{useComentarios()?.pedidoPainel}</output>;
    render(
      <ComentariosProvider projetoId="p1" euId="u1" inicial={{ versao: "1.1", threads: [] }}>
        <div className="ProseMirror">
          <span data-comentario="c1">trecho</span>
        </div>
        <Pedido />
      </ComentariosProvider>,
    );
    fireEvent.click(screen.getByText("trecho"));
    expect(screen.getByTestId("pedido")).toHaveTextContent("0");
  });
});
