/**
 * Canal de origem de uma ação (GAB-83): hoje só "via MCP". As ferramentas do
 * conector rodam dentro de `comViaMcp`, e o `db` (`./db.ts`) marca
 * `timeline.via_mcp` em TODA entrada criada nesse contexto — inclusive as dos
 * ganchos internos (terminal, handoff). Assim o MCP chama a mesma camada de
 * serviço da tela, sem um parâmetro a mais em cada função.
 *
 * Sem imports do Next nem alias `@/`: o `db` depende daqui e roda em scripts.
 */
import { AsyncLocalStorage } from "node:async_hooks";

const contexto = new AsyncLocalStorage<{ viaMcp: true }>();

export function comViaMcp<T>(corpo: () => Promise<T>): Promise<T> {
  return contexto.run({ viaMcp: true }, corpo);
}

export function emViaMcp(): boolean {
  return contexto.getStore()?.viaMcp === true;
}
