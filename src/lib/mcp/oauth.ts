/**
 * Servidor de autorização OAuth 2.1 do conector MCP (GAB-83). Mínimo que o
 * claude.ai, o Claude Desktop e o Claude Code precisam (spec MCP 2026-07-28,
 * "Authorization", e a doc de conectores do Claude):
 * - Dynamic Client Registration (RFC 7591) só de cliente PÚBLICO (sem segredo);
 * - authorization code + PKCE S256 obrigatório; `iss` no retorno (RFC 9207);
 * - `resource` (RFC 8707): se vier, tem de ser este servidor MCP;
 * - access token de 1 h e refresh token de 30 dias que GIRA a cada uso.
 *
 * Login e consentimento usam a sessão normal do CRM (tela `/oauth/autorizar`).
 * Nenhum token fica em claro: o banco guarda sha256, como a sessão. O token é
 * opaco (não JWT): validar = 1 busca por hash, e revogar = apagar a linha.
 *
 * Client ID Metadata Documents (CIMD) NÃO são anunciados de propósito: exigiriam
 * o servidor buscar URLs arbitrárias (SSRF). Sem o anúncio, os clientes do Claude
 * caem no DCR, que funciona em todas as superfícies.
 */
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import type { Papel } from "@prisma/client";
import { db } from "@/lib/db";
import { registrarErro } from "@/lib/erros/registrar";
import { recursoMcp, urlBase } from "./url";

export const ESCOPO = "crm";
export const ACESSO_TTL_S = 60 * 60;
export const REFRESH_TTL_DIAS = 30;
export const CODIGO_TTL_S = 5 * 60;
/** `ultimo_uso_em` da conexão regravado no máximo a cada N minutos (como a sessão). */
const TOQUE_MINUTOS = 5;
/** Cliente registrado que nunca conectou some depois disso (DCR é aberto, sem login). */
const CLIENTE_ORFAO_DIAS = 7;

const NOME_MAX = 100;
const REDIRECTS_MAX = 10;
const URI_MAX = 2000;

export function hashToken(valor: string): string {
  return createHash("sha256").update(valor).digest("hex");
}

function novoToken(): string {
  return randomBytes(32).toString("hex");
}

// ---------------------------------------------------------------- regras puras

const LOOPBACK = new Set(["localhost", "127.0.0.1", "[::1]"]);

function ehLoopback(u: URL): boolean {
  return u.protocol === "http:" && LOOPBACK.has(u.hostname);
}

/** URI aceitável num registro: https sem fragmento, ou http em loopback (cliente nativo, RFC 8252). */
function redirectValido(bruto: unknown): bruto is string {
  if (typeof bruto !== "string" || bruto.length > URI_MAX) return false;
  let u: URL;
  try {
    u = new URL(bruto);
  } catch {
    return false;
  }
  if (u.hash) return false;
  return u.protocol === "https:" || ehLoopback(u);
}

/**
 * O redirect_uri do pedido é um dos registrados? Comparação exata, exceto
 * loopback: o Claude Code sobe numa porta efêmera diferente a cada login e
 * declara `http://localhost/callback`, então a porta é ignorada (RFC 8252
 * §7.3; a doc do Claude pede o mesmo para `localhost`).
 */
export function redirectPermitido(registrados: readonly string[], pedido: string): boolean {
  if (registrados.includes(pedido)) return true;
  let p: URL;
  try {
    p = new URL(pedido);
  } catch {
    return false;
  }
  if (!ehLoopback(p)) return false;
  return registrados.some((r) => {
    try {
      const u = new URL(r);
      return ehLoopback(u) && LOOPBACK.has(p.hostname) && u.pathname === p.pathname && u.search === p.search;
    } catch {
      return false;
    }
  });
}

/** PKCE S256: base64url(sha256(verifier)) === challenge; verifier com 43..128 caracteres (RFC 7636). */
export function pkceConfere(verifier: string, challenge: string): boolean {
  if (!/^[A-Za-z0-9._~-]{43,128}$/.test(verifier)) return false;
  const calculado = Buffer.from(createHash("sha256").update(verifier).digest("base64url"));
  const esperado = Buffer.from(challenge);
  return calculado.length === esperado.length && timingSafeEqual(calculado, esperado);
}

