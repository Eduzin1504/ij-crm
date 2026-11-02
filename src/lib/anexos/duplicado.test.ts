// @vitest-environment node
import { Prisma } from "@prisma/client";
import { describe, expect, it } from "vitest";
import { ehAnexoDuplicadoNoBanco } from "./anexos";

const p2002 = (target: unknown) => new Prisma.PrismaClientKnownRequestError("Unique constraint failed", { code: "P2002", clientVersion: "6", meta: { target } });

describe("ehAnexoDuplicadoNoBanco: só o índice único parcial dos anexos vivos", () => {
  it("P2002 no índice (pelo nome ou pelas colunas) → duplicado", () => {
    expect(ehAnexoDuplicadoNoBanco(p2002("anexo_oportunidade_id_sha256_vivo_key"))).toBe(true);
    expect(ehAnexoDuplicadoNoBanco(p2002(["oportunidade_id", "sha256"]))).toBe(true);
  });

  it("P2002 de outro alvo, P2002 sem meta e erro que não é P2002 → não (quem chama relança)", () => {
    expect(ehAnexoDuplicadoNoBanco(p2002(["id"]))).toBe(false);
    expect(ehAnexoDuplicadoNoBanco(p2002("anexo_pkey"))).toBe(false);
    expect(ehAnexoDuplicadoNoBanco(new Prisma.PrismaClientKnownRequestError("x", { code: "P2002", clientVersion: "6" }))).toBe(false);
    expect(ehAnexoDuplicadoNoBanco(new Prisma.PrismaClientKnownRequestError("x", { code: "P2003", clientVersion: "6", meta: { target: "sha256" } }))).toBe(false);
    expect(ehAnexoDuplicadoNoBanco(new Error("sha256"))).toBe(false);
  });
});
