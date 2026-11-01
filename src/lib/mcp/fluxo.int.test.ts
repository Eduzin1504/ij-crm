// @vitest-environment node
/**
 * Fluxo OAuth + MCP de ponta a ponta pelas MESMAS rotas que o Claude chama
 * (GAB-83): descoberta → registro (DCR) → autorizar (consentimento) → token
 * (PKCE) → chamada MCP → refresh com rotação → revogação.
 */
import { createHash, randomBytes } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import { dbTeste, limparBanco } from "@/test/db";
import { invalidarCachePipelines } from "@/lib/fases/cache";
import { GET as metadadosRecursoGET } from "@/app/.well-known/oauth-protected-resource/api/mcp/route";
import { GET as metadadosAsGET } from "@/app/.well-known/oauth-authorization-server/route";
import { POST as registrarPOST } from "@/app/api/oauth/register/route";
import { POST as tokenPOST } from "@/app/api/oauth/token/route";
import { POST as revogarPOST } from "@/app/api/oauth/revoke/route";
import { DELETE as mcpDELETE, POST as mcpPOST } from "@/app/api/mcp/route";
import { autenticarAcesso, autorizar, listarConexoes, revogarConexao, validarPedidoAutorizacao } from "./oauth";

const db = dbTeste();
const BASE = "http://localhost:3000";
const CALLBACK = "https://claude.ai/api/mcp/auth_callback";

beforeEach(async () => {
  await limparBanco(["mcp_conexao", "oauth_codigo", "oauth_cliente", "transicao_fase", "timeline", "oportunidade", "fase", "pipeline", "sessao", "usuario"]);
  invalidarCachePipelines();
  await db.pipeline.create({ data: { chave: "vendas", nome: "Vendas", ordem: 0, fases: { create: [{ chave: "primeiro_contato", nome: "Primeiro Contato", ordem: 0 }] } } });
});

function pkce() {
  const verifier = randomBytes(32).toString("base64url");
  return { verifier, challenge: createHash("sha256").update(verifier).digest("base64url") };
}

async function registrar(redirectUris = [CALLBACK]): Promise<string> {
  const r = await registrarPOST(
    new Request(`${BASE}/api/oauth/register`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ client_name: "Claude", redirect_uris: redirectUris, token_endpoint_auth_method: "client_secret_post" }),
    }),
  );
  expect(r.status).toBe(201);
  const c = await r.json();
  // Sempre público: a RFC 7591 deixa o servidor trocar o método pedido.
  expect(c.token_endpoint_auth_method).toBe("none");
  return c.client_id;
}

function token(campos: Record<string, string>) {
  return tokenPOST(
    new Request(`${BASE}/api/oauth/token`, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams(campos).toString() }),
  );
}

function mcp(corpo: object, acesso?: string) {
  return mcpPOST(
    new Request(`${BASE}/api/mcp`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        ...(acesso ? { authorization: `Bearer ${acesso}` } : {}),
      },
      body: JSON.stringify(corpo),
    }),
  );
}

/** Do registro ao token, como o Claude faz; devolve tokens + ids. */
async function conectar(papel: "VENDEDOR" | "VISUALIZADOR" = "VENDEDOR") {
  const u = await db.usuario.create({ data: { nome: "Ana", email: `ana-${papel}@ij.test`, papel } });
  const clientId = await registrar();
  const { verifier, challenge } = pkce();
  const v = await validarPedidoAutorizacao({
    response_type: "code",
    client_id: clientId,
    redirect_uri: CALLBACK,
    code_challenge: challenge,
    code_challenge_method: "S256",
    state: "st-1",
    resource: `${BASE}/api/mcp`,
  });
  if (!v.ok) throw new Error("pedido devia ser válido");
  const volta = new URL(await autorizar(v.pedido, u.id));
  expect(volta.origin + volta.pathname).toBe(CALLBACK);
  expect(volta.searchParams.get("state")).toBe("st-1");
  expect(volta.searchParams.get("iss")).toBe(BASE);
  const code = volta.searchParams.get("code")!;
  const r = await token({ grant_type: "authorization_code", code, code_verifier: verifier, redirect_uri: CALLBACK, client_id: clientId, resource: `${BASE}/api/mcp` });
  expect(r.status).toBe(200);
  expect(r.headers.get("cache-control")).toBe("no-store");
  const t = await r.json();
  expect(t).toMatchObject({ token_type: "Bearer", expires_in: 3600, scope: "crm" });
  return { usuario: u, clientId, code, verifier, acesso: t.access_token as string, refresh: t.refresh_token as string };
}

