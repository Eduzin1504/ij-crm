import { describe, expect, it } from "vitest";
import type { EstadoCaneta, Pessoa } from "./caneta";
import { acoesDeEnvio, podeAgirPorVendas, recusaDoEnvio, versaoDoPdf } from "./envio";

const ana: Pessoa = { id: "ana", papel: "VENDEDOR", area: null, cargos: [], ativo: true };
const bia: Pessoa = { id: "bia", papel: "VENDEDOR", area: null, cargos: [], ativo: true };
const gpVendas: Pessoa = { id: "gv", papel: "VENDEDOR", area: "VENDAS", cargos: ["GP"], ativo: true };
const paula: Pessoa = { id: "paula", papel: "PROJETOS", area: null, cargos: [], ativo: true };
const gpProjetos: Pessoa = { id: "gp", papel: "PROJETOS", area: "PROJETOS", cargos: ["GP"], ativo: true };
const gestor: Pessoa = { id: "gil", papel: "GESTOR", area: null, cargos: [], ativo: true };
const vera: Pessoa = { id: "vera", papel: "VISUALIZADOR", area: null, cargos: [], ativo: true };

const estado = (e: Partial<EstadoCaneta> = {}): EstadoCaneta => ({ status: "PRONTA_PARA_ENVIO", canetaComId: "ana", canetaLado: "VENDAS", ultimaVersaoLado: "PROJETOS", ...e });

describe("envio: quem age por vendas", () => {
  it("dono da caneta (vendas) ou GP de vendas; mais ninguém", () => {
    expect(podeAgirPorVendas(ana, estado())).toBe(true);
    expect(podeAgirPorVendas(gpVendas, estado())).toBe(true);
    expect(podeAgirPorVendas(gpVendas, estado({ canetaComId: null }))).toBe(true);
    for (const p of [bia, paula, gpProjetos, gestor, vera]) expect(podeAgirPorVendas(p, estado()), p.id).toBe(false);
    expect(podeAgirPorVendas({ ...ana, ativo: false }, estado())).toBe(false);
  });
});

describe("recusaDoEnvio", () => {
  it("enviar: só pronta", () => {
    expect(recusaDoEnvio("enviar", ana, estado())).toBeNull();
    expect(recusaDoEnvio("enviar", ana, estado({ status: "EM_AJUSTE" }))).toBe("ENVIAR_SO_PRONTA");
    expect(recusaDoEnvio("enviar", paula, estado())).toBe("ENVIO_SO_VENDAS");
  });
  it("responder: só enviada", () => {
    expect(recusaDoEnvio("responder", ana, estado({ status: "ENVIADA" }))).toBeNull();
    expect(recusaDoEnvio("responder", ana, estado())).toBe("RESPONDER_SO_ENVIADA");
    expect(recusaDoEnvio("responder", gestor, estado({ status: "ENVIADA" }))).toBe("ENVIO_SO_VENDAS");
  });
  it("concluir revisão: só o dono da caneta (como editar), com revisão pedida", () => {
    const rev = estado({ status: "REVISAO_PEDIDA" });
    expect(recusaDoEnvio("concluirRevisao", ana, rev)).toBeNull();
    expect(recusaDoEnvio("concluirRevisao", gpVendas, rev)).toBe("SEM_CANETA");
    expect(recusaDoEnvio("concluirRevisao", ana, estado({ status: "ENVIADA" }))).toBe("CONCLUIR_REVISAO_SO_PEDIDA");
  });
  it("acoesDeEnvio", () => {
    expect(acoesDeEnvio(ana, estado())).toEqual(["enviar"]);
    expect(acoesDeEnvio(gpVendas, estado({ status: "ENVIADA" }))).toEqual(["responder"]);
    expect(acoesDeEnvio(ana, estado({ status: "REVISAO_PEDIDA" }))).toEqual(["concluirRevisao"]);
    expect(acoesDeEnvio(paula, estado({ status: "ENVIADA" }))).toEqual([]);
  });
});

describe("versaoDoPdf", () => {
  it("pronta → a última; depois do envio → a enviada; antes de pronta → nenhuma", () => {
    expect(versaoDoPdf({ status: "PRONTA_PARA_ENVIO", versaoEnviada: 1 }, 3)).toBe(3);
    expect(versaoDoPdf({ status: "ENVIADA", versaoEnviada: 2 }, 3)).toBe(2);
    expect(versaoDoPdf({ status: "REVISAO_PEDIDA", versaoEnviada: 2 }, 4)).toBe(2);
    expect(versaoDoPdf({ status: "ACEITA", versaoEnviada: 2 }, 2)).toBe(2);
    expect(versaoDoPdf({ status: "EM_AJUSTE", versaoEnviada: null }, 3)).toBeNull();
    expect(versaoDoPdf({ status: "INVIAVEL", versaoEnviada: null }, 3)).toBeNull();
  });
});
