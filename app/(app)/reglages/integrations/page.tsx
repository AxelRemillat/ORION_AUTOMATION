import { Card, CardContent, CardDescription, CardHeader, CardTitle, PageHeader } from "@/components/ui";
import { requireUser } from "@/lib/auth";
import { loadIntegrations } from "@/lib/settings/integrations-server";
import { createClient } from "@/lib/supabase/server";
import { IntegrationRow } from "./integration-row";

export const dynamic = "force-dynamic";
export const metadata = { title: "Intégrations · Réglages · ORION" };

/**
 * Réglages › Intégrations. Aucune clé n'est affichée, pas même partiellement :
 * seulement sa présence. « Tester » ne fait qu'un appel gratuit.
 */
export default async function IntegrationsPage() {
  await requireUser();
  const items = await loadIntegrations(createClient());
  const missing = items.filter((item) => item.state === "clé manquante").length;
  return (
    <>
      <PageHeader
        title="Intégrations"
        description={missing ? `${missing} service(s) à configurer.` : "Tous les services utilisés sont configurés."}
      />
      <Card>
        <CardHeader>
          <CardTitle>Services</CardTitle>
          <CardDescription>
            État de la configuration et dernier appel réussi d&apos;après les journaux. Les webhooks n8n n&apos;ont pas de bouton : les tester enverrait ou recevrait un vrai mail.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ul>
            {items.map((item) => (
              <IntegrationRow key={item.key} item={item} />
            ))}
          </ul>
        </CardContent>
      </Card>
    </>
  );
}
