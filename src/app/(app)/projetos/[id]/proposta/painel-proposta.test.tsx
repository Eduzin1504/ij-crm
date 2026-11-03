import { act, fireEvent, render, screen } from "@testing-library/react";
import { useImperativeHandle, type Ref } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ControleEditor } from "@/components/propostas/editor-texto";
import type { Documento } from "@/lib/propostas/documento";

const acoes = vi.hoisted(() => ({
  salvarTextoAction: vi.fn(),
  salvarEstruturadoAction: vi.fn(),
  salvarVersaoAction: vi.fn(),
  criarPropostaAction: vi.fn(),
  passarCanetaAction: vi.fn(),
  devolverAction: vi.fn(),
  concordarAction: vi.fn(),
  pegarCanetaAction: vi.fn(),
  reabrirAction: vi.fn(),
  marcarInviavelAction: vi.fn(),
}));
const refresh = vi.hoisted(() => vi.fn());
const substituido = vi.hoisted(() => ({ doc: null as unknown }));

vi.mock("./actions", () => acoes);
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
// Editor falso (o Tiptap de verdade é testado em editor-texto.test): textarea → documento de um parágrafo.
vi.mock("next/dynamic", () => ({
  default: () =>
    function EditorFalso({ aoMudar, controle }: { aoMudar: (d: Documento) => void; controle?: Ref<ControleEditor> }) {
      const doc = (t: string): Documento => ({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: t }] }] });
      let atual = doc("inicial");
      useImperativeHandle(controle, () => ({ documento: () => atual, substituir: (d) => (substituido.doc = d) }));
      return (
        <textarea
          aria-label="texto"
          onChange={(e) => {
            atual = doc(e.target.value);
            aoMudar(atual);
          }}
        />
      );
    },
}));

const { PainelProposta } = await import("./painel-proposta");

const vazio = { valor: "", prazoDias: "", escopoResumo: "", entregas: [] };
const montar = () =>
  render(<PainelProposta projetoId="p1" revisao={4} documento={{ type: "doc", content: [] }} estruturado={vazio} ultimaVersao={null} />);

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
});
afterEach(() => vi.useRealTimers());

