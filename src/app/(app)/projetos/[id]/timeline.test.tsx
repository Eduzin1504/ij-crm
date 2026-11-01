import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Timeline } from "./timeline";

const entrada = (payload: object) => ({
  id: "t1",
  projetoId: "c1",
  tipo: "PRAZO" as const,
  payload,
  usuarioId: "u1",
  mensagemBrutaId: null,
  em: new Date("2026-10-27T13:00:00Z"),
  viaMcp: false,
  nota: null,
  sentimento: null,
  usuario: { id: "u1", nome: "Ana Vendas" },
});

describe("Timeline: PRAZO (GAB-51)", () => {
  it("criado e concluído, com o dia em mono", () => {
    const { rerender } = render(<Timeline entradas={[entrada({ evento: "criado", titulo: "Enviar proposta", dia: "2026-10-30" })]} fases={new Map()} nomes={new Map()} />);
    expect(screen.getByText(/criou o prazo/)).toBeInTheDocument();
    expect(screen.getByText("Enviar proposta")).toBeInTheDocument();
    expect(screen.getByText("30/10/2026")).toHaveClass("font-mono");
    rerender(<Timeline entradas={[entrada({ evento: "concluido", titulo: "Enviar proposta", dia: "2026-10-30" })]} fases={new Map()} nomes={new Map()} />);
    expect(screen.getByText(/concluiu o prazo/)).toBeInTheDocument();
  });
});

describe("Timeline: pares não unidos do ciclo único (GAB-81)", () => {
  const vinculo = (payload: object) => ({ ...entrada(payload), tipo: "VINCULO_PROJETO" as const, usuarioId: null, usuario: null });

  it("ciclo_unico_nao_unido linka o card irmão vivo; sem ele, aparece como removido", () => {
    const relacionados = new Map([["p2", { titulo: "Oficina (projeto)", quadro: "projetos" }]]);
    const { rerender } = render(
      <Timeline entradas={[vinculo({ evento: "ciclo_unico_nao_unido", projetoId: "p2", vendaFase: "Em negociação" })]} fases={new Map()} nomes={new Map()} relacionados={relacionados} />,
    );
    expect(screen.getByText(/manteve separados/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Oficina (projeto)" })).toHaveAttribute("href", "/projetos/p2");
    rerender(<Timeline entradas={[vinculo({ evento: "ciclo_unico_nao_unido", vendaId: "v9" })]} fases={new Map()} nomes={new Map()} />);
    expect(screen.getByText(/venda \(removido\)/)).toBeInTheDocument();
  });

  it("reganho_projeto_existente: na venda linka o projeto anterior; no projeto linka a venda", () => {
    const relacionados = new Map([
      ["p2", { titulo: "Oficina (projeto)", quadro: "projetos" }],
      ["v1", { titulo: "Oficina", quadro: "projetos" }],
    ]);
    const { rerender } = render(<Timeline entradas={[vinculo({ evento: "reganho_projeto_existente", projetoId: "p2" })]} fases={new Map()} nomes={new Map()} relacionados={relacionados} />);
    expect(screen.getByText(/o projeto da venda anterior já existe/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Oficina (projeto)" })).toHaveAttribute("href", "/projetos/p2");
    rerender(<Timeline entradas={[vinculo({ evento: "reganho_projeto_existente", vendaId: "v1" })]} fases={new Map()} nomes={new Map()} relacionados={relacionados} />);
    expect(screen.getByRole("link", { name: "Oficina" })).toHaveAttribute("href", "/projetos/v1");
  });
});

describe("Timeline: ações pelo conector MCP (GAB-83)", () => {
  it("marca 'via MCP' com o autor; a criação não diz 'pelo app'", () => {
    const criacao = { ...entrada({ faseId: "f1", via: "UI" }), tipo: "CRIACAO" as const, viaMcp: true };
    const nota = { ...entrada({ texto: "Ligar amanhã" }), id: "t2", tipo: "NOTA" as const, viaMcp: true };
    render(<Timeline entradas={[criacao, nota]} fases={new Map([["f1", "Proposta"]])} nomes={new Map()} />);
    expect(screen.getAllByText("via MCP")).toHaveLength(2);
    expect(screen.getAllByText("Ana Vendas")).toHaveLength(2);
    expect(screen.queryByText(/pelo app/)).not.toBeInTheDocument();
  });

  it("ação pela tela não ganha a marca", () => {
    render(<Timeline entradas={[{ ...entrada({ faseId: "f1", via: "UI" }), tipo: "CRIACAO" as const }]} fases={new Map()} nomes={new Map()} />);
    expect(screen.queryByText("via MCP")).not.toBeInTheDocument();
    expect(screen.getByText(/pelo app/)).toBeInTheDocument();
  });
});

describe("Timeline: avaliação do contato (GAB-85)", () => {
  it("NOTA com nota 1–5 mostra a nota; MENSAGEM_WHATSAPP mostra o sentimento do lead; sem nada, nada", () => {
    const entradas = [
      { ...entrada({ texto: "Reunião ótima" }), id: "a", tipo: "NOTA" as const, nota: 5, sentimento: null },
      { ...entrada({ texto: "#crm curtiu" }), id: "b", tipo: "MENSAGEM_WHATSAPP" as const, nota: null, sentimento: "POSITIVO" as const },
      { ...entrada({ texto: "Sem nota" }), id: "c", tipo: "NOTA" as const, nota: null, sentimento: null },
    ];
    render(<Timeline entradas={entradas} fases={new Map()} nomes={new Map()} />);
    expect(screen.getByLabelText("Contato avaliado em 5 de 5")).toBeInTheDocument();
    expect(screen.getByText("Lead: positivo")).toBeInTheDocument();
    expect(screen.getAllByText(/\/5$/)).toHaveLength(1);
  });
});
