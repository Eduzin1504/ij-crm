/**
 * Fontes e imagens dos PDFs no modelo da IJ (GAB-100): Arimo, com as métricas da
 * Arial do modelo, e Poppins na capa (SIL OFL 1.1, ./fontes/OFL-*.txt), mais as
 * imagens da capa, da faixa e do rodapé. Lidas do disco na 1ª geração e guardadas:
 * o `server.js` do standalone faz `chdir` para a raiz dele, onde o tracing copia
 * `src/lib/pdf/fontes/*` e `src/lib/pdf/imagens/*` (next.config: outputFileTracingIncludes).
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import type { FontesTemplate, ImagensTemplate } from "./tipos";

export function dirFontes(): string {
  return path.join(process.cwd(), "src", "lib", "pdf", "fontes");
}

export function dirImagens(): string {
  return path.join(process.cwd(), "src", "lib", "pdf", "imagens");
}

/** Lê uma vez; não guarda a falha (a próxima tentativa relê). */
function umaVez<T>(carregar: () => Promise<T>): () => Promise<T> {
  let cache: Promise<T> | null = null;
  return () => {
    cache ??= carregar().catch((e) => {
      cache = null;
      throw e;
    });
    return cache;
  };
}

const ler = async (dir: string, nome: string) => new Uint8Array(await readFile(path.join(dir, nome)));

export const fontesIJ = umaVez(async (): Promise<FontesTemplate> => {
  const d = dirFontes();
  const [regular, negrito, italico, negritoItalico, capaRegular, capaNegrito] = await Promise.all(
    ["Arimo-Regular.ttf", "Arimo-Bold.ttf", "Arimo-Italic.ttf", "Arimo-BoldItalic.ttf", "Poppins-Regular.ttf", "Poppins-Bold.ttf"].map((n) => ler(d, n)),
  );
  return { regular, negrito, italico, negritoItalico, capa: { regular: capaRegular, negrito: capaNegrito } };
});

export const imagensIJ = umaVez(async (): Promise<ImagensTemplate> => {
  const d = dirImagens();
  const [capa, faixa, rodape] = await Promise.all(["capa.png", "faixa.png", "rodape.png"].map((n) => ler(d, n)));
  return { capa, faixa, rodape };
});
