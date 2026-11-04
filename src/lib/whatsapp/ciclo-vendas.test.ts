import { describe, expect, it } from "vitest";
import { STATUS_PROPOSTA } from "@/lib/propostas/regras";
import { MOTIVO_CARD_NOVO_SEM_PROPOSTA, MOTIVO_GANHO_SO_DE_MONTANDO_CONTRATO, motivoDaTravaDoContrato } from "./ciclo-vendas";
import { MAX_TRECHO } from "./confirmacao";

describe("motivo da trava de Montando contrato no grupo (GAB-89)", () => {
  it("cabe inteiro na linha da confirmação (nada cortado com …)", () => {
    for (const m of [motivoDaTravaDoContrato(null), MOTIVO_CARD_NOVO_SEM_PROPOSTA, MOTIVO_GANHO_SO_DE_MONTANDO_CONTRATO, ...STATUS_PROPOSTA.map((s) => motivoDaTravaDoContrato(s))]) {
      expect([...m].length, m).toBeLessThanOrEqual(MAX_TRECHO);
    }
  });
});
