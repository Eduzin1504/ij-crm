/**
 * Seções do painel de projetos (GAB-96). Como o painel de vendas: barras em HTML/CSS, sem biblioteca.
 * Cor funcional só em ponto e borda (spec v1 §4.5.1): as barras usam a primária, e o que é alerta ganha um ponto.
 */
import Link from "next/link";
import type { ReactNode } from "react";
import { cn } from "cn";
import { StatusCheckinBadge } from "@/components/projetos/status-checkin";
import { DEFINICOES_PROJETOS } from "@/lib/painel/definicoes";
import type { ExecucaoProjetos, SituacaoProjeto, TempoCaneta } from "@/lib/painel/projetos-calculo";
import type { VisaoDaCaneta } from "@/lib/auth/visibilidade";
import { formatarDataHora } from "@/lib/projetos/formatar";
import { ROTULO_STATUS_PROPOSTA } from "@/lib/propostas/regras";
import { fmtDias, fmtInteiro, TRACO } from "@/lib/ranking/formatar";
import { Barra, Kpi, nome, Secao, Tabela, TD, TDN } from "./secoes";

const SEM_PREVISTO = "sem previsto";
const fmtAtraso = (d: number) => (d === 0 ? TRACO : fmtDias(d));
const linkDoProjeto = (id: string) => `/projetos/${encodeURIComponent(id)}`;
const Ponto = ({ cor }: { cor: "danger" | "warn" }) => <span aria-hidden className={cn("mr-1.5 inline-block size-2 shrink-0 rounded-full", cor === "danger" ? "bg-danger" : "bg-warn")} />;

function LinhaProjeto({ s }: { s: SituacaoProjeto }) {
  const semDado = (v: number) => (s.semPrevisto ? TRACO : fmtInteiro(v));
  return (
    <tr className="border-b border-border last:border-0">
      <td className={TD}>
        <Link href={linkDoProjeto(s.id)} className="hover:underline">
          {s.titulo}
        </Link>
        <p className="text-xs text-fg-mute">
          {s.fase} · GP {nome(s.gp)}
        </p>
      </td>
      <td className={TD}>
        {s.semPrevisto ? (
          <span className="text-xs text-fg-mute">{SEM_PREVISTO}</span>
        ) : (
          <div className="flex items-center gap-2">
            <Barra fracao={s.feitas / s.totalEntregas} rotulo={`${s.feitas} de ${s.totalEntregas} entregas feitas`} />
            <span className="w-10 text-right font-mono text-xs tabular">
              {fmtInteiro(s.feitas)}/{fmtInteiro(s.totalEntregas)}
            </span>
          </div>
        )}
      </td>
      <td className={TDN}>{semDado(s.previstasNoPeriodo)}</td>
      <td className={TDN}>{semDado(s.feitasNoPeriodo)}</td>
      <td className={TDN}>
        {s.atrasadas > 0 ? <Ponto cor="danger" /> : null}
        {semDado(s.atrasadas)}
      </td>
      <td className={TDN}>{s.semPrevisto ? TRACO : fmtAtraso(s.atrasoDias)}</td>
      <td className={TDN}>{semDado(s.ajustes)}</td>
      <td className={TD}>{s.ultimoCheckin ? <StatusCheckinBadge status={s.ultimoCheckin.status} motivo={s.ultimoCheckin.motivo} semana={s.ultimoCheckin.semana} /> : <span className="text-xs text-fg-mute">nenhum</span>}</td>
    </tr>
  );
}

