"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { MensagemErro } from "@/components/erros/mensagem-erro";
import { executarAcao, type FalhaUI } from "@/lib/erros/cliente";
import { criarPropostaAction } from "./actions";

/** "Criar proposta": no máximo uma por Projeto (o servidor garante; corrida vira erro claro). */
export function CriarProposta({ projetoId }: { projetoId: string }) {
  const router = useRouter();
  const [erro, setErro] = useState<FalhaUI | null>(null);
  const [pendente, startTransition] = useTransition();
  return (
    <div className="flex flex-col items-center gap-2">
      <Button
        type="button"
        disabled={pendente}
        onClick={() =>
          startTransition(async () => {
            const falha = await executarAcao(() => criarPropostaAction(projetoId), "criar a proposta");
            setErro(falha);
            if (!falha) router.refresh();
          })
        }
      >
        Criar proposta
      </Button>
      <MensagemErro falha={erro} />
    </div>
  );
}
