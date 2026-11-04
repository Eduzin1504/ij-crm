import type { Area } from "@prisma/client";
import {
  Building2,
  CalendarCheck,
  CalendarDays,
  ChartColumn,
  Contact,
  FileText,
  FolderKanban,
  KanbanSquare,
  Settings2,
  Table2,
  Trophy,
  UserRound,
  type LucideIcon,
} from "lucide-react";
import { ehDaArea, itensDaArea, itensGerais, kanbanDaArea, type ItemDeArea, type ItemGeral, type PessoaComEntrada } from "@/lib/auth/visibilidade";
import { ladoDe, type PessoaComLado } from "@/lib/auth/areas";

export type NavItem = {
  href: string;
  label: string;
  icon: LucideIcon;
  /** Item de um quadro do Kanban: ativo pelo quadro da página. */
  quadro?: string;
};

/** Quadro que `/kanban` mostra sem `?quadro=` (ver `kanban/page.tsx`). */
export const QUADRO_PADRAO = "vendas";

const AREA_DO_QUADRO: Record<string, Area> = { vendas: "VENDAS", projetos: "PROJETOS" };

const KANBAN: Record<Area, NavItem> = {
  VENDAS: { href: kanbanDaArea("VENDAS"), label: "Kanban de vendas", icon: KanbanSquare, quadro: "vendas" },
  PROJETOS: { href: kanbanDaArea("PROJETOS"), label: "Kanban de projetos", icon: FolderKanban, quadro: "projetos" },
};

const ITENS: Record<Exclude<ItemDeArea, "kanban">, NavItem> = {
  semana: { href: "/semana", label: "Minha Semana", icon: CalendarCheck },
  // GAB-86: todas as propostas (uma por projeto); a edição fica dentro do projeto.
  propostas: { href: "/propostas", label: "Propostas", icon: FileText },
  tabela: { href: "/tabela", label: "Tabela", icon: Table2 },
  ranking: { href: "/ranking", label: "Ranking", icon: Trophy },
  contatos: { href: "/contatos", label: "Contatos", icon: Contact },
  empresas: { href: "/empresas", label: "Empresas", icon: Building2 },
  calendario: { href: "/calendario", label: "Calendário", icon: CalendarDays },
};

const ITENS_GERAIS: Record<ItemGeral, NavItem> = {
  painel: { href: "/painel", label: "Painel", icon: ChartColumn },
  gestao: { href: "/gestao", label: "Gestão", icon: Settings2 },
  perfil: { href: "/perfil", label: "Meu perfil", icon: UserRound },
};

/** Menu lateral (e barra inferior) desta pessoa nesta área. */
export function itensDoMenu(p: PessoaComLado, area: Area): NavItem[] {
  return itensDaArea(p, area).map((item) => (item === "kanban" ? KANBAN[area] : ITENS[item]));
}

/** Bloco Geral da gaveta. */
export function itensDaGaveta(p: Pick<PessoaComLado, "papel">): NavItem[] {
  return itensGerais(p).map((item) => ITENS_GERAIS[item]);
}

/**
 * Área que a rota define, ou null se não define (§4.7). `/kanban` pelo quadro;
 * `/projetos/[id]` pelo quadro do card; Tabela e Ranking só existem em Vendas;
 * Minha Semana é da área da própria pessoa, exceto de quem é das duas.
 */
export function areaDaRota(pathname: string, quadro: string | null, p: PessoaComEntrada): Area | null {
  if (isActive(pathname, "/kanban")) return AREA_DO_QUADRO[quadro ?? QUADRO_PADRAO] ?? null;
  if (pathname.startsWith("/projetos/")) return quadro ? (AREA_DO_QUADRO[quadro] ?? null) : null;
  if (isActive(pathname, "/tabela") || isActive(pathname, "/ranking")) return "VENDAS";
  if (isActive(pathname, "/semana")) {
    const lado = ladoDe(p);
    return lado !== null && !(ehDaArea(p, "VENDAS") && ehDaArea(p, "PROJETOS")) ? lado : null;
  }
  return null;
}

/** Item ativo: "/" só em match exato; demais por prefixo. */
export function isActive(pathname: string, href: string): boolean {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}

/**
 * Item ativo considerando o quadro do Kanban. `quadro` = o declarado pela página
 * (detalhe do card, ver `quadro-ativo.tsx`) ou o `?quadro=` da lista. Na lista
 * sem `?quadro=` vale o padrão; no detalhe (`/projetos/[id]`) sem quadro
 * declarado nenhum acende.
 */
export function itemAtivo(item: NavItem, pathname: string, quadro: string | null): boolean {
  if (!item.quadro) return isActive(pathname, item.href);
  if (!isActive(pathname, "/kanban") && !pathname.startsWith("/projetos/")) return false;
  return (quadro ?? (pathname === "/kanban" ? QUADRO_PADRAO : null)) === item.quadro;
}