export function SecaoExecucao({ e }: { e: ExecucaoProjetos }) {
  const t = e.totais;
  return (
    <Secao titulo="execução" pergunta="O projeto está andando de acordo com a proposta?" id="execucao" definicoes={DEFINICOES_PROJETOS.execucao}>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3 xl:grid-cols-5">
        <Kpi rotulo="Em execução" valor={fmtInteiro(t.emExecucao)} dica={t.semPrevisto > 0 ? `${fmtInteiro(t.semPrevisto)} ${SEM_PREVISTO}` : undefined} />
        <Kpi rotulo="Previstas × feitas" valor={`${fmtInteiro(t.previstasNoPeriodo)} × ${fmtInteiro(t.feitasNoPeriodo)}`} dica={t.previstasEncerrados + t.feitasEncerrados > 0 ? `no período, com ${fmtInteiro(t.previstasEncerrados)} × ${fmtInteiro(t.feitasEncerrados)} de encerrados` : "entregas no período"} />
        <Kpi rotulo="Com atraso" valor={fmtInteiro(t.comAtraso)} ponto={t.comAtraso > 0 ? "danger" : undefined} dica={`${fmtInteiro(t.atrasadas)} ${t.atrasadas === 1 ? "entrega vencida" : "entregas vencidas"}`} />
        <Kpi rotulo="Atraso acumulado" valor={fmtAtraso(t.atrasoDias)} dica="frente ao previsto original" />
        <Kpi rotulo="Vermelho / amarelo" valor={`${fmtInteiro(t.vermelhos)} / ${fmtInteiro(t.amarelos)}`} ponto={t.vermelhos > 0 ? "danger" : t.amarelos > 0 ? "warn" : undefined} dica={`${fmtInteiro(t.semCheckin)} sem check-in na semana`} />
      </div>
      <Tabela
        minimo="52rem"
        cabecalho={[
          { rotulo: "Projeto" },
          { rotulo: "Entregas", titulo: "feitas / total do cronograma ativo" },
          { rotulo: "Previstas", numerica: true, titulo: "previsto original no período" },
          { rotulo: "Feitas", numerica: true, titulo: "data real no período" },
          { rotulo: "Atrasadas", numerica: true, titulo: "pendentes com o previsto atual antes de hoje" },
          { rotulo: "Atraso", numerica: true, titulo: "soma dos dias além do previsto original" },
          { rotulo: "Ajustes", numerica: true, titulo: "mudanças de data das entregas ativas" },
          { rotulo: "Check-in", titulo: "último check-in" },
        ]}
      >
        {e.projetos.length === 0 ? (
          <tr>
            <td colSpan={8} className={cn(TD, "text-fg-mute")}>
              Nenhum projeto em execução.
            </td>
          </tr>
        ) : (
          e.projetos.map((s) => <LinhaProjeto key={s.id} s={s} />)
        )}
      </Tabela>
    </Secao>
  );
}

