// @vitest-environment node
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { caminhoDoAnexo, diretorioAnexos, gravarArquivo, lerArquivo, novoIdAnexo, removerArquivo } from "./armazenamento";

let dir: string;
let antes: string | undefined;
beforeEach(async () => {
  antes = process.env.ANEXOS_DIR;
  dir = await mkdtemp(path.join(tmpdir(), "anexos-"));
  process.env.ANEXOS_DIR = path.join(dir, "sub"); // ainda não existe: é criado na 1ª gravação
});
afterEach(async () => {
  if (antes === undefined) delete process.env.ANEXOS_DIR;
  else process.env.ANEXOS_DIR = antes;
  await rm(dir, { recursive: true, force: true });
});

describe("armazenamento de anexos", () => {
  it("ANEXOS_DIR configura o diretório; sem ele, .anexos no diretório do app", () => {
    expect(diretorioAnexos()).toBe(path.join(dir, "sub"));
    delete process.env.ANEXOS_DIR;
    expect(diretorioAnexos()).toBe(path.join(process.cwd(), ".anexos"));
  });

  it("grava pelo id (nunca pelo nome do usuário), lê e remove; sem sobra de arquivo temporário", async () => {
    const id = novoIdAnexo();
    expect(id).toMatch(/^[0-9a-f]{32}$/);
    await gravarArquivo(id, new Uint8Array([1, 2, 3]));
    expect(await readdir(path.join(dir, "sub"))).toEqual([id]);
    expect([...(await lerArquivo(id))]).toEqual([1, 2, 3]);
    expect([...(await readFile(caminhoDoAnexo(id)))]).toEqual([1, 2, 3]);
    await removerArquivo(id);
    expect(await readdir(path.join(dir, "sub"))).toEqual([]);
    await removerArquivo(id); // já removido: não falha
  });

  it("id fora do formato nunca vira caminho (path traversal)", async () => {
    for (const id of ["../etc/passwd", "..", "a/b", "ABC", ""]) {
      expect(() => caminhoDoAnexo(id)).toThrow(/id de anexo inválido/);
    }
  });

  it("não sobrescreve um arquivo existente", async () => {
    const id = novoIdAnexo();
    await gravarArquivo(id, new Uint8Array([1]));
    await expect(gravarArquivo(id, new Uint8Array([2]))).rejects.toThrow();
    expect([...(await lerArquivo(id))]).toEqual([1]);
  });
});