function normalizarRecurso(bruto: string): string | null {
  try {
    const u = new URL(bruto);
    if (u.hash) return null;
    return `${u.protocol}//${u.host}${u.pathname.replace(/\/+$/, "")}${u.search}`.toLowerCase();
  } catch {
    return null;
  }
}

/** `resource` ausente vale (só existe um recurso); presente tem de ser este servidor MCP. */
export function recursoConfere(bruto: string | undefined | null): boolean {
  if (bruto === undefined || bruto === null || bruto === "") return true;
  return normalizarRecurso(bruto) === normalizarRecurso(recursoMcp());
}

// ---------------------------------------------------------------- registro (DCR)

export type ClienteRegistrado = {
  client_id: string;
  client_id_issued_at: number;
  client_name: string;
  redirect_uris: string[];
  grant_types: string[];
  response_types: string[];
  token_endpoint_auth_method: "none";
};

export type ErroRegistro = { error: "invalid_redirect_uri" | "invalid_client_metadata"; error_description: string };

/**
 * RFC 7591. Cliente sempre público (`token_endpoint_auth_method: none`), mesmo
 * se pedir segredo: a RFC deixa o servidor trocar o metadado e devolver o real.
 * Limpa, de passagem, clientes que nunca conectaram e códigos vencidos.
 */
export async function registrarCliente(meta: unknown, agora: Date = new Date()): Promise<{ ok: true; cliente: ClienteRegistrado } | { ok: false; erro: ErroRegistro }> {
  if (!meta || typeof meta !== "object" || Array.isArray(meta)) {
    return { ok: false, erro: { error: "invalid_client_metadata", error_description: "Corpo JSON inválido." } };
  }
  const m = meta as Record<string, unknown>;
  const uris = m.redirect_uris;
  if (!Array.isArray(uris) || uris.length === 0 || uris.length > REDIRECTS_MAX || !uris.every(redirectValido)) {
    return {
      ok: false,
      erro: { error: "invalid_redirect_uri", error_description: "redirect_uris: de 1 a 10 URLs https (ou http em localhost/127.0.0.1), sem fragmento." },
    };
  }
  const grants = m.grant_types;
  if (grants !== undefined && (!Array.isArray(grants) || !grants.includes("authorization_code"))) {
    return { ok: false, erro: { error: "invalid_client_metadata", error_description: "grant_types precisa incluir authorization_code." } };
  }
  const nome = typeof m.client_name === "string" && m.client_name.trim() ? m.client_name.trim().slice(0, NOME_MAX) : "Cliente MCP";

  await limparOrfaos(agora);
  const c = await db.oauthCliente.create({ data: { id: `mcp_${randomBytes(16).toString("hex")}`, nome, redirectUris: uris, criadoEm: agora } });
  return {
    ok: true,
    cliente: {
      client_id: c.id,
      client_id_issued_at: Math.floor(c.criadoEm.getTime() / 1000),
      client_name: c.nome,
      redirect_uris: c.redirectUris,
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
    },
  };
}

async function limparOrfaos(agora: Date): Promise<void> {
  try {
    await db.oauthCodigo.deleteMany({ where: { expiraEm: { lte: agora } } });
    await db.oauthCliente.deleteMany({
      where: { criadoEm: { lte: new Date(agora.getTime() - CLIENTE_ORFAO_DIAS * 86_400_000) }, conexoes: { none: {} }, codigos: { none: {} } },
    });
  } catch (e) {
    // Limpeza é oportunista: falha aqui não impede o registro.
    registrarErro("mcp.oauth.limparOrfaos", e);
  }
}

// ---------------------------------------------------------------- autorização

export type PedidoAutorizacao = {
  clienteId: string;
  clienteNome: string;
  redirectUri: string;
  codeChallenge: string;
  state: string | null;
};

