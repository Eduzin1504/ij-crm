/**
 * Fontes embutidas nos PDFs: Inter (SIL OFL 1.1, ./fontes/OFL-Inter.txt), a
 * mesma do app. Lidas do disco na 1ª geração e guardadas (≈ 1,6 MB, as quatro):
 * o `server.js` do standalone faz `chdir` para a raiz dele, onde o tracing
 * copia `src/lib/pdf/fontes/*` (next.config: outputFileTracingIncludes).
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import type { FontesTemplate } from "./tipos";

export function dirFontes(): string {
  return path.join(process.cwd(), "src", "lib", "pdf", "fontes");
}

let inter: Promise<FontesTemplate> | null = null;

export function fontesInter(): Promise<FontesTemplate> {
  inter ??= (async () => {
    const ler = async (nome: string) => new Uint8Array(await readFile(path.join(dirFontes(), nome)));
    const [regular, negrito, italico, negritoItalico] = await Promise.all([
      ler("Inter-Regular.ttf"),
      ler("Inter-Bold.ttf"),
      ler("Inter-Italic.ttf"),
      ler("Inter-BoldItalic.ttf"),
    ]);
    return { regular, negrito, italico, negritoItalico };
  })().catch((e) => {
    inter = null; // não guarda a falha: a próxima tentativa relê
    throw e;
  });
  return inter;
}
