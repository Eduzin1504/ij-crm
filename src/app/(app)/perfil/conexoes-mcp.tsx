"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Bot } from "lucide-react";
import { MensagemErro } from "@/components/erros/mensagem-erro";
import { Button } from "@/components/ui/button";
import { executarAcao, type FalhaUI } from "@/lib/erros/cliente";
import { revogarConexaoMcpAction } from "./actions";

export type ConexaoMcpUI = { id: string; cliente: string; criadoEm: string; ultimoUsoEm: string };

const fmt = new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short", timeZone: "America/Sao_Paulo" });

/** Conexões do conector MCP (GAB-83): o Claude de cada lugar onde a pessoa conectou. Revogar corta na hora. */
export function ConexoesMcp({ conexoes, urlMcp }: { conexoes: ConexaoMcpUI[]; urlMcp: string }) {
  const router = useRouter();
  const [falha, setFalha] = useState<FalhaUI | null>(null);
  const [pendente, startTransition] = useTransition();

  function revogar(id: string) {
    setFalha(null);
    startTransition(async () => {
      const f = await executarAcao(() => revogarConexaoMcpAction(id), "revogar a conexão");
      if (f) setFalha(f);
      else router.refresh();
    });
  }

  return (
    <section className="space-y-4 rounded-xl border border-border bg-surface p-5">
      <div className="space-y-1">
        <h2 className="text-sm font-medium">Conexões do Claude (MCP)</h2>
        <p className="text-xs text-fg-mute">
          Para conectar, adicione no Claude um conector com a URL <span className="font-mono break-all text-fg-soft">{urlMcp}</span>.
        </p>
      </div>
      {conexoes.length === 0 ? (
        <p className="text-sm text-fg-faint">Nenhuma conexão ativa.</p>
      ) : (
        <ul className="space-y-2">
          {conexoes.map((c) => (
            <li key={c.id} className="flex flex-wrap items-center gap-3 rounded-lg border border-border px-3 py-2.5">
              <Bot className="h-4 w-4 text-fg-mute" aria-hidden />
              <div className="min-w-0 flex-1">
                <p className="text-sm">{c.cliente}</p>
                <p className="font-mono text-[11px] text-fg-mute">
                  conectou {fmt.format(new Date(c.criadoEm))} · último uso {fmt.format(new Date(c.ultimoUsoEm))}
                </p>
              </div>
              <Button variant="ghost" size="sm" disabled={pendente} onClick={() => revogar(c.id)}>
                Revogar
              </Button>
            </li>
          ))}
        </ul>
      )}
      <MensagemErro falha={falha} className="text-sm" />
    </section>
  );
}