export type ValidacaoAutorizacao =
  | { ok: true; pedido: PedidoAutorizacao }
  /** Cliente ou redirect_uri inválido: NÃO redireciona (seria open redirect); a tela mostra o erro. */
  | { ok: false; redirecionar: false; descricao: string }
  /** Demais erros voltam ao cliente pelo redirect_uri (RFC 6749 §4.1.2.1). */
  | { ok: false; redirecionar: true; url: string };

type Params = Record<string, string | undefined>;

/** Parâmetros do pedido de autorização que a tela lê e repassa (ocultos) ao consentimento. */
export const CAMPOS_PEDIDO = ["response_type", "client_id", "redirect_uri", "code_challenge", "code_challenge_method", "state", "scope", "resource"] as const;

/** Valida a query de `/oauth/autorizar` (e de novo no POST do consentimento). */
export async function validarPedidoAutorizacao(q: Params): Promise<ValidacaoAutorizacao> {
  const clienteId = q.client_id;
  const redirectUri = q.redirect_uri;
  if (!clienteId || !redirectUri) return { ok: false, redirecionar: false, descricao: "Pedido sem client_id ou redirect_uri." };
  const c = await db.oauthCliente.findUnique({ where: { id: clienteId } });
  if (!c) return { ok: false, redirecionar: false, descricao: "Cliente desconhecido. Remova o conector no Claude e adicione de novo." };
  if (!redirectPermitido(c.redirectUris, redirectUri)) {
    return { ok: false, redirecionar: false, descricao: "redirect_uri não registrado para este cliente." };
  }
  const state = q.state ?? null;
  const erro = (error: string, descricao: string): ValidacaoAutorizacao => ({
    ok: false,
    redirecionar: true,
    url: urlDeRetorno(redirectUri, { error, error_description: descricao, state }),
  });
  if (q.response_type !== "code") return erro("unsupported_response_type", "Só response_type=code.");
  if (!q.code_challenge || !/^[A-Za-z0-9_-]{43}$/.test(q.code_challenge)) return erro("invalid_request", "PKCE obrigatório: code_challenge S256.");
  if (q.code_challenge_method !== "S256") return erro("invalid_request", "Só code_challenge_method=S256.");
  if (!recursoConfere(q.resource)) return erro("invalid_target", "resource não é este servidor MCP.");
  return { ok: true, pedido: { clienteId: c.id, clienteNome: c.nome, redirectUri, codeChallenge: q.code_challenge, state } };
}

/** redirect_uri + parâmetros + `iss` (RFC 9207). */
export function urlDeRetorno(redirectUri: string, params: Record<string, string | null | undefined>): string {
  const u = new URL(redirectUri);
  for (const [k, v] of Object.entries(params)) if (v !== null && v !== undefined) u.searchParams.set(k, v);
  u.searchParams.set("iss", urlBase());
  return u.toString();
}

/** Pessoa autorizou: grava o código (uso único, 5 min) e devolve a URL de volta ao cliente. */
export async function autorizar(pedido: PedidoAutorizacao, usuarioId: string, agora: Date = new Date()): Promise<string> {
  const codigo = novoToken();
  await db.oauthCodigo.create({
    data: {
      id: hashToken(codigo),
      clienteId: pedido.clienteId,
      usuarioId,
      redirectUri: pedido.redirectUri,
      codeChallenge: pedido.codeChallenge,
      escopo: ESCOPO,
      expiraEm: new Date(agora.getTime() + CODIGO_TTL_S * 1000),
      criadoEm: agora,
    },
  });
  return urlDeRetorno(pedido.redirectUri, { code: codigo, state: pedido.state });
}

/** Pessoa negou: volta ao cliente com `access_denied`. */
export function negar(pedido: PedidoAutorizacao): string {
  return urlDeRetorno(pedido.redirectUri, { error: "access_denied", error_description: "A pessoa não autorizou.", state: pedido.state });
}

// ---------------------------------------------------------------- token

export type RespostaToken = {
  access_token: string;
  token_type: "Bearer";
  expires_in: number;
  refresh_token: string;
  scope: string;
};

