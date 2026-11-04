import { redirect } from "next/navigation";
import { exigirUsuario } from "@/lib/auth/atual";
import { destinoDeEntrada, podeVerItemEmAlgumaArea } from "@/lib/auth/visibilidade";
import { paginaInicial } from "@/lib/preferencias/preferencias";
import { obterPreferencias } from "@/lib/preferencias/servico";

/**
 * `/` → área de entrada da pessoa (GAB-97) e, dentro dela, o escolhido em Meu
 * perfil: Minha Semana (padrão) ou Kanban. Geral = Painel. Redirect no servidor
 * (sem flash). Destino sai de uma lista fixa; `?vendedor=` de links antigos segue
 * para a semana, para quem a vê (VISUALIZADOR não: cai na entrada dele, sem /403).
 */
export default async function InicioPage({ searchParams }: { searchParams: Promise<{ vendedor?: string | string[] }> }) {
  const eu = await exigirUsuario();
  const { vendedor } = await searchParams;
  if (typeof vendedor === "string" && vendedor && podeVerItemEmAlgumaArea(eu, "semana")) redirect(`/semana?vendedor=${encodeURIComponent(vendedor)}`);
  redirect(destinoDeEntrada(eu, paginaInicial(await obterPreferencias(eu.id))));
}
