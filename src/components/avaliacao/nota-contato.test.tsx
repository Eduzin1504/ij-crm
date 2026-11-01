import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { BadgeSentimento, NotaContatoExibida, ResumoAvaliacaoContato, SeletorNotaContato } from "./nota-contato";

describe("SeletorNotaContato (GAB-85)", () => {
  it("um clique escolhe a nota; clicar de novo na mesma limpa (é opcional)", () => {
    const onChange = vi.fn();
    const { rerender } = render(<SeletorNotaContato valor={null} onChange={onChange} />);
    expect(screen.getByRole("group", { name: /como foi o contato/i })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "4 de 5" }));
    expect(onChange).toHaveBeenLastCalledWith(4);
    rerender(<SeletorNotaContato valor={4} onChange={onChange} />);
    expect(screen.getByRole("button", { name: "4 de 5" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "5 de 5" })).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(screen.getByRole("button", { name: "4 de 5" }));
    expect(onChange).toHaveBeenLastCalledWith(null);
  });

  it("desabilitado não muda", () => {
    const onChange = vi.fn();
    render(<SeletorNotaContato valor={null} onChange={onChange} disabled />);
    fireEvent.click(screen.getByRole("button", { name: "2 de 5" }));
    expect(onChange).not.toHaveBeenCalled();
  });
});

describe("exibição", () => {
  it("nota exibida com texto acessível", () => {
    render(<NotaContatoExibida nota={3} />);
    expect(screen.getByText("3/5")).toBeInTheDocument();
    expect(screen.getByLabelText("Contato avaliado em 3 de 5")).toBeInTheDocument();
  });

  it("sentimento do lead em português", () => {
    render(<BadgeSentimento sentimento="NEGATIVO" />);
    expect(screen.getByText("Lead: negativo")).toBeInTheDocument();
  });
});

describe("ResumoAvaliacaoContato (detalhe do Projeto)", () => {
  it("média com vírgula, quantas notas e os sentimentos que apareceram", () => {
    render(<ResumoAvaliacaoContato resumo={{ notas: 2, media: 4.5, sentimentos: { POSITIVO: 3, NEUTRO: 0, NEGATIVO: 1 } }} />);
    expect(screen.getByText(/4,5/)).toBeInTheDocument();
    expect(screen.getByText(/2 notas/)).toBeInTheDocument();
    expect(screen.getByText(/3 positivos/)).toBeInTheDocument();
    expect(screen.getByText(/1 negativo\b/)).toBeInTheDocument();
    expect(screen.queryByText(/neutro/)).not.toBeInTheDocument();
  });

  it("só sentimento, sem nota; e uma nota no singular", () => {
    const { rerender } = render(<ResumoAvaliacaoContato resumo={{ notas: 0, media: null, sentimentos: { POSITIVO: 0, NEUTRO: 1, NEGATIVO: 0 } }} />);
    expect(screen.queryByText(/nota/)).not.toBeInTheDocument();
    expect(screen.getByText(/1 neutro/)).toBeInTheDocument();
    rerender(<ResumoAvaliacaoContato resumo={{ notas: 1, media: 3, sentimentos: { POSITIVO: 0, NEUTRO: 0, NEGATIVO: 0 } }} />);
    expect(screen.getByText(/1 nota\)/)).toBeInTheDocument();
    expect(screen.queryByText(/Lead:/)).not.toBeInTheDocument();
  });
});