export type ErroToken = {
  error: "invalid_request" | "invalid_client" | "invalid_grant" | "unsupported_grant_type" | "invalid_target";
  error_description: string;
};

export type ResultadoToken = { ok: true; token: RespostaToken } | { ok: false; erro: ErroToken };

function falha(error: ErroToken["error"], error_description: string): ResultadoToken {
  return { ok: false, erro: { error, error_description } };
}

function paresNovos(agora: Date) {
  const acesso = novoToken();
  const refresh = novoToken();
  return {
    acesso,
    refresh,
    dados: {
      acessoHash: hashToken(acesso),
      acessoExpiraEm: new Date(agora.getTime() + ACESSO_TTL_S * 1000),
      refreshHash: hashToken(refresh),
      refreshExpiraEm: new Date(agora.getTime() + REFRESH_TTL_DIAS * 86_400_000),
    },
  };
}

function resposta(acesso: string, refresh: string): RespostaToken {
  return { access_token: acesso, token_type: "Bearer", expires_in: ACESSO_TTL_S, refresh_token: refresh, scope: ESCOPO };
}

/** Corpo do POST `/api/oauth/token` (form-urlencoded), já como objeto. */
export async function emitirToken(f: Params, agora: Date = new Date()): Promise<ResultadoToken> {
  if (f.grant_type === "authorization_code") return trocarCodigo(f, agora);
  if (f.grant_type === "refresh_token") return renovar(f, agora);
  return falha("unsupported_grant_type", "Use authorization_code ou refresh_token.");
}

async function trocarCodigo(f: Params, agora: Date): Promise<ResultadoToken> {
  if (!f.code || !f.code_verifier || !f.redirect_uri || !f.client_id) {
    return falha("invalid_request", "Faltam code, code_verifier, redirect_uri ou client_id.");
  }
  if (!recursoConfere(f.resource)) return falha("invalid_target", "resource não é este servidor MCP.");
  // Uso único: apaga ao ler, mesmo se o resto falhar. Duas trocas simultâneas do
  // mesmo código → só uma apaga a linha (count 1); a outra recebe invalid_grant.
  const c = await db.oauthCodigo.findUnique({ where: { id: hashToken(f.code) } });
  if (!c) return falha("invalid_grant", "Código inválido, vencido ou já usado.");
  const consumido = await db.oauthCodigo.deleteMany({ where: { id: c.id } });
  if (consumido.count === 0) return falha("invalid_grant", "Código inválido, vencido ou já usado.");
  if (c.expiraEm.getTime() <= agora.getTime()) return falha("invalid_grant", "Código vencido. Conecte de novo.");
  if (c.clienteId !== f.client_id) return falha("invalid_grant", "Código emitido para outro cliente.");
  if (c.redirectUri !== f.redirect_uri) return falha("invalid_grant", "redirect_uri diferente do usado na autorização.");
  if (!pkceConfere(f.code_verifier, c.codeChallenge)) return falha("invalid_grant", "code_verifier não confere (PKCE).");
  const u = await db.usuario.findUnique({ where: { id: c.usuarioId }, select: { ativo: true } });
  if (!u?.ativo) return falha("invalid_grant", "Usuário inativo.");

  const par = paresNovos(agora);
  await db.mcpConexao.create({
    data: { usuarioId: c.usuarioId, clienteId: c.clienteId, escopo: c.escopo, ...par.dados, criadoEm: agora, ultimoUsoEm: agora },
  });
  return { ok: true, token: resposta(par.acesso, par.refresh) };
}

/**
 * Refresh com rotação (OAuth 2.1 para cliente público): o refresh usado deixa
 * de valer na mesma escrita que grava o novo. O `where` com o hash antigo faz
 * dois refresh simultâneos girarem uma vez só (o outro recebe invalid_grant).
 */
