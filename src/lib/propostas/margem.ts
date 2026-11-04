/**
 * Onde cada cartão de comentário fica na margem da folha (GAB-100, spec proposta-folha §3):
 * na altura do trecho, e o de baixo desce se dois colidirem. Quem não tem trecho na
 * tela (geral, trecho alterado, resolvido) fica no topo da margem, à vista. Puro.
 */
export const VAO_MARGEM = 8;

export function posicoesNaMargem(itens: readonly { id: string; alvo: number | null; altura: number }[]): { topos: Record<string, number>; altura: number } {
  const semAlvo = itens.filter((i) => i.alvo === null);
  const comAlvo = itens.filter((i) => i.alvo !== null).sort((a, b) => a.alvo! - b.alvo!);
  const topos: Record<string, number> = {};
  let proximo = 0;
  let fim = 0;
  for (const i of [...semAlvo, ...comAlvo]) {
    const topo = Math.round(Math.max(i.alvo ?? 0, proximo));
    topos[i.id] = topo;
    fim = topo + i.altura;
    proximo = fim + VAO_MARGEM;
  }
  return { topos, altura: fim };
}
