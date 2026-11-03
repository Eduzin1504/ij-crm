import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const acoes = vi.hoisted(() => ({ sugerirDeAnexoAction: vi.fn() }));
const refresh = vi.hoisted(() => vi.fn());
vi.mock("./preencher-actions", () => acoes);
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

const { PreencherDeArquivo } = await import("./preencher-de-arquivo");

const ANEXOS = [
  { id: "a".repeat(32), nome: "proposta.pdf", tipo: "PDF" as const, semTexto: false },
  { id: "b".repeat(32), nome: "scan.png", tipo: "PNG" as const, semTexto: true },
];
const documento = { type: "doc" as const, content: [{ type: "paragraph" as const, content: [{ type: "text" as const, text: "Texto da proposta lida" }] }] };
const SUGESTAO = {
  origem: "arquivo",
  anexo: { id: "b".repeat(32), nome: "scan.png" },
  documento,
  campos: { valor: "12.500,00", prazoDias: null, escopoResumo: null, entregas: null },
  revisar: [{ campo: "prazoDias", motivo: "leitura incerta: confira no arquivo", lido: "90", trecho: "3 meses" }],
};

beforeEach(() => vi.clearAllMocks());

async function abrirELer(aoAplicar = vi.fn()) {
  render(<PreencherDeArquivo projetoId="p1" anexos={ANEXOS} aoAplicar={aoAplicar} />);
  fireEvent.click(screen.getByRole("button", { name: /Usar arquivo como base/ }));
  fireEvent.change(screen.getByLabelText("Anexo do projeto"), { target: { value: "b".repeat(32) } });
  await act(async () => fireEvent.click(screen.getByRole("button", { name: "Ler arquivo" })));
  return aoAplicar;
}

describe("PreencherDeArquivo (GAB-90)", () => {
  it("mostra a sugestão para revisar (texto, dados e o que ficou em branco) sem aplicar nada", async () => {
    acoes.sugerirDeAnexoAction.mockResolvedValue({ ok: true, sugestao: SUGESTAO });
    const aoAplicar = await abrirELer();
    expect(acoes.sugerirDeAnexoAction).toHaveBeenCalledWith("p1", "b".repeat(32));
    expect(screen.getByText("Texto da proposta lida")).toBeInTheDocument();
    expect(screen.getByText("R$ 12.500,00")).toBeInTheDocument();
    expect(screen.getByText(/leitura incerta/)).toBeInTheDocument();
    expect(screen.getByText(/substitui o texto atual/)).toBeInTheDocument();
    expect(aoAplicar).not.toHaveBeenCalled();
  });

  it("aplicar entrega texto e campos ao editor e mantém a lista do que revisar", async () => {
    acoes.sugerirDeAnexoAction.mockResolvedValue({ ok: true, sugestao: SUGESTAO });
    const aoAplicar = await abrirELer();
    fireEvent.click(screen.getByRole("button", { name: "Aplicar ao rascunho" }));
    expect(aoAplicar).toHaveBeenCalledWith({ documento, campos: SUGESTAO.campos });
    expect(screen.getByText(/Arquivo aplicado ao rascunho/)).toBeInTheDocument();
    expect(screen.getByText(/leitura incerta/)).toBeInTheDocument();
  });

  it("falha da IA: mensagem com ref; nada é aplicado", async () => {
    acoes.sugerirDeAnexoAction.mockResolvedValue({ ok: false, erro: "Não foi possível ler o arquivo com a IA. O rascunho não foi alterado.", ref: "abcd1234" });
    const aoAplicar = await abrirELer();
    expect(screen.getByRole("alert")).toHaveTextContent(/O rascunho não foi alterado.*ref: abcd1234/);
    expect(aoAplicar).not.toHaveBeenCalled();
  });

  it("erro inesperado do servidor também mostra a ref", async () => {
    acoes.sugerirDeAnexoAction.mockResolvedValue({ ok: false, erro: "INESPERADO", ref: "ffff0000" });
    await abrirELer();
    expect(screen.getByRole("alert")).toHaveTextContent(/Erro no servidor.*ref: ffff0000/);
  });
});
