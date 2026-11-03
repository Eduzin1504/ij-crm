"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { Bell, Check } from "lucide-react";
import type { TipoAviso } from "@prisma/client";
import { Button } from "@/components/ui/button";
import { formatarDataHora } from "@/lib/projetos/formatar";
import { marcarAvisosLidosAction } from "./sino-actions";

/** Intervalo do polling do contador. Pausa com a aba oculta e consulta na volta. */
export const INTERVALO_SINO_MS = 30_000;

type AvisoJson = { id: string; tipo: TipoAviso; titulo: string; href: string | null; lido: boolean; criadoEm: string; whatsappFalhouRef: string | null };

/** Resposta de erro do servidor → texto com a ref (a mesma do log). */
function mensagemErro(ref?: string): string {
  return ref ? `Erro no servidor (ref: ${ref}). Tente de novo; se persistir, informe a ref.` : "Não deu para falar com o servidor. Tente de novo.";
}

/**
 * Sino de avisos (GAB-88). Polling leve (`GET /api/avisos`: só a contagem) a
 * cada 30 s com a aba visível; aberto, carrega a lista (`?lista=1`).
 */
export function Sino() {
  const [naoLidos, setNaoLidos] = useState(0);
  const [aberto, setAberto] = useState(false);
  const [avisos, setAvisos] = useState<AvisoJson[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const caixa = useRef<HTMLDivElement>(null);

  const contar = useCallback(async () => {
    try {
      const r = await fetch("/api/avisos", { cache: "no-store" });
      if (r.ok) setNaoLidos(((await r.json()) as { naoLidos: number }).naoLidos);
    } catch {
      // Rede oscilou: mantém o último número; a próxima rodada tenta de novo.
    }
  }, []);

  useEffect(() => {
    let timer: ReturnType<typeof setInterval> | undefined;
    const parar = () => {
      if (timer) clearInterval(timer);
      timer = undefined;
    };
    const iniciar = () => {
      parar();
      void contar();
      timer = setInterval(() => void contar(), INTERVALO_SINO_MS);
    };
    const aoMudarVisibilidade = () => (document.hidden ? parar() : iniciar());
    if (!document.hidden) iniciar();
    document.addEventListener("visibilitychange", aoMudarVisibilidade);
    return () => {
      parar();
      document.removeEventListener("visibilitychange", aoMudarVisibilidade);
    };
  }, [contar]);

  const carregarLista = useCallback(async () => {
    setErro(null);
    try {
      const r = await fetch("/api/avisos?lista=1", { cache: "no-store" });
      const corpo = (await r.json().catch(() => ({}))) as { naoLidos?: number; avisos?: AvisoJson[]; ref?: string };
      if (!r.ok || !corpo.avisos) return setErro(mensagemErro(corpo.ref));
      setAvisos(corpo.avisos);
      setNaoLidos(corpo.naoLidos ?? 0);
    } catch {
      setErro(mensagemErro());
    }
  }, []);

  // Fecha com clique fora ou Esc.
  useEffect(() => {
    if (!aberto) return;
    const fora = (e: MouseEvent) => {
      if (caixa.current && !caixa.current.contains(e.target as Node)) setAberto(false);
    };
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setAberto(false);
    document.addEventListener("mousedown", fora);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", fora);
      document.removeEventListener("keydown", esc);
    };
  }, [aberto]);

  async function marcar(ids?: string[]) {
    setErro(null);
    try {
      const r = await marcarAvisosLidosAction(ids);
      if (!r.ok) return setErro(mensagemErro(r.ref));
      setNaoLidos(r.naoLidos);
      setAvisos((lista) => lista?.map((a) => (!ids || ids.includes(a.id) ? { ...a, lido: true } : a)) ?? null);
    } catch {
      setErro(mensagemErro());
    }
  }

  function alternar() {
    const abrir = !aberto;
    setAberto(abrir);
    if (abrir) void carregarLista();
  }

  const rotulo = naoLidos > 0 ? `Avisos: ${naoLidos} não lido${naoLidos > 1 ? "s" : ""}` : "Avisos";
  return (
    <div className="relative" ref={caixa}>
      <Button type="button" variant="ghost" size="icon" aria-label={rotulo} title={rotulo} aria-expanded={aberto} onClick={alternar} className="relative">
        <Bell className="h-4 w-4" />
        {naoLidos > 0 && (
          <span aria-hidden className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 font-mono text-[10px] leading-none text-primary-foreground">
            {naoLidos > 99 ? "99+" : naoLidos}
          </span>
        )}
      </Button>
      {aberto && (
        <div role="dialog" aria-label="Avisos" className="absolute right-0 top-full z-20 mt-2 w-[min(22rem,calc(100vw-2rem))] rounded-xl border border-border bg-surface shadow-lg">
          <div className="flex items-center justify-between border-b border-border px-4 py-2">
            <p className="text-sm font-medium">Avisos</p>
            <Button type="button" variant="ghost" size="sm" disabled={naoLidos === 0} onClick={() => void marcar()}>
              Marcar todos como lidos
            </Button>
          </div>
          {erro && (
            <p role="alert" className="px-4 py-2 text-sm text-danger">
              {erro}
            </p>
          )}
          {avisos === null && !erro ? (
            <p className="px-4 py-6 text-center text-sm text-fg-mute">Carregando…</p>
          ) : avisos && avisos.length === 0 ? (
            <p className="px-4 py-6 text-center text-sm text-fg-mute">Nenhum aviso por aqui.</p>
          ) : (
            <ul className="max-h-[60vh] divide-y divide-border overflow-y-auto">
              {avisos?.map((a) => (
                <li key={a.id} className={`flex items-start gap-2 px-4 py-3 ${a.lido ? "" : "bg-surface-hover/50"}`}>
                  {!a.lido && <span aria-label="não lido" className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-primary" />}
                  <div className="min-w-0 flex-1">
                    {a.href ? (
                      <Link
                        href={a.href}
                        className="text-sm text-fg-soft hover:underline"
                        onClick={() => {
                          setAberto(false);
                          if (!a.lido) void marcar([a.id]);
                        }}
                      >
                        {a.titulo}
                      </Link>
                    ) : (
                      <p className="text-sm text-fg-soft">{a.titulo}</p>
                    )}
                    <p className="mt-0.5 font-mono text-xs text-fg-faint">{formatarDataHora(new Date(a.criadoEm))}</p>
                    {a.whatsappFalhouRef && (
                      <p className="mt-0.5 text-xs text-fg-mute">
                        Não foi para o seu WhatsApp (ref: <span className="font-mono">{a.whatsappFalhouRef}</span>).
                      </p>
                    )}
                  </div>
                  {!a.lido && (
                    <Button type="button" variant="ghost" size="icon" aria-label="Marcar como lido" title="Marcar como lido" onClick={() => void marcar([a.id])}>
                      <Check className="h-4 w-4" />
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