describe("PainelProposta", () => {
  it("autosave manda o texto com a revisão e mostra 'salvo'", async () => {
    acoes.salvarTextoAction.mockResolvedValue({ ok: true, revisao: 5 });
    montar();
    fireEvent.change(screen.getByLabelText("texto"), { target: { value: "olá" } });
    expect(screen.getByText("Alterações não salvas…")).toBeInTheDocument();
    await act(() => vi.advanceTimersByTimeAsync(1500));
    expect(acoes.salvarTextoAction).toHaveBeenCalledWith("p1", 4, { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "olá" }] }] });
    expect(screen.getByText(/Rascunho salvo às/)).toBeInTheDocument();
  });

  it("conflito: avisa quem mexeu, não grava de novo sozinho, e deixa escolher", async () => {
    const docServidor = { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "do Claude" }] }] };
    acoes.salvarTextoAction.mockResolvedValueOnce({
      ok: false,
      erro: "conflito",
      conflito: { revisao: 7, por: "Gil", viaMcp: true, em: null, documento: docServidor, estruturado: vazio },
    });
    montar();
    fireEvent.change(screen.getByLabelText("texto"), { target: { value: "meu" } });
    await act(() => vi.advanceTimersByTimeAsync(1500));
    expect(screen.getByRole("alert")).toHaveTextContent(/alterada em outro lugar por Gil \(via MCP\)/);
    fireEvent.change(screen.getByLabelText("texto"), { target: { value: "meu 2" } });
    await act(() => vi.advanceTimersByTimeAsync(5000));
    expect(acoes.salvarTextoAction).toHaveBeenCalledTimes(1);

    acoes.salvarTextoAction.mockResolvedValueOnce({ ok: true, revisao: 8 });
    fireEvent.click(screen.getByRole("button", { name: "Manter o meu texto e sobrescrever" }));
    await act(() => vi.advanceTimersByTimeAsync(0));
    expect(acoes.salvarTextoAction).toHaveBeenLastCalledWith("p1", 7, expect.objectContaining({ type: "doc" }));
    expect(screen.queryByText(/alterada em outro lugar/)).toBeNull();
  });

  it("conflito → 'carregar a versão atual' troca o texto do editor pelo do servidor", async () => {
    const docServidor = { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "do servidor" }] }] };
    acoes.salvarTextoAction.mockResolvedValueOnce({ ok: false, erro: "c", conflito: { revisao: 9, por: null, viaMcp: false, em: null, documento: docServidor, estruturado: vazio } });
    montar();
    fireEvent.change(screen.getByLabelText("texto"), { target: { value: "x" } });
    await act(() => vi.advanceTimersByTimeAsync(1500));
    fireEvent.click(screen.getByRole("button", { name: /Carregar a versão atual/ }));
    expect(substituido.doc).toEqual(docServidor);
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("erro inesperado mostra a ref do log e 'tentar de novo'", async () => {
    acoes.salvarTextoAction.mockResolvedValueOnce({ ok: false, erro: "INESPERADO", ref: "a1b2c3d4" });
    montar();
    fireEvent.change(screen.getByLabelText("texto"), { target: { value: "x" } });
    await act(() => vi.advanceTimersByTimeAsync(1500));
    expect(screen.getByRole("alert")).toHaveTextContent("Não foi possível salvar. Erro no servidor. (ref: a1b2c3d4)");
    acoes.salvarTextoAction.mockResolvedValueOnce({ ok: true, revisao: 5 });
    fireEvent.click(screen.getByRole("button", { name: "Tentar de novo" }));
    await act(() => vi.advanceTimersByTimeAsync(0));
    expect(acoes.salvarTextoAction).toHaveBeenCalledTimes(2);
  });

  it("salvar versão manda o texto do editor e a nota; mostra o número", async () => {
    acoes.salvarVersaoAction.mockResolvedValue({ ok: true, revisao: 4, numero: 1 });
    montar();
    fireEvent.change(screen.getByLabelText("Nota da versão (opcional)"), { target: { value: "primeira" } });
    fireEvent.click(screen.getByRole("button", { name: "Salvar versão" }));
    await act(() => vi.advanceTimersByTimeAsync(0));
    expect(acoes.salvarVersaoAction).toHaveBeenCalledWith("p1", 4, { documento: expect.objectContaining({ type: "doc" }), nota: "primeira" });
    expect(screen.getByText("Versão v1 salva.")).toBeInTheDocument();
    expect(refresh).toHaveBeenCalled();
  });

  it("manter o meu texto: dados sem alteração local passam a ser os do servidor (o próximo 'Salvar dados' não desfaz a mudança do outro)", async () => {
    const dadosServidor = { valor: "25.000,00", prazoDias: "", escopoResumo: "", entregas: [] };
    acoes.salvarTextoAction.mockResolvedValueOnce({
      ok: false,
      erro: "c",
      conflito: { revisao: 6, por: "Gil", viaMcp: true, em: null, documento: { type: "doc", content: [] }, estruturado: dadosServidor },
    });
    montar();
    fireEvent.change(screen.getByLabelText("texto"), { target: { value: "meu" } });
    await act(() => vi.advanceTimersByTimeAsync(1500));
    acoes.salvarTextoAction.mockResolvedValueOnce({ ok: true, revisao: 7 });
    fireEvent.click(screen.getByRole("button", { name: "Manter o meu texto e sobrescrever" }));
    await act(() => vi.advanceTimersByTimeAsync(0));
    expect(screen.getByPlaceholderText("12.500,00")).toHaveValue("25.000,00");
    expect(acoes.salvarEstruturadoAction).not.toHaveBeenCalled();

    acoes.salvarEstruturadoAction.mockResolvedValueOnce({ ok: true, revisao: 8 });
    fireEvent.change(screen.getByPlaceholderText("60"), { target: { value: "30" } });
    fireEvent.click(screen.getByRole("button", { name: "Salvar dados" }));
    await act(() => vi.advanceTimersByTimeAsync(0));
    expect(acoes.salvarEstruturadoAction).toHaveBeenCalledWith("p1", 7, expect.objectContaining({ valor: "25.000,00", prazoDias: "30" }));
  });

  it("manter os meus com dados alterados aqui: a escolha avisa e grava texto e dados por cima", async () => {
    acoes.salvarTextoAction.mockResolvedValueOnce({
      ok: false,
      erro: "c",
      conflito: { revisao: 6, por: "Gil", viaMcp: false, em: null, documento: { type: "doc", content: [] }, estruturado: { ...vazio, valor: "25.000,00" } },
    });
    montar();
    fireEvent.change(screen.getByPlaceholderText("12.500,00"), { target: { value: "30.000,00" } });
    fireEvent.change(screen.getByLabelText("texto"), { target: { value: "meu" } });
    await act(() => vi.advanceTimersByTimeAsync(1500));
    acoes.salvarTextoAction.mockResolvedValueOnce({ ok: true, revisao: 7 });
    acoes.salvarEstruturadoAction.mockResolvedValueOnce({ ok: true, revisao: 8 });
    fireEvent.click(screen.getByRole("button", { name: "Manter os meus (texto e dados) e sobrescrever" }));
    await act(() => vi.advanceTimersByTimeAsync(0));
    expect(acoes.salvarTextoAction).toHaveBeenLastCalledWith("p1", 6, expect.anything());
    expect(acoes.salvarEstruturadoAction).toHaveBeenCalledWith("p1", 7, expect.objectContaining({ valor: "30.000,00" }));
    expect(screen.queryByText("Dados alterados, não salvos")).toBeNull();
  });

  describe("caneta (GAB-87)", () => {
    const caneta = { acoes: ["passar", "devolver", "concordar"] as ("passar" | "devolver" | "concordar")[], mesmoLado: [{ id: "bia", nome: "Bia" }], outroLado: [{ id: "paula", nome: "Paula" }], rotuloOutroLado: "Projetos" };
    const montarComCaneta = () =>
      render(<PainelProposta projetoId="p1" revisao={4} documento={{ type: "doc", content: [] }} estruturado={vazio} ultimaVersao={1} caneta={caneta} />);

    it("devolver grava o pendente antes e manda o editor, a pessoa e a nota com a revisão nova", async () => {
      acoes.salvarTextoAction.mockResolvedValue({ ok: true, revisao: 5 });
      acoes.devolverAction.mockResolvedValue({ ok: true });
      montarComCaneta();
      fireEvent.change(screen.getByLabelText("texto"), { target: { value: "minha parte" } });
      fireEvent.click(screen.getByRole("button", { name: "Devolver" }));
      fireEvent.change(screen.getByLabelText("Devolver para (projetos)"), { target: { value: "paula" } });
      fireEvent.change(screen.getAllByLabelText("Nota da versão (opcional)")[1], { target: { value: "vejam o escopo" } });
      fireEvent.click(screen.getByRole("button", { name: "Salvar versão e devolver" }));
      await act(() => vi.advanceTimersByTimeAsync(0));
      expect(acoes.salvarTextoAction).toHaveBeenCalledTimes(1);
      expect(acoes.devolverAction).toHaveBeenCalledWith("p1", 5, {
        paraId: "paula",
        // (o editor falso volta ao texto inicial a cada render; o que importa é ir o documento do editor)
        documento: expect.objectContaining({ type: "doc" }),
        estruturado: undefined,
        nota: "vejam o escopo",
      });
      expect(refresh).toHaveBeenCalled();
    });

    it("concordar com dados alterados e não salvos é barrado na tela; recusa do servidor aparece com o texto dela", async () => {
      montarComCaneta();
      fireEvent.change(screen.getByPlaceholderText("60"), { target: { value: "30" } });
      fireEvent.click(screen.getByRole("button", { name: "Concordar" }));
      fireEvent.click(screen.getByRole("button", { name: "Confirmar" }));
      await act(() => vi.advanceTimersByTimeAsync(0));
      expect(acoes.concordarAction).not.toHaveBeenCalled();
      expect(screen.getByRole("alert")).toHaveTextContent(/dados da proposta alterados/);
    });

    it("erro inesperado de uma ação da caneta mostra a ref", async () => {
      acoes.passarCanetaAction.mockResolvedValue({ ok: false, erro: "INESPERADO", ref: "beef0001" });
      montarComCaneta();
      fireEvent.click(screen.getByRole("button", { name: "Passar a caneta" }));
      fireEvent.change(screen.getByLabelText("Passar para"), { target: { value: "bia" } });
      fireEvent.click(screen.getByRole("button", { name: "Passar" }));
      await act(() => vi.advanceTimersByTimeAsync(0));
      expect(acoes.passarCanetaAction).toHaveBeenCalledWith("p1", "bia");
      expect(screen.getByRole("alert")).toHaveTextContent("Não foi possível passar a caneta. Erro no servidor. (ref: beef0001)");
      expect(refresh).not.toHaveBeenCalled();
    });

    it("ação de caneta devolve a revisão nova e o editor a adota (sem conflito falso na próxima digitação)", async () => {
      acoes.passarCanetaAction.mockResolvedValue({ ok: true, revisao: 9 });
      acoes.salvarTextoAction.mockResolvedValue({ ok: true, revisao: 10 });
      montarComCaneta();
      fireEvent.click(screen.getByRole("button", { name: "Passar a caneta" }));
      fireEvent.change(screen.getByLabelText("Passar para"), { target: { value: "bia" } });
      fireEvent.click(screen.getByRole("button", { name: "Passar" }));
      await act(() => vi.advanceTimersByTimeAsync(0));
      fireEvent.change(screen.getByLabelText("texto"), { target: { value: "depois" } });
      await act(() => vi.advanceTimersByTimeAsync(1500));
      expect(acoes.salvarTextoAction).toHaveBeenLastCalledWith("p1", 9, expect.anything());
    });
  });
});
