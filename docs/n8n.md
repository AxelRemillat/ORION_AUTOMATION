# Workflow n8n — envoi des messages de prospection

L'app ne parle **jamais** à Gmail directement : elle appelle un webhook n8n, qui
envoie le mail depuis le compte Google Workspace `axel@axelremillat.com`. Ce
document décrit le contrat attendu côté n8n. Rien n'est à coder dans le repo.

## 1. Workflow « send » (obligatoire)

**Déclencheur : `Webhook`**

| Réglage | Valeur |
| --- | --- |
| Method | `POST` |
| Path | ex. `prospect/send` |
| Response mode | `Last node` (ou `Respond to Webhook`) |
| Authentication | Header auth recommandé (voir §3) |

L'URL de production du webhook est renseignée côté app dans
`N8N_WEBHOOK_SEND_URL` (`.env.local`, et variable d'environnement Vercel).

**Corps envoyé par `POST /api/emails/send` :**

```json
{
  "to": "contact@entreprise.fr",
  "subject": "Votre pipeline de données",
  "body": "Bonjour,\n\n…",
  "prospect_id": "0f5f…",
  "message_id": "9ab1…"
}
```

- `to` : destinataire validé côté app (format e-mail).
- `subject` : peut être une chaîne vide (jamais `null`).
- `body` : texte brut, sauts de ligne `\n`.
- `prospect_id` / `message_id` : UUID Supabase, à recopier tels quels dans les
  logs n8n pour pouvoir tracer un envoi.

**Nœud `Gmail` → `Send`**

| Champ | Expression |
| --- | --- |
| To | `={{ $json.body.to }}` |
| Subject | `={{ $json.body.subject }}` |
| Message | `={{ $json.body.body }}` |
| Email type | `Text` |

Credential : OAuth2 Gmail sur `axel@axelremillat.com`.

**Réponse attendue**

- Le corps renvoyé par le nœud Gmail (`{ id, threadId, … }`) est lu : `threadId`
  est enregistré dans `messages.thread_id` s'il manquait, `id` dans
  `messages.gmail_message_id`. Facultatif : sans eux, l'envoi est le même.
- `200` (n'importe quel corps JSON) ⇒ l'app considère le mail parti et
  enchaîne : `messages.status = 'sent'`, `messages.sent_at = now()`, statut du
  prospect avancé, relance planifiée.
- Tout autre code, ou une absence de réponse ⇒ l'app renvoie `502` et **ne
  touche à rien** en base : le brouillon reste renvoyable.

> Important : ne pas répondre `200` avant que le nœud Gmail ait réussi, sinon
> l'app marquera comme envoyé un message qui ne l'est pas.

## 2. Effets de bord côté app (pour information)

Après un `200`, `/api/emails/send` :

1. passe le message en `sent` avec `sent_at`,
2. avance le prospect (`intro` → `contacte`, `relance_1` → `relance_1`,
   `relance_2` → `relance_2`) — jamais en arrière si le prospect est déjà
   `repondu`, `en_discussion`, `gagne` ou `perdu`,
3. solde les relances ouvertes du prospect,
4. crée la relance suivante : **+4 jours** après un `intro`, **+7 jours** après
   une `relance_1`. Pas de relance après `relance_2`.

## 3. Sécurité

Le webhook est public par nature. Deux garde-fous simples :

- activer *Header Auth* sur le nœud Webhook (ex. `X-Prospect-Token`) et ajouter
  l'en-tête côté app si besoin ;
- ou restreindre par IP via un reverse proxy devant n8n.

## 4. Workflow « relances dues » (optionnel)

Un second workflow peut envoyer un rappel quotidien plutôt que d'attendre
l'ouverture de l'app.

**Déclencheur : `Schedule Trigger`** — tous les jours à 08:00 (Europe/Paris).

**Lecture des relances** — au choix :

- `HTTP Request` sur `GET {APP_URL}/api/reminders?scope=due` (nécessite un
  cookie de session Supabase : à réserver à un usage manuel), ou
- `Postgres` directement sur la base Supabase (recommandé pour un cron) :

```sql
select r.id, r.due_at, p.company_name, p.status
from reminders r
join prospects p on p.id = r.prospect_id
where r.done = false
  and r.due_at <= now()
order by r.due_at;
```

**Sortie** : un mail ou un message Slack récapitulatif avec un lien
`{APP_URL}/suivi` — la relance elle-même reste déclenchée à la main depuis la
fiche prospect (envoi semi-automatique assumé).

Les relances se soldent depuis l'app (bouton « Fait ») ou via
`PATCH /api/reminders/{id}` avec `{ "done": true }`.
