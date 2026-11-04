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

describe("Timeline: EXECUCAO (GAB-95)", () => {
  const ver = (payload: object) => render(<Timeline entradas={[{ ...entrada(payload), tipo: "EXECUCAO" as const }]} fases={new Map()} nomes={new Map()} />);

  it("cópia, entrega feita, ajuste com motivo e check-in com cor e motivo", () => {
    ver({ evento: "cronograma_copiado", versao: 2, entregas: 3 });
    expect(screen.getByText(/copiou o cronograma da proposta \(v2, 3 entregas\)/)).toBeInTheDocument();
    ver({ evento: "entrega_feita", titulo: "Diagnóstico", dia: "2026-11-21", previsto: "2026-11-20" });
    expect(screen.getByText(/em 21\/11\/2026 \(prevista para 20\/11\/2026\)/)).toBeInTheDocument();
    ver({ evento: "data_ajustada", titulo: "Final", de: "2026-12-10", para: "2026-12-20", motivo: "Cliente atrasou" });
    expect(screen.getByText(/de 10\/12\/2026 para 20\/12\/2026: Cliente atrasou/)).toBeInTheDocument();
    ver({ evento: "checkin", status: "AMARELO", motivo: "Atenção ao prazo" });
    expect(screen.getByText("Amarelo")).toBeInTheDocument();
    expect(screen.getByText(/Atenção ao prazo/)).toBeInTheDocument();
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

describe("Timeline: ANEXO (GAB-84)", () => {
  const anexo = (payload: object) => ({ ...entrada(payload), tipo: "ANEXO" as const });

  it("adicionado (com e sem texto), excluído, restaurado e apagado", () => {
    const { rerender } = render(<Timeline entradas={[anexo({ evento: "adicionado", anexoId: "a1", nome: "Proposta.pdf", semTexto: false })]} fases={new Map()} nomes={new Map()} />);
    expect(screen.getByText(/anexou/)).toBeInTheDocument();
    expect(screen.getByText("Proposta.pdf")).toBeInTheDocument();
    expect(screen.queryByText(/sem texto/)).not.toBeInTheDocument();
    rerender(<Timeline entradas={[anexo({ evento: "adicionado", anexoId: "a1", nome: "foto.png", semTexto: true })]} fases={new Map()} nomes={new Map()} />);
    expect(screen.getByText(/sem texto/)).toBeInTheDocument();
    rerender(<Timeline entradas={[anexo({ evento: "excluido", anexoId: "a1", nome: "foto.png" })]} fases={new Map()} nomes={new Map()} />);
    expect(screen.getByText(/excluiu o anexo/)).toBeInTheDocument();
    rerender(<Timeline entradas={[anexo({ evento: "restaurado", anexoId: "a1", nome: "foto.png" })]} fases={new Map()} nomes={new Map()} />);
    expect(screen.getByText(/restaurou da lixeira o anexo/)).toBeInTheDocument();
    rerender(<Timeline entradas={[anexo({ evento: "apagado", anexoId: "a1", nome: "foto.png" })]} fases={new Map()} nomes={new Map()} />);
    expect(screen.getByText(/apagou definitivamente o anexo/)).toBeInTheDocument();
  });
});

describe("Timeline: PROPOSTA (GAB-86)", () => {
  const proposta = (payload: object) => ({ ...entrada(payload), tipo: "PROPOSTA" as const });

  it("criação linka a proposta; versão salva linka a versão e mostra a nota", () => {
    const { rerender } = render(<Timeline entradas={[proposta({ evento: "criada" })]} fases={new Map()} nomes={new Map()} />);
    expect(screen.getByRole("link", { name: "proposta" })).toHaveAttribute("href", "/projetos/c1/proposta");
    rerender(<Timeline entradas={[proposta({ evento: "versao_salva", numero: 3, nota: "ajuste de prazo" })]} fases={new Map()} nomes={new Map()} />);
    expect(screen.getByRole("link", { name: "versão v3" })).toHaveAttribute("href", "/projetos/c1/proposta/versoes/3");
    expect(screen.getByText(/ajuste de prazo/)).toBeInTheDocument();
  });

  it("nota com HTML aparece como texto", () => {
    render(<Timeline entradas={[proposta({ evento: "versao_salva", numero: 1, nota: "<img src=x onerror=alert(1)>" })]} fases={new Map()} nomes={new Map()} />);
    expect(screen.getByText(/<img src=x onerror=alert\(1\)>/)).toBeInTheDocument();
    expect(document.querySelector("img")).toBeNull();
  });

  it("caneta (GAB-87): devolver, concordar, passar, pegar, reabrir e inviável", () => {
    const evs = [
      proposta({ evento: "devolvida", numero: 2, paraNome: "Paula", lado: "PROJETOS" }),
      proposta({ evento: "concordou", numero: 2 }),
      proposta({ evento: "caneta_passada", paraNome: "Bia" }),
      proposta({ evento: "caneta_pega", deNome: "Ana" }),
      proposta({ evento: "reaberta" }),
      proposta({ evento: "inviavel", motivo: "<b>prazo</b> impossível" }),
      proposta({ evento: "reaberta_do_perdido" }),
      proposta({ evento: "caneta_liberada", deNome: "Ana", motivo: "desativado" }),
    ].map((x, i) => ({ ...x, id: `e${i}` }));
    render(<Timeline entradas={evs} fases={new Map()} nomes={new Map()} />);
    expect(screen.getByText(/devolveu a proposta/)).toHaveTextContent("devolveu a proposta (v2) para Paula · projetos");
    expect(screen.getAllByRole("link", { name: "v2" })[0]).toHaveAttribute("href", "/projetos/c1/proposta/versoes/2");
    expect(screen.getByText(/concordou com a/)).toHaveTextContent("pronta para envio");
    expect(screen.getByText(/passou a caneta/)).toHaveTextContent("passou a caneta da proposta para Bia");
    expect(screen.getByText(/pegou a caneta/)).toHaveTextContent("(estava com Ana)");
    expect(screen.getByText(/reabriu a proposta/)).toBeInTheDocument();
    expect(screen.getByText(/marcou a proposta como/)).toHaveTextContent("“<b>prazo</b> impossível”");
    expect(screen.getByText(/reabriu o card/)).toHaveTextContent("voltou para ajuste com vendas");
    expect(screen.getByText(/ficou sem dono/)).toHaveTextContent("Ana foi desativado(a)");
  });

  it("envio e resposta do cliente (GAB-89)", () => {
    const evs = [
      proposta({ evento: "enviada", numero: 2 }),
      proposta({ evento: "aceita", numero: 2 }),
      proposta({ evento: "recusada", motivo: "Preço: achou caro" }),
      proposta({ evento: "revisao_pedida", pedido: "<i>mudar</i> o tom" }),
      proposta({ evento: "revisao_concluida", numero: 3 }),
      proposta({ evento: "reaberta_do_perdido", de: "RECUSADA" }),
    ].map((x, i) => ({ ...x, id: `e${i}` }));
    render(<Timeline entradas={evs} fases={new Map()} nomes={new Map()} />);
    expect(screen.getByText(/marcou a proposta/)).toHaveTextContent("marcou a proposta (v2) como enviada ao cliente");
    expect(screen.getByText(/aceitou/).parentElement).toHaveTextContent("o cliente aceitou a proposta (v2)");
    expect(screen.getByText(/recusou/).parentElement).toHaveTextContent("“Preço: achou caro”");
    expect(screen.getByText(/pediu revisão/).parentElement).toHaveTextContent("“<i>mudar</i> o tom”");
    expect(screen.getByText(/concluiu a revisão/)).toHaveTextContent("pronta para envio de novo");
    expect(screen.getByText(/reabriu o card/)).toHaveTextContent("recusada voltou como revisão pedida");
  });
});
