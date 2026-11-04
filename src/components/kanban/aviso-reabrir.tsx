"use client";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";

export type PedidoReabrir = { titulo: string; texto: string };

/** Confirmação de reabrir card perdido por proposta inviável: mexer na fase muda a proposta (GAB-98). */
export function AvisoReabrir({ pedido, onCancelar, onConfirmar }: { pedido: PedidoReabrir | null; onCancelar: () => void; onConfirmar: () => void }) {
  return (
    <Dialog open={pedido !== null} onOpenChange={(aberto) => (aberto ? undefined : onCancelar())}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Reabrir “{pedido?.titulo}”?</DialogTitle>
          <DialogDescription>{pedido?.texto}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onCancelar}>
            Cancelar
          </Button>
          <Button type="button" onClick={onConfirmar}>
            Reabrir
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
