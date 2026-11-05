import { Arimo, Poppins } from "next/font/google";

/** GAB-100: as fontes da folha, as mesmas do PDF (`src/lib/pdf/fontes`). Só carregam nas telas da proposta. */
export const arimo = Arimo({ subsets: ["latin"], weight: ["400", "700"], style: ["normal", "italic"], variable: "--font-arimo", display: "swap" });
export const poppins = Poppins({ subsets: ["latin"], weight: ["400", "700"], variable: "--font-poppins", display: "swap" });
