import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { CardVisual } from "./card-visual";
import type { CardCliente } from "./tipos";

const AGORA = new Date("2026-10-27T15:00:00Z").getTime();

const base: CardCliente = {
  id: "c1",
  titulo: "Padaria do Zé",
  descricaoPrevia: null,
  descricaoTruncada: false,
  faseId: "f1",
  faseDesdeMs: AGORA,
  revisar: false,
  proximaAcao: null,
  proximaAcaoEmMs: null,
  responsavelId: "u1",
  responsavelNome: "Ana Vendas",
  responsavelFotoEm: null,
  propostaStatus: null,
  ultimoCheckin: null,
  empresaNome: null,
  origem: null,
  estado: null,
  valorFechado: null,
  motivoPerda: null,
};

describe("CardVisual: prévia da descrição", () => {
  it("mostra a descrição em texto apagado, presa em 2 linhas", () => {
    render(<CardVisual card={{ ...base, descricaoPrevia: "Site novo\ncom loja\ne blog" }} fase={undefined} agoraMs={AGORA} />);
    const previa = screen.getByTestId("previa-descricao");
    expect(previa.textContent).toBe("Site novo\ncom loja\ne blog");
    expect(previa).toHaveClass("line-clamp-2");
    expect(previa).toHaveClass("text-fg-mute");
  });

  it("prévia truncada no servidor ganha reticências", () => {
    render(<CardVisual card={{ ...base, descricaoPrevia: "começo", descricaoTruncada: true }} fase={undefined} agoraMs={AGORA} />);
    expect(screen.getByTestId("previa-descricao").textContent).toBe("começo…");
  });

  it("sem descrição, nada de prévia (o card não cresce)", () => {
    render(<CardVisual card={base} fase={undefined} agoraMs={AGORA} />);
    expect(screen.queryByTestId("previa-descricao")).toBeNull();
  });

  it("HTML na descrição aparece como texto, não vira elemento", () => {
    const { container } = render(<CardVisual card={{ ...base, descricaoPrevia: "<img src=x onerror=alert(1)>" }} fase={undefined} agoraMs={AGORA} />);
    expect(screen.getByTestId("previa-descricao").textContent).toBe("<img src=x onerror=alert(1)>");
    expect(container.querySelector("img")).toBeNull();
  });
});

describe("CardVisual: status da proposta (GAB-86)", () => {
  it("projeto com proposta mostra o badge do status; sem proposta, nada", () => {
    const { rerender } = render(<CardVisual card={{ ...base, propostaStatus: "RASCUNHO" }} fase={undefined} agoraMs={AGORA} />);
    expect(screen.getByTestId("status-proposta").textContent).toBe("Rascunho");
    expect(screen.getByTestId("status-proposta")).toHaveAttribute("title", "Proposta: Rascunho");
    rerender(<CardVisual card={base} fase={undefined} agoraMs={AGORA} />);
    expect(screen.queryByTestId("status-proposta")).toBeNull();
  });
});

describe("CardVisual: check-in (GAB-95)", () => {
  const fase = { id: "f1", chave: "exec", nome: "Em execução", cor: null, limiteDiasAlerta: null, isTerminal: false, tipoTerminal: null };

  it("mostra a cor do último check-in, com rótulo e motivo no título", () => {
    render(<CardVisual card={{ ...base, ultimoCheckin: { status: "VERMELHO", motivo: "Cliente sumiu" } }} fase={fase} agoraMs={AGORA} />);
    const b = screen.getByTestId("status-checkin");
    expect(b.textContent).toBe("Vermelho");
    expect(b.getAttribute("title")).toBe("Check-in: Vermelho · Cliente sumiu");
  });

  it("sem check-in não mostra nada; em fase terminal também não", () => {
    const { rerender } = render(<CardVisual card={base} fase={fase} agoraMs={AGORA} />);
    expect(screen.queryByTestId("status-checkin")).toBeNull();
    rerender(<CardVisual card={{ ...base, ultimoCheckin: { status: "VERDE", motivo: "ok" } }} fase={{ ...fase, isTerminal: true, tipoTerminal: "GANHO" }} agoraMs={AGORA} />);
    expect(screen.queryByTestId("status-checkin")).toBeNull();
  });
});
