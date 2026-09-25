/**
 * Petit client HTTP pour les écrans Recherche et Prospection.
 * Vit ici parce que c'est le seul module partagé par les deux sections ;
 * il ne dépend d'aucune clé d'API et est sûr côté navigateur.
 */

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    /**
     * Corps de la reponse, tel quel.
     *
     * Un 409 n'est pas une panne : c'est une information (« cette entreprise
     * est deja chez vous »), et elle s'accompagne de l'id de la fiche pour que
     * l'ecran puisse y renvoyer au lieu d'afficher une erreur.
     */
    readonly payload: Record<string, unknown> | null = null,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

/** POST JSON → JSON, avec un message d'erreur exploitable tel quel dans un toast. */
export async function postJson<T>(url: string, body: unknown): Promise<T> {
  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch {
    throw new ApiError("Réseau indisponible. Vérifiez votre connexion.", 0);
  }

  const payload = (await response.json().catch(() => null)) as
    | (Record<string, unknown> & { error?: string })
    | null;
  if (!response.ok) {
    throw new ApiError(payload?.error ?? `Erreur ${response.status}.`, response.status, payload);
  }
  return payload as T;
}
