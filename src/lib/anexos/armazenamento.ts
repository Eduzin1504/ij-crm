/**
 * Bytes dos anexos no disco (GAB-84). Um arquivo por anexo, com o NOME = id
 * do anexo (32 hex aleatórios), direto em `ANEXOS_DIR`. O nome que o usuário
 * deu fica só no banco: nada que vem do cliente vira caminho.
 *
 * Produção: `ANEXOS_DIR=/data/anexos`, volume nomeado `app_anexos` (compose),
 * gravável pelo usuário `node` (o Dockerfile cria o diretório com esse dono).
 * Backup/restore: docs/runbook.md, "Anexos". Dev nativo sem a variável:
 * `.anexos/` na raiz do repo (no .gitignore).
 *
 * Gravação atômica: escreve `<id>.<rand>.tmp` e renomeia; o arquivo final
 * nunca existe pela metade e nunca é sobrescrito.
 */
import { randomBytes } from "node:crypto";
import { link, mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import path from "node:path";

const ID = /^[0-9a-f]{32}$/;

/** Ids de anexo são 32 hex: qualquer outra coisa nunca chega ao disco. */
export const ehIdDeAnexo = (id: string) => ID.test(id);

export function diretorioAnexos(): string {
  const dir = process.env.ANEXOS_DIR?.trim();
  return dir ? path.resolve(dir) : path.join(process.cwd(), ".anexos");
}

export function novoIdAnexo(): string {
  return randomBytes(16).toString("hex");
}

export function caminhoDoAnexo(id: string): string {
  if (!ehIdDeAnexo(id)) throw new Error("id de anexo inválido");
  return path.join(diretorioAnexos(), id);
}

export async function gravarArquivo(id: string, bytes: Uint8Array): Promise<void> {
  const final = caminhoDoAnexo(id);
  await mkdir(path.dirname(final), { recursive: true, mode: 0o750 });
  const tmp = `${final}.${randomBytes(6).toString("hex")}.tmp`;
  await writeFile(tmp, bytes, { flag: "wx", mode: 0o640, flush: true });
  try {
    // `link` falha se o destino existe (EEXIST), ao contrário de `rename`.
    await link(tmp, final);
  } finally {
    await unlink(tmp).catch(() => {});
  }
}

export async function lerArquivo(id: string): Promise<Buffer> {
  return readFile(caminhoDoAnexo(id));
}

/** Idempotente: arquivo que já não existe não é erro. */
export async function removerArquivo(id: string): Promise<void> {
  try {
    await unlink(caminhoDoAnexo(id));
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
  }
}
