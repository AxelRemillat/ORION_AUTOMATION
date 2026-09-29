import { redirect } from "next/navigation";
import { PageHeader } from "@/components/ui";
import { createClient } from "@/lib/supabase/server";
import { loadOffer } from "@/lib/offer/read";
import { OffreClient } from "./offre-client";
import { SiteOffersCard } from "./site-offers-card";

/**
 * « Mon offre » — ce qu'Axel vend, et comment il signe.
 *
 * Ces données vivaient en dur dans `lib/persona.ts`. Conséquence en production :
 * les mails ne disaient ni qui écrivait, ni ce qui était proposé, et corriger
 * une phrase de bio demandait un déploiement.
 */
export const dynamic = "force-dynamic";

export default async function OffrePage() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=/offre");

  const loaded = await loadOffer(supabase, user.id);

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Mon offre"
        description="Ce que les mails disent de vous : votre signature, ce que vous proposez en premier contact, les preuves que vous pouvez citer, et les offres du site."
      />
      <OffreClient initial={loaded.offer} empty={loaded.empty} />
      <SiteOffersCard />
    </div>
  );
}
