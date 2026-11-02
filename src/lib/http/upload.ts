/**
 * Peças comuns das rotas de upload de corpo cru (import do Pipefy, anexos do
 * Projeto): o arquivo vem como o próprio corpo do POST, sem multipart, e o
 * limite é de cada rota (o limite global das server actions não sobe).
 */

/** Lê o corpo contando bytes; `null` = passou do limite (leitura cancelada). */
export async function lerCorpo(req: Request, limite: number): Promise<Uint8Array | null> {
  if (!req.body) return new Uint8Array();
  const leitor = req.body.getReader();
  const partes: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await leitor.read();
    if (done) break;
    total += value.byteLength;
    if (total > limite) {
      await leitor.cancel();
      return null;
    }
    partes.push(value);
  }
  const tudo = new Uint8Array(total);
  let pos = 0;
  for (const p of partes) {
    tudo.set(p, pos);
    pos += p.byteLength;
  }
  return tudo;
}

/** Origem do mesmo site (defesa contra POST cross-site com o cookie da sessão). */
export function mesmoSite(req: Request): boolean {
  const origem = req.headers.get("origin");
  if (!origem) return true; // navegador sempre manda em POST cross-site; ausência = mesmo site/ferramenta
  try {
    return new URL(origem).host === (req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? new URL(req.url).host);
  } catch {
    return false;
  }
}
