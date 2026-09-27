# Workflow n8n — boîte de réception intelligente

Symétrique de [`n8n.md`](./n8n.md), qui décrit l'envoi. Ici c'est l'inverse :
n8n **lit** la boîte `axel@axelremillat.com`, trie, et ne pousse vers ORION que
les emails liés à la prospection.

> **Confidentialité — le point le plus important de ce document.**
> ORION n'ingère **jamais** toute la boîte. Le filtrage est fait dans n8n,
> AVANT l'appel HTTP : seuls les emails que le classifieur marque
> `is_prospect_related = true` quittent le workflow. Un mail personnel, une
> facture, une newsletter ne doivent jamais atteindre `/api/inbound`. Si le
> nœud de filtrage est retiré ou mal branché, la confidentialité est perdue —
> l'app n'a aucun moyen de rattraper ça côté serveur.

Le workflow tient en quatre nœuds.

---

## 1. `Gmail Trigger` — nouveaux emails

| Réglage | Valeur |
| --- | --- |
| Credential | OAuth2 Gmail sur `axel@axelremillat.com` |
| Event | `Message Received` |
| Poll Times | toutes les 5 ou 15 minutes |
| Simplify | **désactivé** — on a besoin du `threadId` et des en-têtes |
| Filters → Label / Query | facultatif, mais recommandé : `-in:spam -category:promotions` |

Restreindre en amont (un label Gmail `Prospection`, ou une requête `from:` ciblée)
réduit à la fois le coût de classification et la surface de données traversée.

---

## 2. `OpenAI` — classification

Nœud *Message a Model*, en mode JSON.

**System prompt :**

```
Tu tries la boîte mail d'un freelance qui fait de la prospection B2B.
Pour l'email fourni, réponds UNIQUEMENT par un objet JSON :

{
  "is_prospect_related": true | false,
  "category": "reponse" | "question" | "relance" | "refus" | "autre",
  "sentiment": "positif" | "neutre" | "negatif"
}

is_prospect_related = true UNIQUEMENT si l'email vient d'une entreprise
démarchée ou d'un contact professionnel répondant à une prise de contact
commerciale. false pour tout le reste : personnel, factures, newsletters,
notifications d'outils, candidatures, spam.

category :
- "reponse" : il répond à une prise de contact
- "question" : il demande une précision
- "relance"  : il relance ou s'impatiente
- "refus"    : il décline
- "autre"    : lié à la prospection mais rien de ce qui précède
```

**User prompt :**

```
De : {{ $json.from.value[0].address }}
Objet : {{ $json.subject }}

{{ $json.text }}
```

---

## 3. `IF` — le filtre de confidentialité

| Champ | Valeur |
| --- | --- |
| Condition | Boolean → `is true` |
| Valeur 1 | `={{ JSON.parse($json.message.content).is_prospect_related }}` |

Seule la branche **true** continue. La branche false ne doit être reliée à
**rien**.

---

## 4. `HTTP Request` — POST vers ORION

| Réglage | Valeur |
| --- | --- |
| Method | `POST` |
| URL | `https://<votre-domaine>/api/inbound` |
| Authentication | None (le secret passe par un en-tête) |
| Send Headers | activé |
| Send Body | activé, `JSON` |

**En-têtes :**

| Nom | Valeur |
| --- | --- |
| `Content-Type` | `application/json` |
| `x-orion-inbound-secret` | la valeur de `INBOUND_WEBHOOK_SECRET` |

Le nom de l'en-tête est sensible à la casse côté n8n mais pas côté serveur.
Générer le secret avec `openssl rand -hex 32`, le poser dans `.env.local` **et**
dans les variables d'environnement Vercel, et le recopier ici. Sans cet en-tête,
l'endpoint répond `401` : c'est un point d'écriture public, il n'a pas d'autre
protection.

**Corps exact attendu :**

