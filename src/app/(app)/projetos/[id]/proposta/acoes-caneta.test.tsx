import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const acoes = vi.hoisted(() => ({
  passarCanetaAction: vi.fn(),
  devolverAction: vi.fn(),
  concordarAction: vi.fn(),
  pegarCanetaAction: vi.fn(),
  reabrirAction: vi.fn(),
  marcarInviavelAction: vi.fn(),
  marcarEnviadaAction: vi.fn(),
  registrarRespostaAction: vi.fn(),
  concluirRevisaoAction: vi.fn(),
}));
const refresh = vi.hoisted(() => vi.fn());
vi.mock("./actions", () => acoes);
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

import { AcoesCaneta } from "./acoes-caneta";

const base = { projetoId: "p1", acoes: [] as never[], mesmoLado: [], outroLado: [], rotuloOutroLado: "Projetos", revisao: 5 };

beforeEach(() => vi.clearAllMocks());

describe("AcoesCaneta: envio e resposta do cliente (GAB-89)", () => {
  it("marcar enviada confirma a versão do PDF e adota a revisão nova", async () => {
    acoes.marcarEnviadaAction.mockResolvedValue({ ok: true, revisao: 6 });
    const aoConcluir = vi.fn();
    render(<AcoesCaneta {...base} envio={["enviar"]} versaoPdf={2} aoConcluir={aoConcluir} />);
    fireEvent.click(screen.getByRole("button", { name: "Marcar como enviada" }));
    expect(screen.getByText(/versão v2/)).toBeInTheDocument();
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Confirmar envio" })));
    expect(acoes.marcarEnviadaAction).toHaveBeenCalledWith("p1", 2);
    expect(aoConcluir).toHaveBeenCalledWith(6);
    expect(refresh).toHaveBeenCalled();
  });

  it("recusada exige motivo (e detalhe em 'outro'); manda motivo e detalhe", async () => {
    acoes.registrarRespostaAction.mockResolvedValue({ ok: true, revisao: 7 });
    render(<AcoesCaneta {...base} envio={["responder"]} />);
    fireEvent.click(screen.getByRole("button", { name: "Registrar resposta do cliente" }));
    const registrar = () => screen.getByRole("button", { name: "Registrar resposta" });
    expect(registrar()).toBeDisabled();
    fireEvent.click(screen.getByLabelText("Recusada"));
    expect(registrar()).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Motivo da recusa"), { target: { value: "outro" } });
    expect(registrar()).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Detalhe do motivo"), { target: { value: "sumiu" } });
    expect(registrar()).toBeEnabled();
    await act(async () => fireEvent.click(registrar()));
    expect(acoes.registrarRespostaAction).toHaveBeenCalledWith("p1", { resposta: "RECUSADA", motivo: "outro", detalhe: "sumiu", pedido: undefined });
  });

  it("erro do servidor aparece (sem refresh)", async () => {
    acoes.registrarRespostaAction.mockResolvedValue({ ok: false, erro: "Quem envia e registra a resposta do cliente é vendas." });
    render(<AcoesCaneta {...base} envio={["responder"]} />);
    fireEvent.click(screen.getByRole("button", { name: "Registrar resposta do cliente" }));
    fireEvent.click(screen.getByLabelText("Aceita"));
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Registrar resposta" })));
    expect(screen.getByText(/é vendas/)).toBeInTheDocument();
    expect(refresh).not.toHaveBeenCalled();
  });

  it("concluir revisão manda o que o editor preparou", async () => {
    acoes.concluirRevisaoAction.mockResolvedValue({ ok: true, revisao: 9 });
    const preparar = vi.fn().mockResolvedValue({ revisao: 8, documento: { type: "doc", content: [] } });
    render(<AcoesCaneta {...base} envio={["concluirRevisao"]} preparar={preparar} />);
    fireEvent.click(screen.getByRole("button", { name: "Concluir revisão" }));
    await act(async () => fireEvent.click(screen.getAllByRole("button", { name: "Concluir revisão" })[1]));
    expect(preparar).toHaveBeenCalledWith("concluirRevisao");
    expect(acoes.concluirRevisaoAction).toHaveBeenCalledWith("p1", 8, { documento: { type: "doc", content: [] }, estruturado: undefined, nota: "" });
  });

  it("sem ações, só as secundárias: não há frase pedindo para fazer algo", () => {
    render(<AcoesCaneta {...base} secundarias={<a href="/x">Ver PDF</a>} />);
    expect(screen.getByRole("link", { name: "Ver PDF" })).toBeInTheDocument();
    expect(screen.queryByText(/O que você pode fazer/)).toBeNull();
  });
});