describe("descoberta", () => {
  it("401 sem token aponta para os metadados do recurso; eles apontam para o servidor de autorização", async () => {
    const r = await mcp({ jsonrpc: "2.0", id: 1, method: "tools/list" });
    expect(r.status).toBe(401);
    expect(r.headers.get("www-authenticate")).toBe(`Bearer resource_metadata="${BASE}/.well-known/oauth-protected-resource/api/mcp", scope="crm"`);
    const prm = await metadadosRecursoGET().json();
    expect(prm).toMatchObject({ resource: `${BASE}/api/mcp`, authorization_servers: [BASE] });
    const as = await metadadosAsGET().json();
    expect(as).toMatchObject({
      issuer: BASE,
      authorization_endpoint: `${BASE}/oauth/autorizar`,
      token_endpoint: `${BASE}/api/oauth/token`,
      registration_endpoint: `${BASE}/api/oauth/register`,
      code_challenge_methods_supported: ["S256"],
      token_endpoint_auth_methods_supported: ["none"],
      authorization_response_iss_parameter_supported: true,
    });
    // Sem CIMD anunciado: os clientes do Claude usam DCR (ver oauth.ts).
    expect(as).not.toHaveProperty("client_id_metadata_document_supported");
  });
});

describe("fluxo completo: registro → autorizar → token → MCP → refresh → revogar", () => {
  it("lista ferramentas, chama uma (Timeline via MCP) e corta tudo ao revogar", async () => {
    const s = await conectar();
    const init = await mcp(
      { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "teste", version: "1" } } },
      s.acesso,
    );
    expect(init.status).toBe(200);
    expect((await init.json()).result.serverInfo.name).toBe("ij-crm");

    const lista = await (await mcp({ jsonrpc: "2.0", id: 2, method: "tools/list" }, s.acesso)).json();
    const nomes = lista.result.tools.map((t: { name: string }) => t.name);
    expect(nomes).toEqual(expect.arrayContaining(["buscar_projetos", "ler_projeto", "criar_projeto", "atualizar_projeto", "mover_projeto", "registrar_nota"]));
    expect(lista.result.tools.find((t: { name: string }) => t.name === "ler_projeto").annotations.readOnlyHint).toBe(true);

    const chamada = await (
      await mcp({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "criar_projeto", arguments: { titulo: "Padaria" } } }, s.acesso)
    ).json();
    expect(chamada.result.isError).toBeFalsy();
    const { id } = JSON.parse(chamada.result.content[0].text);
    const tl = await db.timeline.findFirstOrThrow({ where: { projetoId: id } });
    expect(tl).toMatchObject({ viaMcp: true, usuarioId: s.usuario.id });

    // Perfil lista a conexão com o nome do cliente.
    expect((await listarConexoes(s.usuario.id)).map((c) => c.cliente)).toEqual(["Claude"]);

    // Refresh gira os dois tokens: os antigos deixam de valer.
    const r = await token({ grant_type: "refresh_token", refresh_token: s.refresh, client_id: s.clientId });
    expect(r.status).toBe(200);
    const novo = await r.json();
    expect(novo.refresh_token).not.toBe(s.refresh);
    expect((await mcp({ jsonrpc: "2.0", id: 4, method: "tools/list" }, s.acesso)).status).toBe(401);
    expect((await mcp({ jsonrpc: "2.0", id: 5, method: "tools/list" }, novo.access_token)).status).toBe(200);
    const reuso = await token({ grant_type: "refresh_token", refresh_token: s.refresh, client_id: s.clientId });
    expect(reuso.status).toBe(400);
    expect((await reuso.json()).error).toBe("invalid_grant");

    // Revogação (RFC 7009) pelo refresh: a conexão inteira cai.
    const rev = await revogarPOST(
      new Request(`${BASE}/api/oauth/revoke`, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: `token=${novo.refresh_token}` }),
    );
    expect(rev.status).toBe(200);
    const depois = await mcp({ jsonrpc: "2.0", id: 6, method: "tools/list" }, novo.access_token);
    expect(depois.status).toBe(401);
    expect(depois.headers.get("www-authenticate")).toContain('error="invalid_token"');
    expect(await listarConexoes(s.usuario.id)).toEqual([]);
  });

  it("revogar pelo perfil corta o token na hora; id de outra pessoa não tem efeito", async () => {
    const s = await conectar();
    const [c] = await listarConexoes(s.usuario.id);
    const outro = await db.usuario.create({ data: { nome: "Bia", email: "bia@ij.test" } });
    expect(await revogarConexao(outro.id, c.id)).toBe(false);
    expect(await autenticarAcesso(s.acesso)).not.toBeNull();
    expect(await revogarConexao(s.usuario.id, c.id)).toBe(true);
    expect(await autenticarAcesso(s.acesso)).toBeNull();
  });

  it("VISUALIZADOR conecta e lê; escrever volta erro útil e nada grava", async () => {
    const s = await conectar("VISUALIZADOR");
    const r = await (await mcp({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "criar_projeto", arguments: { titulo: "X" } } }, s.acesso)).json();
    expect(r.result.isError).toBe(true);
    expect(r.result.content[0].text).toMatch(/só de visualização/);
    expect(await db.projeto.count()).toBe(0);
    const lida = await (await mcp({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "buscar_projetos", arguments: {} } }, s.acesso)).json();
    expect(lida.result.isError).toBeFalsy();
    // Ferramenta sem argumentos (o Claude pode omitir `arguments`).
    const fases = await (await mcp({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "listar_fases" } }, s.acesso)).json();
    expect(JSON.parse(fases.result.content[0].text).quadros[0].quadro).toBe("vendas");
  });

  it("papel e ativo lidos a cada request: rebaixar vale na hora; inativar derruba o token e o refresh", async () => {
    const s = await conectar();
    await db.usuario.update({ where: { id: s.usuario.id }, data: { papel: "VISUALIZADOR" } });
    expect((await autenticarAcesso(s.acesso))?.usuario.papel).toBe("VISUALIZADOR");
    await db.usuario.update({ where: { id: s.usuario.id }, data: { ativo: false } });
    expect(await autenticarAcesso(s.acesso)).toBeNull();
    expect((await (await token({ grant_type: "refresh_token", refresh_token: s.refresh })).json()).error).toBe("invalid_grant");
  });

  it("access token vencido → null (401); GET/DELETE sem sessão → 405 com token válido", async () => {
    const s = await conectar();
    expect(await autenticarAcesso(s.acesso, new Date(Date.now() + 3601_000))).toBeNull();
    const del = await mcpDELETE(new Request(`${BASE}/api/mcp`, { method: "DELETE", headers: { authorization: `Bearer ${s.acesso}` } }));
    expect(del.status).toBe(405);
  });
});

