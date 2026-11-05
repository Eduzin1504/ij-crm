import { redirect } from "next/navigation";
import { PageHeader } from "@/components/shell/page-header";
import { exigirUsuario } from "@/lib/auth/atual";
import { ehEditorGG } from "@/lib/gg/organizacao";
import { carregarBase } from "@/lib/gg/organizacao";
import { Importar } from "./importar";

export const metadata = { title: "Importar membros · G&G" };

export default async function ImportarPage() {
  const ator = await exigirUsuario();
  if (!(await ehEditorGG(ator))) redirect("/403");
  const base = await carregarBase();
  return (
    <div className="space-y-5">
      <PageHeader eyebrow="gente & gestão · importação" title="Importar membros" description="Até 500 por vez. Área e cargo precisam existir no catálogo. Tudo ou nada: uma linha inválida recusa o lote inteiro." />
      <Importar areas={base.areas.map((a) => a.nome)} cargos={base.cargos.map((c) => c.nome)} hoje={base.hoje} />
    </div>
  );
}
