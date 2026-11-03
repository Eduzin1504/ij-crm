/**
 * Ponto de troca do template: o fluxo (proposta, contrato) pede `templateAtual()`
 * e nunca importa um template específico. Template oficial da IJ = novo arquivo
 * aqui + trocar o retorno abaixo.
 */
import type { TemplatePdf } from "../tipos";
import { TEMPLATE_PROVISORIO } from "./provisorio";

export function templateAtual(): TemplatePdf {
  return TEMPLATE_PROVISORIO;
}
