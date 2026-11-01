"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { autorizarAction } from "./actions";

/** Botões Autorizar/Negar; o pedido OAuth vai em campos ocultos para a action revalidar. */
export function Consentimento({ campos }: { campos: Record<string, string> }) {
  const [estado, action, pendente] = useActionState(autorizarAction, undefined);
  return (
    <form action={action} className="space-y-3">
      {Object.entries(campos).map(([k, v]) => (
        <input key={k} type="hidden" name={k} value={v} />
      ))}
      {estado?.erro ? (
        <p role="alert" className="text-sm text-danger">
          {estado.erro}
        </p>
      ) : null}
      <div className="flex gap-2">
        <Button type="submit" name="decisao" value="autorizar" className="flex-1" disabled={pendente}>
          {pendente ? "Conectando…" : "Autorizar"}
        </Button>
        <Button type="submit" name="decisao" value="negar" variant="outline" disabled={pendente}>
          Negar
        </Button>
      </div>
    </form>
  );
}
