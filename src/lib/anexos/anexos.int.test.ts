// @vitest-environment node
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { dbTeste, limparBanco } from "@/test/db";
import { docxDeParagrafos, pdfBomba, pdfDeTexto, PNG } from "@/test/fixtures/anexos";
import { invalidarCachePipelines } from "@/lib/fases/cache";
import { apagarCardDefinitivo, excluirCard, restaurarCard } from "@/lib/lixeira/cards";
import { apagarAnexoDefinitivo, excluirAnexo, restaurarAnexo } from "@/lib/lixeira/anexos";
import { listarAnexosNaLixeira } from "@/lib/lixeira/lixeira";
import { mensagemLixeira } from "@/lib/lixeira/regras";
import { criarCard } from "@/lib/projetos/projetos";
import { anexarArquivo, lerTextoDoAnexo, listarAnexos, obterAnexoParaDownload } from "./anexos";
import { lerArquivo } from "./armazenamento";

const db = dbTeste();
const enc = new TextEncoder();

let dir: string;
const arquivos = async () => (await readdir(dir).catch(() => [])).sort();

async function semear() {
  const vendas = await db.pipeline.create({
    data: { chave: "vendas", nome: "Vendas", ordem: 0, fases: { create: [{ chave: "proposta", nome: "Proposta", ordem: 0 }] } },
    include: { fases: true },
  });
  const vend = await db.usuario.create({ data: { nome: "Vera Vendedora", email: "v@ij.test", papel: "VENDEDOR" } });
  const vis = await db.usuario.create({ data: { nome: "Vivi Visualizadora", email: "vi@ij.test", papel: "VISUALIZADOR" } });
  const gestor = await db.usuario.create({ data: { nome: "Gil Gestor", email: "g@ij.test", papel: "GESTOR" } });
  const admin = await db.usuario.create({ data: { nome: "Ada Admin", email: "a@ij.test", papel: "ADMIN" } });
  const r = await criarCard({ pipelineId: vendas.id, faseId: vendas.fases[0].id, titulo: "Site da padaria" }, vend);
  if (!r.ok) throw new Error(r.erro);
  return { vend, vis, gestor, admin, cardId: r.id };
}

beforeEach(async () => {
  await limparBanco(["anexo", "transicao_fase", "timeline", "oportunidade", "fase", "pipeline", "usuario"]);
  invalidarCachePipelines();
  dir = await mkdtemp(path.join(tmpdir(), "anexos-int-"));
  process.env.ANEXOS_DIR = dir;
});
afterEach(async () => {
  delete process.env.ANEXOS_DIR;
  await rm(dir, { recursive: true, force: true });
});

