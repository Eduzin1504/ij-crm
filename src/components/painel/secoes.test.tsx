import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { SEM_DADOS_PROPOSTA } from "@/lib/painel/proposta";
import { SecaoConversao, SecaoSatisfacao } from "./secoes";

describe("seções do painel (GAB-94)", () => {
  it("conversão: valor em proposta e versões até fechar aparecem como 'sem dados' enquanto não há Proposta", () => {
    render(
      <SecaoConversao
        c={{
          ganhos: 2,
          perdidos: 1,
          conversao: 2 / 3,
          valorFechado: 15_000,
          fases: [{ faseId: "f1", nome: "Reunião", entradas: 3, avancos: 2, perdas: 1, recuos: 0, conversao: 2 / 3, tempoMedioDias: 2.5 }],
          valorEmProposta: SEM_DADOS_PROPOSTA,
          versoesAteFechar: SEM_DADOS_PROPOSTA,
        }}
      />,
    );
    expect(screen.getAllByText("sem dados")).toHaveLength(2);
    expect(screen.getAllByText("67%").length).toBeGreaterThan(0);
    expect(screen.getByText("Reunião")).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "Conversão 67%" })).toBeInTheDocument();
  });

  it("satisfação sem sentimento: traço em vez de barra", () => {
    render(<SecaoSatisfacao s={{ porVendedor: [], time: { notas: 0, notaMedia: null, positivos: 0, neutros: 0, negativos: 0 } }} />);
    expect(screen.queryByRole("img", { name: "Distribuição do sentimento" })).toBeNull();
    expect(screen.getAllByText("—").length).toBeGreaterThan(0);
  });
});