async function renovar(f: Params, agora: Date): Promise<ResultadoToken> {
  if (!f.refresh_token) return falha("invalid_request", "Falta refresh_token.");
  if (!recursoConfere(f.resource)) return falha("invalid_target", "resource não é este servidor MCP.");
  const atual = await db.mcpConexao.findUnique({
    where: { refreshHash: hashToken(f.refresh_token) },
    select: { id: true, clienteId: true, refreshHash: true, refreshExpiraEm: true, usuario: { select: { ativo: true } } },
  });
  if (!atual || atual.refreshExpiraEm.getTime() <= agora.getTime()) return falha("invalid_grant", "Refresh token inválido ou vencido. Conecte de novo.");
  if (f.client_id && f.client_id !== atual.clienteId) return falha("invalid_grant", "Refresh token de outro cliente.");
  if (!atual.usuario.ativo) return falha("invalid_grant", "Usuário inativo.");
  const par = paresNovos(agora);
  const r = await db.mcpConexao.updateMany({ where: { id: atual.id, refreshHash: atual.refreshHash }, data: { ...par.dados, ultimoUsoEm: agora } });
  if (r.count === 0) return falha("invalid_grant", "Refresh token já usado.");
  return { ok: true, token: resposta(par.acesso, par.refresh) };
}

/** RFC 7009: revoga a conexão do token (de acesso ou refresh). Token desconhecido → nada (sem erro). */
export async function revogarToken(token: string): Promise<void> {
  const h = hashToken(token);
  await db.mcpConexao.deleteMany({ where: { OR: [{ acessoHash: h }, { refreshHash: h }] } });
}

// ---------------------------------------------------------------- recurso (/api/mcp)

export type UsuarioMcp = { id: string; nome: string; papel: Papel };

/**
 * Bearer → usuário. Token vencido, revogado ou de usuário inativo → null (401).
 * O papel é lido a cada request: mudou na Gestão, vale na hora no MCP também.
 */
export async function autenticarAcesso(token: string, agora: Date = new Date()): Promise<{ usuario: UsuarioMcp; conexaoId: string } | null> {
  if (!/^[0-9a-f]{64}$/.test(token)) return null;
  const c = await db.mcpConexao.findUnique({
    where: { acessoHash: hashToken(token) },
    select: { id: true, acessoExpiraEm: true, ultimoUsoEm: true, usuario: { select: { id: true, nome: true, papel: true, ativo: true } } },
  });
  if (!c || c.acessoExpiraEm.getTime() <= agora.getTime() || !c.usuario.ativo) return null;
  const limite = new Date(agora.getTime() - TOQUE_MINUTOS * 60_000);
  if (c.ultimoUsoEm.getTime() <= limite.getTime()) {
    try {
      await db.mcpConexao.updateMany({ where: { id: c.id, ultimoUsoEm: { lte: limite } }, data: { ultimoUsoEm: agora } });
    } catch (e) {
      registrarErro("mcp.oauth.tocarConexao", e);
    }
  }
  const { id, nome, papel } = c.usuario;
  return { usuario: { id, nome, papel }, conexaoId: c.id };
}

// ---------------------------------------------------------------- perfil

export type ConexaoListada = { id: string; cliente: string; criadoEm: Date; ultimoUsoEm: Date };

/** Conexões vivas (refresh ainda vale) do usuário, uso mais recente primeiro. */
export async function listarConexoes(usuarioId: string, agora: Date = new Date()): Promise<ConexaoListada[]> {
  const lista = await db.mcpConexao.findMany({
    where: { usuarioId, refreshExpiraEm: { gt: agora } },
    orderBy: [{ ultimoUsoEm: "desc" }, { criadoEm: "desc" }],
    select: { id: true, criadoEm: true, ultimoUsoEm: true, cliente: { select: { nome: true } } },
  });
  return lista.map((c) => ({ id: c.id, cliente: c.cliente.nome, criadoEm: c.criadoEm, ultimoUsoEm: c.ultimoUsoEm }));
}

/** Revoga UMA conexão, só se for do próprio usuário (id de outra pessoa → nada). */
export async function revogarConexao(usuarioId: string, conexaoId: string): Promise<boolean> {
  const r = await db.mcpConexao.deleteMany({ where: { id: conexaoId, usuarioId } });
  return r.count > 0;
}
