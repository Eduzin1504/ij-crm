import { render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { agruparPorDia } from "@/lib/calendario/semana";
import type { PrazoItem } from "@/lib/prazos/prazos";
import { Agenda } from "./agenda";
import { PrazosProvider } from "./editor-prazo";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("./actions", () => ({ criarPrazoAction: vi.fn(), editarPrazoAction: vi.fn(), concluirPrazoAction: vi.fn(), excluirPrazoAction: vi.fn() }));

const DIA = "2026-10-28";
const prazo = (id: string, nome: string): PrazoItem => ({ id, titulo: `Prazo ${nome}`, dia: DIA, estado: "pendente", responsavel: { id, nome, fotoEm: null }, card: null, podeMexer: false });

describe("Agenda: prazo de outra pessoa (GAB-98)", () => {
  it("mostra o avatar só quando o responsável não é o dono da agenda", () => {
    const { container } = render(
      <PrazosProvider eu={{ id: "u1", nome: "Ana" }} gestor={false} responsaveis={[]} responsavelPadrao="u1">
        <Agenda dias={agruparPorDia([DIA], [], [prazo("u1", "Ana"), prazo("u2", "Bia")])} hoje={DIA} donoDaAgenda="u1" rotulo="Esta semana" vazio="Nada" />
      </PrazosProvider>,
    );
    const avatar = (nome: string) => container.querySelector(`[aria-label="Responsável: ${nome}"],[title="Responsável: ${nome}"]`);
    expect(avatar("Bia")).not.toBeNull();
    expect(avatar("Ana")).toBeNull();
  });
});
