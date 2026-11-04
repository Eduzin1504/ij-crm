import { registrarErro } from "@/lib/erros/registrar";
import { paginaInicial, PREFERENCIAS_PADRAO, type PaginaInicial, type Preferencias } from "./preferencias";

/**
 * O que abre dentro da área, para a gaveta do shell. Nunca lança: o layout de
 * todas as páginas depende disso, então banco fora vira log com ref e Minha
 * Semana (o padrão), em vez de derrubar o app inteiro.
 */
export async function resolverPaginaInicial(ler: () => Promise<Preferencias>): Promise<PaginaInicial> {
  try {
    return paginaInicial(await ler());
  } catch (e) {
    registrarErro("layout.inicio", e);
    return paginaInicial(PREFERENCIAS_PADRAO);
  }
}
