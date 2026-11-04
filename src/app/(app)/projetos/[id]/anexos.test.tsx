import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AnexoDoProjeto } from "@/lib/anexos/anexos";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh, push: vi.fn() }) }));
vi.mock("@/app/(app)/_lixeira/actions", () => ({ excluirAnexoAction: vi.fn() }));
const fetchMock = vi.fn();
vi.stubGlobal("fetch", fetchMock);

const { AnexosDoProjeto } = await import("./anexos");

const ID = "a".repeat(32);
function anexo(extra: Partial<AnexoDoProjeto> = {}): AnexoDoProjeto {
  return {
    id: ID,
    nome: "Proposta v2.pdf",
    tipo: "PDF",
    mime: "application/pdf",
    tamanho: 1536,
    contratoAssinado: false,
    semTexto: false,
    caracteres: 1200,
    criadoEm: new Date("2026-10-31T15:00:00Z"),
    autor: { id: "u1", nome: "Vera Vendedora" },
    ...extra,
  };
}

const json = (status: number, corpo: object) => new Response(JSON.stringify(corpo), { status, headers: { "content-type": "application/json" } });

function escolher(arquivo: File) {
  fireEvent.change(screen.getByLabelText("Anexar arquivo"), { target: { files: [arquivo] } });
}

beforeEach(() => vi.clearAllMocks());

describe("AnexosDoProjeto", () => {
  it("lista com download, autor, tamanho, link do texto e marca 'sem texto'", () => {
    render(<AnexosDoProjeto cardId="c1" anexos={[anexo(), anexo({ id: "b".repeat(32), nome: "foto.png", tipo: "PNG", semTexto: true, caracteres: 0 })]} somenteLeitura={false} />);
    expect(screen.getByRole("link", { name: "Proposta v2.pdf" })).toHaveAttribute("href", `/api/anexos/${ID}`);
    expect(screen.getAllByText(/Vera Vendedora/)).toHaveLength(2);
    expect(screen.getAllByText("1,5 KB")[0]).toHaveClass("font-mono");
    expect(screen.getByRole("link", { name: /texto extraído/ })).toHaveAttribute("href", `/api/anexos/${ID}/texto`);
    expect(screen.getByText("sem texto")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: /Excluir/ })).toHaveLength(2);
  });

  it("VISUALIZADOR: só baixa e lê (sem anexar nem excluir)", () => {
    render(<AnexosDoProjeto cardId="c1" anexos={[anexo()]} somenteLeitura />);
    expect(screen.getByRole("link", { name: "Proposta v2.pdf" })).toBeInTheDocument();
    expect(screen.queryByLabelText("Anexar arquivo")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Excluir/ })).not.toBeInTheDocument();
  });

  it("upload: corpo cru + nome no header; sucesso recarrega", async () => {
    fetchMock.mockResolvedValue(json(201, { ok: true, anexo: { id: ID, nome: "a.pdf", semTexto: false } }));
    render(<AnexosDoProjeto cardId="c1" anexos={[]} somenteLeitura={false} />);
    const arquivo = new File(["%PDF-"], "Ação.pdf", { type: "application/pdf" });
    escolher(arquivo);
    await waitFor(() => expect(refresh).toHaveBeenCalled());
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/projetos/c1/anexos");
    expect(init.method).toBe("POST");
    expect(init.body).toBe(arquivo);
    expect(init.headers["X-Nome-Arquivo"]).toBe(encodeURIComponent("Ação.pdf"));
  });

  it("erro de regra mostra a mensagem do servidor; erro inesperado mostra a ref; rede fora → sem conexão", async () => {
    render(<AnexosDoProjeto cardId="c1" anexos={[]} somenteLeitura={false} />);
    fetchMock.mockResolvedValueOnce(json(422, { ok: false, erro: "Tipo não aceito." }));
    escolher(new File(["x"], "a.exe"));
    expect(await screen.findByRole("alert")).toHaveTextContent("Tipo não aceito.");

    fetchMock.mockResolvedValueOnce(json(500, { ok: false, erro: "INESPERADO", ref: "abcd1234" }));
    escolher(new File(["x"], "b.pdf"));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent(/Erro no servidor.*abcd1234/));

    fetchMock.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    escolher(new File(["x"], "c.pdf"));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent(/Sem conexão/));
    expect(refresh).not.toHaveBeenCalled();
  });

  it("arquivo acima do limite nem é enviado", async () => {
    render(<AnexosDoProjeto cardId="c1" anexos={[]} somenteLeitura={false} />);
    const grande = new File(["x"], "g.pdf");
    Object.defineProperty(grande, "size", { value: 11 * 1024 * 1024 });
    escolher(grande);
    expect(await screen.findByRole("alert")).toHaveTextContent(/limite é 10 MB/);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
