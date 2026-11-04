import type { Area, AreaEntrada } from "@prisma/client";
import type { PaginaInicial } from "@/lib/preferencias/preferencias";
import { AREAS, ladoDe, usaAreaDeEntrada, type PessoaComLado } from "./areas";
import { temPapelMinimo } from "./papeis";

/**
 * Quem vê o quê em cada área (spec áreas §4.2, §4.4 e §4.7). Puro: o menu usa hoje
 * e as páginas, actions e MCP usam no GAB-98, com as mesmas funções. Fala em itens,
 * não em rotas: `href` e ícone ficam em `components/shell/nav-config`.
 *
 * Só responde "pode ver o item". O conteúdo do item (quais propostas, de quem é a
 * agenda, se é só leitura) é decidido por quem carrega os dados.
 */

export type ItemDeArea = "semana" | "kanban" | "propostas" | "tabela" | "ranking" | "contatos" | "empresas" | "calendario";
export type ItemGeral = "painel" | "gestao" | "perfil";

const ITENS_PROPRIOS: Record<Area, readonly ItemDeArea[]> = {
  VENDAS: ["semana", "kanban", "propostas", "tabela", "ranking"],
  PROJETOS: ["semana", "kanban", "propostas"],
};
const ITENS_COMPARTILHADOS: readonly ItemDeArea[] = ["contatos", "empresas", "calendario"];

/** Quem é de fora da área. Propostas e Calendário aparecem, mas filtrados pela pessoa (§4.5 e §4.6). */
const ABERTOS_A_VISITANTES: ReadonlySet<ItemDeArea> = new Set(["kanban", "propostas", "contatos", "empresas", "calendario"]);
/** VISUALIZADOR é visitante em todas as áreas, e sem Propostas e Calendário (§4.7). */
const ABERTOS_AO_VISUALIZADOR: ReadonlySet<ItemDeArea> = new Set(["kanban", "contatos", "empresas"]);

/** É da área: o próprio lado, ou ADMIN e GESTOR sem área, que contam nas duas (§4.7). */
export function ehDaArea(p: PessoaComLado, area: Area): boolean {
  if (p.papel === "ADMIN") return true;
  const lado = ladoDe(p);
  return p.papel === "GESTOR" && lado === null ? true : lado === area;
}

/** A pessoa pode ver este item nesta área? Item que a área não tem = não. */
export function podeVerItem(p: PessoaComLado, area: Area, item: ItemDeArea): boolean {
  if (!ITENS_PROPRIOS[area].includes(item) && !ITENS_COMPARTILHADOS.includes(item)) return false;
  if (p.papel === "VISUALIZADOR") return ABERTOS_AO_VISUALIZADOR.has(item);
  return ehDaArea(p, area) || ABERTOS_A_VISITANTES.has(item);
}

/** Itens da área que a pessoa vê, na ordem do menu. */
export function itensDaArea(p: PessoaComLado, area: Area): ItemDeArea[] {
  return [...ITENS_PROPRIOS[area], ...ITENS_COMPARTILHADOS].filter((item) => podeVerItem(p, area, item));
}

/** Para rotas que não dependem da área aberta (ex.: `/tabela`, `/semana`): vê em ao menos uma? */
export function podeVerItemEmAlgumaArea(p: PessoaComLado, item: ItemDeArea): boolean {
  return AREAS.some((area) => podeVerItem(p, area, item));
}

/** Bloco Geral da gaveta. */
export function itensGerais(p: Pick<PessoaComLado, "papel">): ItemGeral[] {
  return temPapelMinimo(p.papel, "GESTOR") ? ["painel", "gestao", "perfil"] : ["painel", "perfil"];
}

export type PessoaComEntrada = PessoaComLado & { areaEntrada: AreaEntrada | null };

/** Onde a pessoa entra (§4.3): a própria área ou, para quem a escolha cabe à gestão, a coluna (sem valor = Geral). */
export function areaDeEntrada(p: PessoaComEntrada): AreaEntrada {
  const lado = ladoDe(p);
  if (lado !== null && !usaAreaDeEntrada(p.papel, lado)) return lado;
  return p.areaEntrada ?? "GERAL";
}

/** Área do menu quando ainda não há nenhuma aberta: a de entrada; em Geral, o lado ou Vendas. */
export function areaPadrao(p: PessoaComEntrada): Area {
  const entrada = areaDeEntrada(p);
  return entrada === "GERAL" ? (ladoDe(p) ?? "VENDAS") : entrada;
}

export type DestinoDeArea = "/semana" | "/kanban" | "/kanban?quadro=projetos";

export function kanbanDaArea(area: Area): "/kanban" | "/kanban?quadro=projetos" {
  return area === "PROJETOS" ? "/kanban?quadro=projetos" : "/kanban";
}

/** Página inicial de uma área: a preferência da pessoa, se ela vê essa página lá; senão, o Kanban da área. */
export function destinoDaArea(p: PessoaComLado, area: Area, inicio: PaginaInicial): DestinoDeArea {
  return inicio === "semana" && podeVerItem(p, area, "semana") ? "/semana" : kanbanDaArea(area);
}

/** Parâmetro com que `/` diz a área à Minha Semana, rota que não a define para quem é das duas áreas. */
export const PARAMETRO_AREA = "area";

/**
 * Destino de `/` e do pós-login (sempre de uma lista fixa). A entrada vence a última
 * área aberta (§4.7): quem é das duas áreas vai à Minha Semana com a área indicada,
 * e o menu e o cookie a seguem. Quem é de uma área só já tem a Semana definida por ela.
 */
export function destinoDeEntrada(p: PessoaComEntrada, inicio: PaginaInicial): DestinoDeArea | "/painel" | `/semana?${typeof PARAMETRO_AREA}=${Area}` {
  const entrada = areaDeEntrada(p);
  if (entrada === "GERAL") return "/painel";
  const destino = destinoDaArea(p, entrada, inicio);
  return destino === "/semana" && usaAreaDeEntrada(p.papel, ladoDe(p)) ? `/semana?${PARAMETRO_AREA}=${entrada}` : destino;
}

/** Última área aberta (§4.7). Gravado pelo cliente; só escolhe o menu, nunca dá acesso. */
export const COOKIE_AREA = "ij_area";

/** Valida a área vinda de fora (cookie ou `?area=`). Também só escolhe o menu. */
export function lerArea(valor: string | null | undefined): Area | null {
  return AREAS.find((a) => a === valor) ?? null;
}
