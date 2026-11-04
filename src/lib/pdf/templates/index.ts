/**
 * Ponto de troca do template: o fluxo (proposta, contrato) pede `templateAtual()`
 * e nunca importa um template específico.
 */
import type { TemplatePdf } from "../tipos";
import { TEMPLATE_IJ } from "./ij";

export function templateAtual(): TemplatePdf {
  return TEMPLATE_IJ;
}
