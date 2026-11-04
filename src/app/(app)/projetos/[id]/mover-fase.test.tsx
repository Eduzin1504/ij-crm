import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { refresh, moverCardAction, enviarContratoAssinado } = vi.hoisted(() => ({ refresh: vi.fn(), moverCardAction: vi.fn(), enviarContratoAssinado: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
vi.mock("../../kanban/actions", () => ({ moverCardAction }));
vi.mock("@/lib/projetos/contrato-assinado-cliente", () => ({ enviarContratoAssinado }));

import { MoverFase } from "./mover-fase";

const fase = (id: string, nome: string, tipoTerminal: "GANHO" | null = null) => ({ id, chave: id, nome, cor: null, limiteDiasAlerta: null, isTerminal: tipoTerminal !== null, tipoTerminal });

function montar(props: { ganhoId?: string | null; somenteLeitura?: boolean } = {}) {
  render(
    <MoverFase
      cardId="c1"
      titulo="Site"
      faseAtualId="mc"
      pipelineChave="vendas"
      fechamento={{ valorFechado: null, motivoPerda: null }}
      fases={[fase("mc", "Montando contrato"), fase("ganho", "Contrato assinado", "GANHO")]}
      {...props}
    />,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  moverCardAction.mockResolvedValue({ ok: true });
  enviarContratoAssinado.mockResolvedValue({ ok: true });
});

describe("MoverFase: botão Contrato assinado (GAB-99)", () => {
  it("só aparece com ganhoId e para quem escreve", () => {
    montar();
    expect(screen.queryByRole("button", { name: "Contrato assinado" })).toBeNull();
  });

  it("VISUALIZADOR não vê", () => {
    montar({ ganhoId: "ganho", somenteLeitura: true });
    expect(screen.queryByRole("button", { name: "Contrato assinado" })).toBeNull();
  });

  it("sem PDF: move pela action, com o valor do diálogo", async () => {
    montar({ ganhoId: "ganho" });
    fireEvent.click(screen.getByRole("button", { name: "Contrato assinado" }));
    fireEvent.change(await screen.findByLabelText("Valor fechado (opcional)"), { target: { value: "12.500,00" } });
    fireEvent.click(screen.getByRole("button", { name: "Marcar como ganho" }));
    await waitFor(() => expect(moverCardAction).toHaveBeenCalledWith("c1", "ganho", { valorFechado: "12.500,00" }));
    expect(enviarContratoAssinado).not.toHaveBeenCalled();
  });

  it("com PDF: vai pela rota e atualiza a página; erro da rota aparece com a ref", async () => {
    enviarContratoAssinado.mockResolvedValueOnce({ ok: false, erro: "INESPERADO", ref: "abc123" });
    montar({ ganhoId: "ganho" });
    fireEvent.click(screen.getByRole("button", { name: "Contrato assinado" }));
    const pdf = new File(["%PDF-"], "contrato.pdf", { type: "application/pdf" });
    fireEvent.change(await screen.findByLabelText("Contrato assinado em PDF (opcional)"), { target: { files: [pdf] } });
    fireEvent.click(screen.getByRole("button", { name: "Marcar como ganho" }));
    await waitFor(() => expect(enviarContratoAssinado).toHaveBeenCalledWith("c1", { valorFechado: "" }, pdf));
    expect(await screen.findByText(/abc123/)).toBeInTheDocument();
    expect(moverCardAction).not.toHaveBeenCalled();
    expect(refresh).toHaveBeenCalled();
  });
});

describe("MoverFase: reabrir card perdido por proposta inviável (GAB-98)", () => {
  const FASES = [fase("a", "Em negociação"), { ...fase("p", "Perdido"), tipoTerminal: "PERDIDO" as const, isTerminal: true }];
  const abrir = (veProposta: boolean, motivoPerda: string) =>
    render(<MoverFase cardId="c1" titulo="Site" faseAtualId="p" pipelineChave="vendas" fechamento={{ valorFechado: null, motivoPerda }} veProposta={veProposta} responsavelNome="Ana" fases={FASES} />);

  it("quem vê a proposta é avisado de Em ajuste e do motivo; só move ao confirmar", async () => {
    moverCardAction.mockClear();
    abrir(true, "Outro: Proposta inviável");
    fireEvent.change(screen.getByLabelText("Fase"), { target: { value: "a" } });
    expect(await screen.findByText(/Em ajuste/)).toHaveTextContent(/limpa o motivo/);
    expect(moverCardAction).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Reabrir" }));
    await waitFor(() => expect(moverCardAction).toHaveBeenCalledTimes(1));
  });

  it("quem não vê a proposta recebe a sugestão de falar com o responsável", async () => {
    abrir(false, "Outro: Proposta inviável");
    fireEvent.change(screen.getByLabelText("Fase"), { target: { value: "a" } });
    expect(await screen.findByText(/Fale com Ana/)).toBeInTheDocument();
    expect(screen.queryByText(/Em ajuste/)).toBeNull();
  });

  it("perda por outro motivo reabre direto", async () => {
    moverCardAction.mockClear();
    abrir(true, "Preço: achou caro");
    fireEvent.change(screen.getByLabelText("Fase"), { target: { value: "a" } });
    await waitFor(() => expect(moverCardAction).toHaveBeenCalledTimes(1));
    expect(screen.queryByText(/Em ajuste/)).toBeNull();
  });
});
