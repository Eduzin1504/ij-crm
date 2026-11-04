import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { montarCaneta, montarExecucao, type ProjetoEmExecucao, type SituacaoEncerrado } from "@/lib/painel/projetos-calculo";
import { SecaoAlertas, SecaoCaneta, SecaoEncerrados, SecaoExecucao } from "./secoes-projetos";

const AGORA = new Date("2026-11-11T15:00:00Z");
const NOVEMBRO = { primeiroDia: "2026-11-01", ultimoDia: "2026-11-30", inicio: new Date("2026-11-01T03:00:00Z"), fim: new Date("2026-12-01T03:00:00Z") };
const ANA = { id: "ana", nome: "Ana", ativo: true };

const projeto = (extra: Partial<ProjetoEmExecucao>): ProjetoEmExecucao => ({ id: "p", titulo: "Site", fase: "Em execução", gp: ANA, entregas: [], ultimoCheckin: null, inicioAcompanhamento: new Date("2026-10-01T12:00:00Z"), semanasCobradas: 0, ...extra });

describe("seções do painel de projetos (GAB-96)", () => {
  it("projeto migrado aparece como 'sem previsto', sem zero nem barra, e não quebra", () => {
    const e = montarExecucao([projeto({ id: "m", titulo: "Migrado", inicioAcompanhamento: null })], [], NOVEMBRO, null, AGORA);
    render(<SecaoExecucao e={e} />);
    expect(screen.getByText("Migrado")).toBeInTheDocument();
    expect(screen.getByText("sem previsto")).toBeInTheDocument();
    expect(screen.queryByRole("img", { name: /entregas feitas/ })).toBeNull();
  });

  it("projeto com cronograma: barra de feitas, atraso e status do último check-in", () => {
    const e = montarExecucao(
      [projeto({ entregas: [{ previstoOriginal: "2026-11-01", previstoAtual: "2026-11-01", realizado: null, ajustes: 0 }, { previstoOriginal: "2026-11-02", previstoAtual: "2026-11-02", realizado: "2026-11-02", ajustes: 1 }], ultimoCheckin: { status: "VERMELHO", motivo: "travou", semana: "2026-11-09", em: AGORA } })],
      [],
      NOVEMBRO,
      null,
      AGORA,
    );
    render(<SecaoExecucao e={e} />);
    expect(screen.getByRole("img", { name: "1 de 2 entregas feitas" })).toBeInTheDocument();
    expect(screen.getAllByText("10 dias").length).toBeGreaterThan(0);
    expect(screen.getByTestId("status-checkin")).toHaveTextContent("Vermelho");
  });

  it("cor funcional só em ponto: nenhum número de alerta em texto colorido nem fundo cheio", () => {
    const e = montarExecucao([projeto({ entregas: [{ previstoOriginal: "2026-11-01", previstoAtual: "2026-11-01", realizado: null, ajustes: 0 }] })], [], NOVEMBRO, null, AGORA);
    const { container } = render(<SecaoExecucao e={e} />);
    expect(container.querySelector(".text-danger, .text-warn, .text-success")).toBeNull();
    for (const el of container.querySelectorAll(".bg-danger, .bg-warn, .bg-success")) expect(el.className).toMatch(/size-/);
  });

  it("alertas vazios dizem o que é, sem lista", () => {
    render(<SecaoAlertas a={{ vermelhos: [], amarelos: [], semCheckin: [] }} />);
    expect(screen.getByText("Nenhum projeto no vermelho ou no amarelo.")).toBeInTheDocument();
    expect(screen.getByText("Todo projeto cobrado já tem check-in nesta semana.")).toBeInTheDocument();
  });

  it("caneta: membro vê o recorte dito na tela; quem vê todas, não", () => {
    const c = montarCaneta([{ projetoId: "p", titulo: "Site", usuario: ANA, lado: "VENDAS", status: "EM_AJUSTE", inicio: new Date("2026-11-09T15:00:00Z"), fim: null, parada: true, fimDoCard: null, esperas: [], rascunhoEm: new Date("2026-11-10T15:00:00Z") }], 1, NOVEMBRO, null, AGORA);
    const { rerender } = render(<SecaoCaneta c={c} visao="escaladas" />);
    expect(screen.getByText("Só as propostas em que você está escalado.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Site" })).toHaveAttribute("href", "/projetos/p/proposta");
    const edicao = screen.getByText("última edição há 1 dia");
    // Abaixo do título, não ao lado: no celular não sobra largura para os dois.
    const linhaDoTitulo = screen.getByRole("link", { name: "Site" }).closest("div");
    expect(linhaDoTitulo).toHaveTextContent("2 dias");
    expect(linhaDoTitulo).not.toContainElement(edicao);
    expect(edicao.closest("li")).toContainElement(linhaDoTitulo);
    expect(screen.getByText(/não acompanha o filtro/)).toBeInTheDocument();
    rerender(<SecaoCaneta c={c} visao="todas" />);
    expect(screen.queryByText(/escalado/)).toBeNull();
  });

  it("no celular: grids com coluna que encolhe, para a tabela rolar por dentro e o truncate funcionar", () => {
    const e = montarExecucao([projeto({})], [], NOVEMBRO, null, AGORA);
    const c = montarCaneta([], 0, NOVEMBRO, null, AGORA);
    const { container } = render(
      <>
        <SecaoExecucao e={e} />
        <SecaoAlertas a={e.alertas} />
        <SecaoCaneta c={c} visao="todas" />
      </>,
    );
    const grids = [...container.querySelectorAll(".grid")];
    expect(grids.length).toBeGreaterThan(0);
    for (const g of grids) expect(g.className).toContain("grid-cols-1");
  });

  it("encerrados: perdido aparece à parte, com previstas e feitas; sem nenhum, a seção some", () => {
    const perdido: SituacaoEncerrado = { id: "x", titulo: "Caiu", fase: "Perdido", tipo: "PERDIDO", gp: ANA, encerradoEm: AGORA, semPrevisto: true, totalEntregas: 0, feitas: 0, previstasNoPeriodo: 0, feitasNoPeriodo: 0 };
    const { rerender, container } = render(<SecaoEncerrados e={[perdido]} />);
    expect(screen.getByRole("heading", { name: /encerrados/ })).toHaveTextContent("entram no total");
    expect(screen.getByText("Caiu")).toBeInTheDocument();
    expect(screen.getByText("sem previsto")).toBeInTheDocument();
    rerender(<SecaoEncerrados e={[]} />);
    expect(container).toBeEmptyDOMElement();
  });
});