describe("anexarArquivo", () => {
  it("PDF digital: grava o arquivo, guarda metadados + texto extraído e registra na Timeline", async () => {
    const { vend, cardId } = await semear();
    const bytes = pdfDeTexto(["Proposta comercial para a padaria do bairro"]);
    const r = await anexarArquivo(cardId, { nome: "../Proposta v2.pdf", bytes }, vend);
    expect(r).toMatchObject({ ok: true, anexo: { nome: "Proposta v2.pdf", semTexto: false } });
    if (!r.ok) return;

    const a = await db.anexo.findUniqueOrThrow({ where: { id: r.anexo.id } });
    expect(a).toMatchObject({ projetoId: cardId, tipo: "PDF", mime: "application/pdf", tamanho: bytes.length, autorId: vend.id, semTexto: false, deletadoEm: null });
    expect(a.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(a.texto).toBe("Proposta comercial para a padaria do bairro");
    expect(await arquivos()).toEqual([a.id]);
    expect(Buffer.from(await lerArquivo(a.id)).equals(Buffer.from(bytes))).toBe(true);

    const t = await db.timeline.findFirstOrThrow({ where: { projetoId: cardId, tipo: "ANEXO" } });
    expect(t).toMatchObject({ usuarioId: vend.id, payload: { evento: "adicionado", anexoId: a.id, nome: "Proposta v2.pdf", semTexto: false } });
  });

  it(".docx, .md e .txt têm texto; imagem e PDF escaneado ficam 'sem texto'", async () => {
    const { vend, cardId } = await semear();
    const casos = [
      { nome: "escopo.docx", bytes: docxDeParagrafos(["Escopo do projeto"]), semTexto: false },
      { nome: "notas.md", bytes: enc.encode("# Reunião\nCliente quer site"), semTexto: false },
      { nome: "obs.txt", bytes: enc.encode("orçamento apertado"), semTexto: false },
      { nome: "foto.png", bytes: PNG, semTexto: true },
      { nome: "escaneado.pdf", bytes: pdfDeTexto([""]), semTexto: true },
    ];
    for (const c of casos) {
      const r = await anexarArquivo(cardId, { nome: c.nome, bytes: c.bytes }, vend);
      expect(r, c.nome).toMatchObject({ ok: true, anexo: { semTexto: c.semTexto } });
    }
    const lista = await listarAnexos(cardId);
    // Mais recente primeiro; criados no mesmo milissegundo empatam, então compara ordenado por nome.
    expect(lista.map((a) => [a.nome, a.semTexto, a.autor.nome]).sort()).toEqual([
      ["escaneado.pdf", true, "Vera Vendedora"],
      ["escopo.docx", false, "Vera Vendedora"],
      ["foto.png", true, "Vera Vendedora"],
      ["notas.md", false, "Vera Vendedora"],
      ["obs.txt", false, "Vera Vendedora"],
    ]);
    // A lista não carrega o texto (pode ter 1 MB); só o tamanho dele.
    const obs = lista.find((a) => a.nome === "obs.txt")!;
    expect(obs).not.toHaveProperty("texto");
    expect(obs.caracteres).toBe("orçamento apertado".length);
  });

  it("recusa sem gravar nada: tipo inválido, conteúdo que não confere, duplicado, card excluído, VISUALIZADOR", async () => {
    const { vend, vis, cardId } = await semear();
    expect(await anexarArquivo(cardId, { nome: "x.exe", bytes: enc.encode("MZ") }, vend)).toEqual({ ok: false, erro: "TIPO_INVALIDO" });
    expect(await anexarArquivo(cardId, { nome: "x.pdf", bytes: enc.encode("<html>") }, vend)).toEqual({ ok: false, erro: "TIPO_INVALIDO" });
    expect(await anexarArquivo(cardId, { nome: "x.png", bytes: pdfDeTexto(["a"]) }, vend)).toEqual({ ok: false, erro: "EXTENSAO_NAO_CONFERE" });
    expect(await anexarArquivo(cardId, { nome: "x.pdf", bytes: pdfDeTexto(["a"]) }, vis)).toEqual({ ok: false, erro: "SEM_PERMISSAO" });
    expect(await anexarArquivo("nao-existe", { nome: "x.pdf", bytes: pdfDeTexto(["a"]) }, vend)).toEqual({ ok: false, erro: "CARD_NAO_ENCONTRADO" });

    expect((await anexarArquivo(cardId, { nome: "a.txt", bytes: enc.encode("mesmo") }, vend)).ok).toBe(true);
    expect(await anexarArquivo(cardId, { nome: "b.txt", bytes: enc.encode("mesmo") }, vend)).toEqual({ ok: false, erro: "DUPLICADO" });

    await excluirCard(cardId, vend);
    expect(await anexarArquivo(cardId, { nome: "c.txt", bytes: enc.encode("outro") }, vend)).toEqual({ ok: false, erro: "CARD_NAO_ENCONTRADO" });
    expect(await arquivos()).toHaveLength(1);
    expect(await db.anexo.count()).toBe(1);
  });
});

describe("anexarArquivo: corridas e extração abortada (review do PR #53)", () => {
  it("dois uploads iguais ao mesmo tempo: o índice único parcial deixa só um (o outro é DUPLICADO, sem arquivo órfão)", async () => {
    const { vend, cardId } = await semear();
    const bytes = enc.encode("mesmo conteúdo");
    const rs = await Promise.all([1, 2, 3].map((n) => anexarArquivo(cardId, { nome: `c${n}.txt`, bytes }, vend)));
    expect(rs.filter((r) => r.ok)).toHaveLength(1);
    expect(rs.filter((r) => !r.ok).map((r) => !r.ok && r.erro)).toEqual(["DUPLICADO", "DUPLICADO"]);
    expect(await db.anexo.count()).toBe(1);
    expect(await arquivos()).toHaveLength(1);
    // Excluído não conta: o mesmo arquivo pode voltar.
    const vivo = rs.find((r) => r.ok)!;
    if (vivo.ok) await excluirAnexo(vivo.anexo.id, vend);
    expect((await anexarArquivo(cardId, { nome: "de-novo.txt", bytes }, vend)).ok).toBe(true);
  });

  it("upload trava a linha do card (FOR SHARE): espera um 'apagar de vez' em andamento e, com o card apagado, não grava nada", async () => {
    const { vend, cardId } = await semear();
    let liberar!: () => void;
    const travado = new Promise<void>((r) => (liberar = r));
    let comLock!: () => void;
    const lockTomado = new Promise<void>((r) => (comLock = r));
    // Simula o "apagar de vez": FOR UPDATE na linha, apaga o card e só commita quando liberado.
    const apagar = db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM oportunidade WHERE id = ${cardId} FOR UPDATE`;
      comLock();
      await travado;
      await tx.projeto.delete({ where: { id: cardId } });
    }, { timeout: 20_000 });
    await lockTomado;
    let terminou = false;
    const upload = anexarArquivo(cardId, { nome: "a.txt", bytes: enc.encode("x") }, vend).then((r) => ((terminou = true), r));
    await new Promise((r) => setTimeout(r, 500));
    expect(terminou).toBe(false); // esperando o lock
    liberar();
    await apagar;
    // Sem o FOR SHARE, o INSERT esbarraria na FK depois do DELETE e o upload estouraria (P2003).
    expect(await upload).toEqual({ ok: false, erro: "CARD_NAO_ENCONTRADO" });
    expect(await db.anexo.count()).toBe(0);
    expect(await arquivos()).toEqual([]);
  }, 30_000);

  it("PDF que estoura o processo filho: anexo entra 'sem texto' e o log tem a causa com ref", async () => {
    const { vend, cardId } = await semear();
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const r = await anexarArquivo(cardId, { nome: "bomba.pdf", bytes: pdfBomba(512) }, vend);
    expect(r).toMatchObject({ ok: true, anexo: { semTexto: true } });
    if (!r.ok) return;
    expect((await db.anexo.findUniqueOrThrow({ where: { id: r.anexo.id } })).texto).toBeNull();
    expect(log).toHaveBeenCalledWith(expect.stringMatching(new RegExp(`^\\[anexos\\.extrairTexto\\] ref=[0-9a-f]{8} Error: anexo ${r.anexo.id.slice(0, 12)} \\(PDF\\) ficou sem texto: memória acima do teto`)));
    log.mockRestore();
  }, 30_000);
});

describe("leitura e download", () => {
  it("download e texto só de anexo vivo em card vivo", async () => {
    const { vend, cardId } = await semear();
    const r = await anexarArquivo(cardId, { nome: "a.md", bytes: enc.encode("# Oi") }, vend);
    if (!r.ok) throw new Error(r.erro);
    expect(await obterAnexoParaDownload(r.anexo.id)).toMatchObject({ id: r.anexo.id, nome: "a.md", mime: "text/markdown; charset=utf-8" });
    expect(await lerTextoDoAnexo(r.anexo.id)).toMatchObject({ nome: "a.md", semTexto: false, texto: "# Oi", projetoId: cardId });
    expect(await obterAnexoParaDownload("nao-existe")).toBeNull();

    await excluirCard(cardId, vend);
    expect(await obterAnexoParaDownload(r.anexo.id)).toBeNull();
    expect(await lerTextoDoAnexo(r.anexo.id)).toBeNull();
  });
});

describe("lixeira de anexos", () => {
  it("excluir (quem escreve) → some da lista e do download, Timeline registra; gestor restaura", async () => {
    const { vend, vis, gestor, cardId } = await semear();
    const r = await anexarArquivo(cardId, { nome: "a.txt", bytes: enc.encode("conteúdo") }, vend);
    if (!r.ok) throw new Error(r.erro);
    const id = r.anexo.id;

    expect(await excluirAnexo(id, vis)).toEqual({ ok: false, erro: "SEM_PERMISSAO" });
    expect(await excluirAnexo(id, vend)).toEqual({ ok: true });
    expect(await excluirAnexo(id, vend)).toEqual({ ok: false, erro: "ANEXO_NAO_ENCONTRADO" });
    expect(await listarAnexos(cardId)).toEqual([]);
    expect(await obterAnexoParaDownload(id)).toBeNull();
    expect(await arquivos()).toEqual([id]); // o arquivo fica até apagar de vez

    expect(await listarAnexosNaLixeira("")).toMatchObject([{ id, nome: "a.txt", porNome: "Vera Vendedora", projeto: { id: cardId, titulo: "Site da padaria" } }]);
    expect(await listarAnexosNaLixeira("padaria")).toHaveLength(1);
    expect(await listarAnexosNaLixeira("nada")).toHaveLength(0);

    expect(await restaurarAnexo(id, vend)).toEqual({ ok: false, erro: "SEM_PERMISSAO" });
    expect(await restaurarAnexo(id, gestor)).toEqual({ ok: true });
    expect(await restaurarAnexo(id, gestor)).toEqual({ ok: false, erro: "NAO_ESTA_NA_LIXEIRA" });

    // Anexo de card que está na lixeira não volta sozinho (volta com o card).
    await excluirAnexo(id, vend);
    await excluirCard(cardId, vend);
    expect(await restaurarAnexo(id, gestor)).toEqual({ ok: false, erro: "ANEXO_NAO_ENCONTRADO" });
    expect(await restaurarCard(cardId, gestor)).toMatchObject({ ok: true });
    expect(await restaurarAnexo(id, gestor)).toEqual({ ok: true });
    expect((await listarAnexos(cardId)).map((a) => a.id)).toEqual([id]);

    const eventos = await db.timeline.findMany({ where: { projetoId: cardId, tipo: "ANEXO" }, orderBy: { em: "asc" } });
    expect(eventos.map((e) => (e.payload as { evento: string }).evento)).toEqual(["adicionado", "excluido", "restaurado", "excluido", "restaurado"]);
  });

  it("restaurar quando o mesmo arquivo já foi anexado de novo → ANEXO_DUPLICADO, nada muda", async () => {
    const { vend, gestor, cardId } = await semear();
    const bytes = enc.encode("mesmo conteúdo");
    const antigo = await anexarArquivo(cardId, { nome: "v1.txt", bytes }, vend);
    if (!antigo.ok) throw new Error(antigo.erro);
    await excluirAnexo(antigo.anexo.id, vend);
    const novo = await anexarArquivo(cardId, { nome: "v2.txt", bytes }, vend);
    expect(novo.ok).toBe(true);
    const r = await restaurarAnexo(antigo.anexo.id, gestor);
    expect(r).toEqual({ ok: false, erro: "ANEXO_DUPLICADO" });
    if (!r.ok) expect(mensagemLixeira(r)).toMatch(/^Já existe um anexo igual neste projeto/);
    expect((await db.anexo.findUniqueOrThrow({ where: { id: antigo.anexo.id } })).deletadoEm).not.toBeNull();
    expect((await listarAnexos(cardId)).map((a) => a.nome)).toEqual(["v2.txt"]);
  });

  it("apagar de vez: só admin, só da lixeira, digitando o nome; remove o arquivo do disco", async () => {
    const { vend, gestor, admin, cardId } = await semear();
    const r = await anexarArquivo(cardId, { nome: "a.txt", bytes: enc.encode("conteúdo") }, vend);
    if (!r.ok) throw new Error(r.erro);
    const id = r.anexo.id;

    expect(await apagarAnexoDefinitivo(id, admin, "a.txt")).toEqual({ ok: false, erro: "NAO_ESTA_NA_LIXEIRA" });
    await excluirAnexo(id, vend);
    expect(await apagarAnexoDefinitivo(id, gestor, "a.txt")).toEqual({ ok: false, erro: "SEM_PERMISSAO" });
    expect(await apagarAnexoDefinitivo(id, admin, "b.txt")).toEqual({ ok: false, erro: "CONFIRMACAO_NAO_CONFERE" });
    expect(await apagarAnexoDefinitivo(id, admin, "a.txt")).toEqual({ ok: true });
    expect(await db.anexo.count()).toBe(0);
    expect(await arquivos()).toEqual([]);
    const ultimo = await db.timeline.findFirstOrThrow({ where: { projetoId: cardId, tipo: "ANEXO" }, orderBy: { em: "desc" } });
    expect(ultimo.payload).toMatchObject({ evento: "apagado", nome: "a.txt" });
  });

  it("apagar o card de vez leva os anexos e os arquivos", async () => {
    const { vend, admin, cardId } = await semear();
    await anexarArquivo(cardId, { nome: "a.txt", bytes: enc.encode("um") }, vend);
    await anexarArquivo(cardId, { nome: "b.txt", bytes: enc.encode("dois") }, vend);
    expect(await arquivos()).toHaveLength(2);
    await excluirCard(cardId, vend);
    expect(await apagarCardDefinitivo(cardId, admin, "Site da padaria")).toEqual({ ok: true });
    expect(await db.anexo.count()).toBe(0);
    expect(await arquivos()).toEqual([]);
  });
});
