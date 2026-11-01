import { describe, expect, it } from "vitest";
import { FIXTURES_EXTRACAO } from "../fixtures/extracao";
import { paraSchemaGemini } from "../provedores/gemini";
import { JSON_SCHEMA_EXTRACAO as V2, PROMPT_SISTEMA as PROMPT_V2, montarMensagemUsuario as montarV2 } from "./extracao.v2";
import { JSON_SCHEMA_EXTRACAO, PROMPT_SISTEMA, REGRA_SENTIMENTO, SENTIMENTOS, VERSAO_EXTRACAO, esquemaExtracao, montarMensagemUsuario } from "./extracao.v3";

type No = { type?: unknown; properties?: Record<string, No>; required?: readonly string[]; additionalProperties?: unknown };

function chavesZod(s: unknown): unknown {
  const forma = (s as { shape?: Record<string, unknown> }).shape;
  if (!forma) return null;
  return Object.fromEntries(Object.entries(forma).map(([k, v]) => [k, chavesZod(v)]));
}

function chavesJson(no: No): unknown {
  if (!no.properties) return null;
  return Object.fromEntries(Object.entries(no.properties).map(([k, v]) => [k, chavesJson(v)]));
}

const BASE = FIXTURES_EXTRACAO[0].saida;

describe("schema extracao.v3 (GAB-85: sentimento do lead)", () => {
  it("versão nova; v2 + a chave `sentimento`, estrita e obrigatória no JSON schema (structured outputs)", () => {
    expect(VERSAO_EXTRACAO).toBe("extracao.v3");
    expect(Object.keys(JSON_SCHEMA_EXTRACAO.properties).sort()).toEqual([...Object.keys(V2.properties), "sentimento"].sort());
    expect([...JSON_SCHEMA_EXTRACAO.required].sort()).toEqual(Object.keys(JSON_SCHEMA_EXTRACAO.properties).sort());
    expect(JSON_SCHEMA_EXTRACAO.additionalProperties).toBe(false);
    expect(JSON_SCHEMA_EXTRACAO.properties.sentimento).toMatchObject({
      anyOf: [{ type: "string", enum: ["POSITIVO", "NEUTRO", "NEGATIVO"] }, { type: "null" }],
    });
    // O resto do schema é o da v2, sem tirar nem pôr.
    for (const k of Object.keys(V2.properties)) expect(JSON_SCHEMA_EXTRACAO.properties[k as keyof typeof V2.properties]).toEqual(V2.properties[k as keyof typeof V2.properties]);
  });

  it("zod e JSON schema têm exatamente as mesmas chaves", () => {
    expect(chavesZod(esquemaExtracao)).toEqual(chavesJson(JSON_SCHEMA_EXTRACAO as unknown as No));
  });

  it("sentimento válido passa; os três valores", () => {
    for (const s of SENTIMENTOS) expect(esquemaExtracao.parse({ ...BASE, sentimento: s }).sentimento).toBe(s);
    expect(esquemaExtracao.parse({ ...BASE, sentimento: null }).sentimento).toBeNull();
  });

  it("tolerante: resposta SEM sentimento ou com valor desconhecido não quebra a extração (vira null)", () => {
    // Todas as fixtures (formato v2, sem a chave) continuam válidas.
    for (const f of FIXTURES_EXTRACAO) {
      const r = esquemaExtracao.safeParse(f.saida);
      expect(r.success, f.nome).toBe(true);
      if (r.success) expect(r.data.sentimento, f.nome).toBeNull();
    }
    expect(esquemaExtracao.parse({ ...BASE, sentimento: "FELIZ" }).sentimento).toBeNull();
    expect(esquemaExtracao.parse({ ...BASE, sentimento: 3 }).sentimento).toBeNull();
    expect(esquemaExtracao.parse({ ...BASE, sentimento: "positivo" }).sentimento).toBeNull();
  });

  it("o resto continua estrito: campo a mais, confiança fora de 0..1 e intenção desconhecida falham", () => {
    expect(esquemaExtracao.safeParse({ ...BASE, sentimento: "POSITIVO", extra: 1 }).success).toBe(false);
    expect(esquemaExtracao.safeParse({ ...BASE, confianca: 1.5 }).success).toBe(false);
    expect(esquemaExtracao.safeParse({ ...BASE, intencao: "APAGAR" }).success).toBe(false);
  });

  it("prompt de sistema = o da v2 (intacto) + a regra do sentimento no fim", () => {
    expect(PROMPT_SISTEMA).toBe(`${PROMPT_V2}\n${REGRA_SENTIMENTO}`);
    expect(REGRA_SENTIMENTO).toMatch(/^- sentimento:/);
    expect(REGRA_SENTIMENTO).toMatch(/POSITIVO/);
    expect(REGRA_SENTIMENTO).toMatch(/NEGATIVO/);
    expect(REGRA_SENTIMENTO).toMatch(/null/);
  });

  it("mensagem do usuário igual à da v2 (o contexto não muda)", () => {
    expect(montarMensagemUsuario).toBe(montarV2);
  });

  it("schema convertido para o Gemini mantém o sentimento como anyOf [enum, null]", () => {
    const s = paraSchemaGemini(JSON_SCHEMA_EXTRACAO) as { properties: Record<string, Record<string, unknown>>; required: string[] };
    expect(s.properties.sentimento).toMatchObject({ anyOf: [{ type: "string", enum: ["POSITIVO", "NEUTRO", "NEGATIVO"] }, { type: "null" }] });
    expect(s.required).toContain("sentimento");
  });
});