```json
{
  "from_email": "contact@entreprise.fr",
  "subject": "Re : votre message",
  "body": "Bonjour Axel,\n\nMerci pour votre retour…",
  "thread_id": "18f2c1a9b7d4e5f0",
  "gmail_message_id": "18f2c1a9b7d4e5f1",
  "received_at": "2026-09-24T08:41:00.000Z",
  "category": "reponse"
}
```

Expressions n8n correspondantes :

| Champ | Expression | Obligatoire |
| --- | --- | --- |
| `from_email` | `={{ $('Gmail Trigger').item.json.from.value[0].address }}` | **oui** |
| `subject` | `={{ $('Gmail Trigger').item.json.subject }}` | non |
| `body` | `={{ $('Gmail Trigger').item.json.text }}` | **oui** |
| `thread_id` | `={{ $('Gmail Trigger').item.json.threadId }}` | non, mais fortement recommandé |
| `gmail_message_id` | `={{ $('Gmail Trigger').item.json.id }}` | non, mais requis pour qu'une réponse programmée parte dans le fil (Gmail → Reply) |
| `received_at` | `={{ $('Gmail Trigger').item.json.date }}` | non (défaut : maintenant) |
| `category` | `={{ JSON.parse($json.message.content).category }}` | non (défaut : `autre`) |

Notes :

- `from_email` accepte aussi la forme `Nom <adresse@ex.fr>` : l'app extrait
  l'adresse. Elle est normalisée en minuscules.
- `body` est du **texte brut** (`.text`, pas `.html`), tronqué à 20 000
  caractères. Envoyer du HTML rendrait les brouillons IA illisibles.
- `thread_id` est ce qui permet de répondre **dans la même conversation**
  Gmail. Sans lui, la réponse ouvrira un nouveau fil.
- `sentiment` n'est pas stocké : il sert seulement, si vous le souhaitez, à
  router ou alerter dans n8n.

---

## 5. Réponses de l'endpoint

L'endpoint est volontairement tolérant : **un échec applicatif ne doit jamais
faire échouer le workflow**, sinon n8n rejouerait le même email en boucle.

| Code | Corps | Signification |
| --- | --- | --- |
| `200` | `{ ok: true, stored: true, inbound_id, matched_prospect_id, prospect_status }` | Enregistré. `matched_prospect_id` est `null` si l'adresse n'a pas été reconnue. |
| `200` | `{ ok: true, stored: false, duplicate: true }` | Email déjà reçu — rejeu sans effet, rien à faire. |
| `200` | `{ ok: false, stored: false, reason: "…" }` | Aucun compte propriétaire (portefeuille vide). |
| `400` | `{ error }` | `from_email` ou `body` manquant / invalide. |
| `401` | `{ error }` | En-tête secret absent ou faux. |
| `503` | `{ error }` | `INBOUND_WEBHOOK_SECRET` n'est pas configurée côté app. |

---

## 6. Effets de bord côté app

Sur un enregistrement réussi :

1. le message entrant apparaît dans **« Réponses reçues »**, en tête du Cockpit,
   avec un code couleur chaud distinct du reste de l'interface ;
2. si `from_email` correspond à `prospects.email`, le message est rattaché au
   prospect et son statut passe à **`repondu`** — jamais en arrière : un
   prospect déjà `en_discussion`, `gagne` ou `perdu` n'est pas dégradé ;
3. depuis le Cockpit, un brouillon de réponse peut être généré (voix d'Axel,
   fil complet et fiche entreprise en contexte), relu, corrigé, puis envoyé par
   le workflow `send` — qui reçoit alors `thread_id` et peut répondre dans la
   conversation d'origine ;
4. l'envoi marque l'entrant `handled` et fait passer le prospect en
   **`en_discussion`**.

La validation manuelle reste obligatoire : aucun email ne part sans un clic.

---

## 7. Déduplication

Un index unique porte sur `(user_id, from_email, received_at, thread_id)`. Un
même email rejoué renvoie donc `duplicate: true` plutôt que de créer un
doublon — il est sans danger de relancer une exécution n8n.