function ListaAlerta({ titulo, vazio, itens, detalhe }: { titulo: string; vazio: string; itens: SituacaoProjeto[]; detalhe: (s: SituacaoProjeto) => ReactNode }) {
  return (
    <div className="rounded-xl border border-border bg-surface p-4">
      <p className="eyebrow">{titulo}</p>
      {itens.length === 0 ? (
        <p className="mt-2 text-sm text-fg-mute">{vazio}</p>
      ) : (
        <ol className="mt-3 space-y-2">
          {itens.map((s) => (
            <li key={s.id} className="flex items-baseline justify-between gap-3 text-sm">
              <span className="min-w-0 truncate">
                <Link href={linkDoProjeto(s.id)} className="hover:underline">
                  {s.titulo}
                </Link>
                <span className="text-fg-mute"> · {nome(s.gp)}</span>
              </span>
              <span className="shrink-0">{detalhe(s)}</span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

export function SecaoAlertas({ a }: { a: ExecucaoProjetos["alertas"] }) {
  return (
    <Secao titulo="alertas · agora" pergunta="Quais projetos pedem atenção?" id="alertas" definicoes={DEFINICOES_PROJETOS.alertas}>
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <ListaAlerta
          titulo="no vermelho ou no amarelo"
          vazio="Nenhum projeto no vermelho ou no amarelo."
          itens={[...a.vermelhos, ...a.amarelos]}
          detalhe={(s) => (s.ultimoCheckin ? <StatusCheckinBadge status={s.ultimoCheckin.status} motivo={s.ultimoCheckin.motivo} semana={s.ultimoCheckin.semana} /> : null)}
        />
        <ListaAlerta
          titulo="sem check-in na semana"
          vazio="Todo projeto cobrado já tem check-in nesta semana."
          itens={a.semCheckin}
          detalhe={(s) => <span className="font-mono text-xs tabular text-fg-soft">{s.semanasCobradas > 0 ? `${fmtInteiro(s.semanasCobradas)} ${s.semanasCobradas === 1 ? "semana cobrada" : "semanas cobradas"}` : TRACO}</span>}
        />
      </div>
    </Secao>
  );
}

const RECORTE_CANETA: Partial<Record<VisaoDaCaneta, string>> = {
  escaladas: "Só as propostas em que você está escalado.",
  so_minhas: "Só as suas linhas, nas propostas em que você está escalado: o ranking está oculto.",
};

export function SecaoCaneta({ c, visao }: { c: TempoCaneta; visao: VisaoDaCaneta }) {
  const maior = Math.max(0, ...c.porPessoa.map((l) => l.maiorDias ?? 0));
  const recorte = RECORTE_CANETA[visao];
  return (
    <Secao titulo="caneta" pergunta="Com quem a proposta está parada?" id="caneta" definicoes={DEFINICOES_PROJETOS.caneta}>
      {recorte ? <p className="text-sm text-fg-mute">{recorte}</p> : null}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Kpi rotulo="Paradas agora" valor={fmtInteiro(c.paradas)} />
        <Kpi rotulo="Tempo médio parada" valor={c.mediaDias === null ? TRACO : fmtDias(c.mediaDias)} />
        <Kpi rotulo="No período" valor={fmtAtraso(c.noPeriodoDias)} dica="tempo com a caneta, somado" />
        <Kpi rotulo="Sem ninguém" valor={fmtInteiro(c.semDono)} ponto={c.semDono > 0 ? "warn" : undefined} dica="o GP do lado pega · não acompanha o filtro" />
      </div>
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Tabela
          minimo="28rem"
          cabecalho={[
            { rotulo: "Pessoa" },
            { rotulo: "Mais antiga", titulo: "há quanto tempo está com a proposta parada há mais tempo" },
            { rotulo: "Paradas", numerica: true },
            { rotulo: "Média", numerica: true },
            { rotulo: "No período", numerica: true },
          ]}
        >
          {c.porPessoa.length === 0 ? (
            <tr>
              <td colSpan={5} className={cn(TD, "text-fg-mute")}>
                Ninguém com a caneta no período.
              </td>
            </tr>
          ) : (
            c.porPessoa.map((l) => (
              <tr key={l.usuario.id} className="border-b border-border last:border-0">
                <td className={TD}>{nome(l.usuario)}</td>
                <td className={TD}>
                  <div className="flex items-center gap-2">
                    <Barra fracao={maior > 0 ? (l.maiorDias ?? 0) / maior : null} rotulo={`Mais antiga: ${l.maiorDias === null ? "nenhuma" : fmtDias(l.maiorDias)}`} />
                    <span className="w-16 text-right font-mono text-xs tabular">{l.maiorDias === null ? TRACO : fmtDias(l.maiorDias)}</span>
                  </div>
                </td>
                <td className={TDN}>{fmtInteiro(l.paradas)}</td>
                <td className={TDN}>{l.mediaDias === null ? TRACO : fmtDias(l.mediaDias)}</td>
                <td className={TDN}>{fmtAtraso(l.noPeriodoDias)}</td>
              </tr>
            ))
          )}
        </Tabela>
        <div className="rounded-xl border border-border bg-surface p-4">
          <p className="eyebrow">há mais tempo paradas</p>
          {c.maisParadas.length === 0 ? (
            <p className="mt-2 text-sm text-fg-mute">Nenhuma proposta parada agora.</p>
          ) : (
            <ol className="mt-3 space-y-2">
              {c.maisParadas.map((m) => (
                <li key={m.projetoId} className="text-sm">
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="min-w-0 truncate">
                      <Link href={`${linkDoProjeto(m.projetoId)}/proposta`} className="hover:underline">
                        {m.titulo}
                      </Link>
                      <span className="text-fg-mute">
                        {" · "}
                        {nome(m.usuario)}
                        {" · "}
                        {ROTULO_STATUS_PROPOSTA[m.status]}
                      </span>
                    </span>
                    <span className="shrink-0 font-mono text-xs tabular text-fg-soft">{fmtDias(m.dias)}</span>
                  </div>
                  {/* Em linha própria: ao lado, ela deixava pouco mais de 90 px para o título no celular. */}
                  <p className="text-xs text-fg-faint">última edição há {m.ultimaEdicaoDias < 1 ? "menos de 1 dia" : fmtDias(m.ultimaEdicaoDias)}</p>
                </li>
              ))}
            </ol>
          )}
        </div>
      </div>
    </Secao>
  );
}

export function SecaoEncerrados({ e }: { e: ExecucaoProjetos["encerrados"] }) {
  if (e.length === 0) return null;
  return (
    <section aria-labelledby="painel-encerrados" className="space-y-3">
      <h2 id="painel-encerrados" className="eyebrow">
        encerrados · fora de atraso e alertas; previstas e feitas entram no total do período
      </h2>
      <Tabela
        minimo="44rem"
        cabecalho={[
          { rotulo: "Projeto" },
          { rotulo: "Fase" },
          { rotulo: "GP" },
          { rotulo: "Entregas", numerica: true },
          { rotulo: "Previstas", numerica: true, titulo: "previsto original no período" },
          { rotulo: "Feitas", numerica: true, titulo: "data real no período" },
          { rotulo: "Encerrado em", numerica: true },
        ]}
      >
        {e.map((p) => (
          <tr key={p.id} className="border-b border-border last:border-0">
            <td className={TD}>
              <Link href={linkDoProjeto(p.id)} className="hover:underline">
                {p.titulo}
              </Link>
            </td>
            <td className={TD}>{p.fase}</td>
            <td className={TD}>{nome(p.gp)}</td>
            <td className={TDN}>{p.semPrevisto ? SEM_PREVISTO : `${fmtInteiro(p.feitas)}/${fmtInteiro(p.totalEntregas)}`}</td>
            <td className={TDN}>{fmtInteiro(p.previstasNoPeriodo)}</td>
            <td className={TDN}>{fmtInteiro(p.feitasNoPeriodo)}</td>
            <td className={TDN}>{formatarDataHora(p.encerradoEm)}</td>
          </tr>
        ))}
      </Tabela>
    </section>
  );
}
