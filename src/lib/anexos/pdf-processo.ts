/**
 * Extração de texto de PDF num PROCESSO FILHO (GAB-84, review do PR #53).
 *
 * O pdf.js descompacta cada stream inteiro, síncrono: no processo do Next, um
 * PDF de 1 MB chegou a 2,2 GB de RSS e um de 226 KB travou o event loop 17 s
 * (o app tem `mem_limit: 512m`). Aqui o PDF vai pelo stdin para
 * `pdf-filho.mjs` e o pai:
 *
 * - mata o filho por TEMPO (`TEMPO_MAX_MS`) e por MEMÓRIA: lê o `VmRSS` de
 *   `/proc/<pid>/status` a cada `INTERVALO_RSS_MS` e mata acima de
 *   `RSS_MAX_BYTES`. `ulimit -v` não serve: o V8 reserva muito endereço
 *   virtual e o Node nem sobe. O heap do V8 ainda tem `--max-old-space-size`,
 *   mas os buffers descompactados ficam fora dele — por isso o RSS;
 * - limita a saída (`SAIDA_MAX_BYTES`); o filho já corta em `TEXTO_MAX`;
 * - roda UMA extração por vez (fila): N uploads simultâneos não somam memória.
 *
 * Filho morto, estourado ou com saída inválida → `{ tipo: "falha" }`: o upload
 * segue com o anexo "sem texto" (quem chama loga a causa com ref).
 */
import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";

export const TEMPO_MAX_MS = 20_000;
export const RSS_MAX_BYTES = 200 * 1024 * 1024;
const INTERVALO_RSS_MS = 50;

export type ResultadoPdf =
  | { tipo: "texto"; paginas: string[]; total: number }
  | { tipo: "senha" }
  | { tipo: "corrompido" }
  | { tipo: "falha"; motivo: string };

export type OpcoesPdf = { textoMax: number; tempoMaxMs?: number; rssMaxBytes?: number };

/**
 * Caminho do script do filho. Relativo ao diretório do app: no standalone o
 * `server.js` faz `chdir` para a raiz dele, onde o tracing copia `src/lib/anexos/pdf-filho.mjs`.
 */
export function scriptDoFilho(): string {
  return path.join(process.cwd(), "src", "lib", "anexos", "pdf-filho.mjs");
}

/** RSS do processo em bytes; null fora do Linux ou se ele já saiu. */
async function rssDe(pid: number): Promise<number | null> {
  try {
    const m = /^VmRSS:\s+(\d+)\s+kB/m.exec(await readFile(`/proc/${pid}/status`, "utf8"));
    return m ? Number(m[1]) * 1024 : null;
  } catch {
    return null;
  }
}

function executar(bytes: Uint8Array, o: OpcoesPdf): Promise<ResultadoPdf> {
  const tempoMax = o.tempoMaxMs ?? TEMPO_MAX_MS;
  const rssMax = o.rssMaxBytes ?? RSS_MAX_BYTES;
  // JSON escapa no máximo 6 bytes por caractere (\uXXXX), mais folga para o resto.
  const saidaMax = o.textoMax * 6 + 64 * 1024;

  return new Promise((resolve) => {
    const filho = spawn(process.execPath, ["--max-old-space-size=128", scriptDoFilho()], {
      stdio: ["pipe", "pipe", "pipe"],
      // Env mínimo: o filho não precisa (nem deve ver) DATABASE_URL e segredos.
      env: { PATH: process.env.PATH ?? "", NODE_ENV: process.env.NODE_ENV, TEXTO_MAX: String(o.textoMax) } as NodeJS.ProcessEnv,
    });
    let fim: ResultadoPdf | null = null;
    let fechou = false;
    const partes: Buffer[] = [];
    let tamanho = 0;
    let erroFilho = "";

    const encerrar = (r: ResultadoPdf) => {
      if (fim) return;
      fim = r;
      clearTimeout(relogio);
      clearInterval(vigia);
      // Só libera a fila quando o filho de fato saiu (SIGKILL + `close`): a próxima
      // extração nunca começa com o anterior ainda vivo segurando memória.
      if (fechou) resolve(r);
      else filho.kill("SIGKILL");
    };

    const relogio = setTimeout(() => encerrar({ tipo: "falha", motivo: `tempo esgotado (${tempoMax} ms)` }), tempoMax);
    const vigia = setInterval(async () => {
      if (!filho.pid) return;
      const rss = await rssDe(filho.pid);
      if (rss !== null && rss > rssMax) encerrar({ tipo: "falha", motivo: `memória acima do teto (RSS ${Math.round(rss / 1024 / 1024)} MB)` });
    }, INTERVALO_RSS_MS);

    filho.stdout.on("data", (p: Buffer) => {
      tamanho += p.length;
      if (tamanho > saidaMax) return encerrar({ tipo: "falha", motivo: "saída acima do teto" });
      partes.push(p);
    });
    // Só o começo do stderr: vai para o log em caso de falha.
    filho.stderr.on("data", (p: Buffer) => {
      if (erroFilho.length < 2000) erroFilho += p.toString("utf8").slice(0, 2000 - erroFilho.length);
    });
    filho.on("error", (e) => {
      // Falha de spawn: pode não haver `close` depois.
      fechou = true;
      encerrar({ tipo: "falha", motivo: `não iniciou: ${e.message}` });
      resolve(fim!);
    });
    filho.on("close", (codigo, sinal) => {
      fechou = true;
      if (fim) return resolve(fim);
      const texto = Buffer.concat(partes).toString("utf8").trim();
      try {
        const r = JSON.parse(texto.slice(texto.lastIndexOf("\n") + 1)) as Record<string, unknown>;
        if (r.senha === true) return encerrar({ tipo: "senha" });
        if (r.corrompido === true) return encerrar({ tipo: "corrompido" });
        if (Array.isArray(r.paginas) && r.paginas.every((p) => typeof p === "string") && typeof r.total === "number") {
          const paginas = r.paginas as string[];
          // Teto também no pai: não confia no que o filho mandou.
          let resto = o.textoMax;
          return encerrar({ tipo: "texto", total: r.total, paginas: paginas.map((p) => {
            const t = p.slice(0, Math.max(0, resto));
            resto -= t.length;
            return t;
          }) });
        }
      } catch {
        // cai na falha abaixo
      }
      const ultimaLinha = erroFilho.trim().split("\n").pop() ?? "";
      encerrar({ tipo: "falha", motivo: `filho saiu (código ${codigo}, sinal ${sinal}) sem resposta válida${ultimaLinha ? `: ${ultimaLinha.slice(0, 300)}` : ""}` });
    });

    // EPIPE se o filho morrer antes de ler tudo: o `close` acima já resolve.
    filho.stdin.on("error", () => {});
    filho.stdin.end(Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength));
  });
}

let fila: Promise<unknown> = Promise.resolve();

/** Extrai em processo filho, uma extração por vez no processo do app. */
export function extrairPdfEmProcesso(bytes: Uint8Array, o: OpcoesPdf): Promise<ResultadoPdf> {
  const vez = fila.then(() => executar(bytes, o));
  fila = vez.catch(() => {});
  return vez;
}