describe("token: o código é de uso único e preso ao PKCE, ao cliente e ao redirect", () => {
  it("código reusado → invalid_grant", async () => {
    const s = await conectar();
    const r = await token({ grant_type: "authorization_code", code: s.code, code_verifier: s.verifier, redirect_uri: CALLBACK, client_id: s.clientId });
    expect(r.status).toBe(400);
    expect((await r.json()).error).toBe("invalid_grant");
  });

  it("verifier errado, outro cliente, outro redirect ou outro resource → recusado", async () => {
    const u = await db.usuario.create({ data: { nome: "Ana", email: "ana@ij.test" } });
    const clientId = await registrar();
    const outroCliente = await registrar();
    const casos: [Record<string, string>, string][] = [
      [{ code_verifier: pkce().verifier }, "invalid_grant"],
      [{ client_id: outroCliente }, "invalid_grant"],
      [{ redirect_uri: "https://claude.ai/outro" }, "invalid_grant"],
      [{ resource: "https://evil.test/api/mcp" }, "invalid_target"],
    ];
    for (const [troca, esperado] of casos) {
      const { verifier, challenge } = pkce();
      const v = await validarPedidoAutorizacao({ response_type: "code", client_id: clientId, redirect_uri: CALLBACK, code_challenge: challenge, code_challenge_method: "S256" });
      if (!v.ok) throw new Error("pedido devia ser válido");
      const code = new URL(await autorizar(v.pedido, u.id)).searchParams.get("code")!;
      const r = await token({ grant_type: "authorization_code", code, code_verifier: verifier, redirect_uri: CALLBACK, client_id: clientId, ...troca });
      expect((await r.json()).error, JSON.stringify(troca)).toBe(esperado);
    }
    expect(await db.mcpConexao.count()).toBe(0);
  });
});

describe("autorização: o que redireciona e o que não", () => {
  it("cliente desconhecido ou redirect não registrado: não redireciona (open redirect)", async () => {
    const clientId = await registrar();
    const { challenge } = pkce();
    const base = { response_type: "code", code_challenge: challenge, code_challenge_method: "S256" };
    expect(await validarPedidoAutorizacao({ ...base, client_id: "mcp_x", redirect_uri: CALLBACK })).toMatchObject({ ok: false, redirecionar: false });
    expect(await validarPedidoAutorizacao({ ...base, client_id: clientId, redirect_uri: "https://evil.test/cb" })).toMatchObject({ ok: false, redirecionar: false });
  });

  it("sem PKCE, plain ou resource de outro servidor: volta ao cliente com o erro, o state e o iss", async () => {
    const clientId = await registrar();
    const { challenge } = pkce();
    const base = { response_type: "code", client_id: clientId, redirect_uri: CALLBACK, state: "s9" };
    const casos: [Record<string, string>, string][] = [
      [{}, "invalid_request"],
      [{ code_challenge: challenge, code_challenge_method: "plain" }, "invalid_request"],
      [{ code_challenge: challenge, code_challenge_method: "S256", resource: "https://evil.test/mcp" }, "invalid_target"],
      [{ code_challenge: challenge, code_challenge_method: "S256", response_type: "token" }, "unsupported_response_type"],
    ];
    for (const [extra, erro] of casos) {
      const v = await validarPedidoAutorizacao({ ...base, ...extra });
      if (v.ok || !v.redirecionar) throw new Error("devia redirecionar com erro");
      const u = new URL(v.url);
      expect(u.searchParams.get("error")).toBe(erro);
      expect(u.searchParams.get("state")).toBe("s9");
      expect(u.searchParams.get("iss")).toBe(BASE);
    }
  });

  it("Claude Code: loopback registrado sem porta aceita qualquer porta", async () => {
    const clientId = await registrar(["http://localhost/callback", "http://127.0.0.1/callback"]);
    const { challenge } = pkce();
    const v = await validarPedidoAutorizacao({
      response_type: "code",
      client_id: clientId,
      redirect_uri: "http://localhost:51234/callback",
      code_challenge: challenge,
      code_challenge_method: "S256",
    });
    expect(v.ok).toBe(true);
  });

  it("registro recusa redirect http fora de loopback", async () => {
    const r = await registrarPOST(
      new Request(`${BASE}/api/oauth/register`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ redirect_uris: ["http://evil.test/cb"] }) }),
    );
    expect(r.status).toBe(400);
    expect((await r.json()).error).toBe("invalid_redirect_uri");
  });
});
