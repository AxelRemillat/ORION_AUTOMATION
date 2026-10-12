/**
 * LIEN DE VALIDATION ANTI-SPAM — choisir le lien d'ACTION, jamais le logo.
 *
 * Cas réel du 12/10/2026 (ici anonymisé) : sur un challenge Mailinblack,
 * « Ouvrir le lien de validation » ouvrait
 * app.mailinblack.com/…/unauthenticated/logo/…/logo.png. L'extracteur prenait
 * le PREMIER lien du mail, et le premier lien d'un mail est son logo.
 *
 * Fixtures seulement : aucun réseau, aucune base, aucun envoi.
 * `npm run test:antispam-lien`
 */
import { antispamLink, autoReplyKind } from "../lib/inbound/auto-reply";

let failures = 0;
function check(name: string, condition: boolean, detail: unknown = "") {
  if (condition) console.log(`  ok   ${name}`);
  else {
    failures += 1;
    console.log(`  FAIL ${name}${detail === "" ? "" : ` — ${typeof detail === "string" ? detail : JSON.stringify(detail)}`}`);
  }
}

const lines = (...rows: string[]) => rows.join("\n");

/** Le cas d'Axel, anonymisé : logo d'abord, invitation ensuite, désabonnement à la fin. */
const MAILINBLACK = {
  from_email: "acme-industrie@invitations.mailinblack.com",
  subject: "Re: Demandes d'outillage",
  body: lines(
    "Bonjour,",
    "https://app.mailinblack.com/mibc-fr-06/unauthenticated/logo/8f21c4/logo.png",
    "Votre message à contact@acme-industrie.fr est en attente de validation.",
    "Cliquez ici pour délivrer votre email : https://app.mailinblack.com/mibc-fr-06/invitation?token=9f3c8a2b",
    "https://app.mailinblack.com/mibc-fr-06/unsubscribe?u=77",
    "Mailinblack",
  ),
};

/** humail : « en attente de libération », le lien libère le message. */
const HUMAIL = {
  from_email: "quarantaine@humail.fr",
  subject: "Un message est en attente de libération",
  body: lines(
    "https://app.humail.fr/assets/logo.gif",
    "Un message de votre part est en attente de libération.",
    "Pour le libérer : https://app.humail.fr/release/4d5e6f?k=1",
  ),
};

/** Altospam : le mail part du domaine du CLIENT, le lien vit chez l'éditeur. */
const ALTOSPAM = {
  from_email: "quarantaine@acme-outillage.fr",
  subject: "Votre message est bloqué : vérification anti-spam",
  body: lines(
    "https://acme-outillage.fr/images/logo.png",
    "Votre message est retenu en attente de validation.",
    "Validez l'expéditeur : https://www.altospam.com/quarantaine/validate?id=77",
  ),
};

const VADE = {
  from_email: "no-reply@vadesecure.com",
  subject: "Sender verification required",
  body: lines(
    "https://secure.vadesecure.com/static/logo.svg",
    "Click here to release your message: https://secure.vadesecure.com/release?token=ab12cd",
  ),
};

/** Un service « Protect » quelconque : le domaine de l'expéditeur fait foi. */
const PROTECT = {
  from_email: "noreply@mail-protect.example.net",
  subject: "Sender verification required",
  body: lines(
    "https://mail-protect.example.net/img/logo.jpg",
    "Please verify that you are a human.",
    "https://mail-protect.example.net/verification/confirm?code=55",
  ),
};

const HTML_ANCHOR = {
  from_email: "acme@invitations.mailinblack.com",
  subject: "Votre message est en attente de validation",
  body:
    '<img src="https://app.mailinblack.com/u/logo.png" alt="logo">' +
    '<a href="https://app.mailinblack.com/u/i/7f3a">Cliquez ici pour délivrer votre email</a>',
};

const REAL_REPLY = {
  from_email: "dirigeant@acme-outillage.fr",
  subject: "Re: Votre proposition",
  body: "Bonjour, oui ça m'intéresse, rappelez-moi jeudi.",
};

function main() {
  console.log("\n1. Les cinq éditeurs visés");
  {
    check("Mailinblack : l'invitation, pas le logo", antispamLink(MAILINBLACK) === "https://app.mailinblack.com/mibc-fr-06/invitation?token=9f3c8a2b", String(antispamLink(MAILINBLACK)));
    check("humail : le lien de libération", antispamLink(HUMAIL) === "https://app.humail.fr/release/4d5e6f?k=1", String(antispamLink(HUMAIL)));
    check("Altospam : lien de l'éditeur, même quand l'expéditeur est le client", antispamLink(ALTOSPAM) === "https://www.altospam.com/quarantaine/validate?id=77", String(antispamLink(ALTOSPAM)));
    check("Vade : le lien de libération", antispamLink(VADE) === "https://secure.vadesecure.com/release?token=ab12cd", String(antispamLink(VADE)));
    check("Protect : la vérification sur le domaine de l'expéditeur", antispamLink(PROTECT) === "https://mail-protect.example.net/verification/confirm?code=55", String(antispamLink(PROTECT)));
    check("tous sont bien reconnus comme des anti-spams", [MAILINBLACK, HUMAIL, ALTOSPAM, VADE, PROTECT].every((mail) => autoReplyKind(mail) === "antispam"));
  }

  console.log("\n2. Ce qu'on ne propose jamais");
  {
    const link = antispamLink(MAILINBLACK) ?? "";
    check("ni le logo", !/logo/.test(link));
    check("ni le désabonnement (il ferait l'inverse du but)", !link.includes("unsubscribe"));
    check(
      "ni un lien d'action sur un AUTRE domaine",
      antispamLink({ from_email: "x@invitations.mailinblack.com", subject: "UN CLIC POUR DÉLIVRER VOTRE EMAIL", body: "Cliquez ici : https://evil.example.com/invitation?token=1" }) === null,
    );
    check(
      "aucun lien exploitable : rien, plutôt qu'une image",
      antispamLink({ from_email: "x@invitations.mailinblack.com", subject: "UN CLIC POUR DÉLIVRER VOTRE EMAIL", body: "https://app.mailinblack.com/u/logo/logo.png" }) === null,
    );
    check("un mail en http (non chiffré) n'est pas proposé", antispamLink({ from_email: "x@invitations.mailinblack.com", subject: "UN CLIC POUR DÉLIVRER VOTRE EMAIL", body: "http://app.mailinblack.com/invitation?token=1" }) === null);
    check("une vraie réponse n'a pas de lien de validation", antispamLink(REAL_REPLY) === null);
  }

  console.log("\n3. Comment le bon lien est reconnu");
  {
    check("le texte de l'ancre HTML compte, même posé APRÈS le lien", antispamLink(HTML_ANCHOR) === "https://app.mailinblack.com/u/i/7f3a", String(antispamLink(HTML_ANCHOR)));
    // Chemin d'action (3) + texte (2) + jeton (1) : l'ordre dans le corps ne décide plus.
    const BOTH = {
      from_email: "acme@invitations.mailinblack.com",
      subject: "UN CLIC POUR DÉLIVRER VOTRE EMAIL",
      body: lines(
        "Votre espace : https://app.mailinblack.com/mibc/espace",
        "Pour délivrer ce message : https://app.mailinblack.com/mibc/validate?token=aa11",
      ),
    };
    check("entre un lien neutre et un lien d'action, l'action gagne", antispamLink(BOTH) === "https://app.mailinblack.com/mibc/validate?token=aa11", String(antispamLink(BOTH)));
    const FIRST_WINS = {
      from_email: "acme@invitations.mailinblack.com",
      subject: "UN CLIC POUR DÉLIVRER VOTRE EMAIL",
      body: lines(
        "https://app.mailinblack.com/mibc/invitation?token=aa11",
        "https://app.mailinblack.com/mibc/invitation?token=bb22",
      ),
    };
    check("à égalité, le premier du corps", antispamLink(FIRST_WINS) === "https://app.mailinblack.com/mibc/invitation?token=aa11", String(antispamLink(FIRST_WINS)));
    check(
      "un lien d'action sans jeton reste proposé",
      antispamLink({ from_email: "acme@invitations.mailinblack.com", subject: "Message en attente de validation", body: "https://app.mailinblack.com/mibc/liberer-le-message" }) === "https://app.mailinblack.com/mibc/liberer-le-message",
    );
    check(
      "ponctuation finale retirée",
      antispamLink({ from_email: "acme@invitations.mailinblack.com", subject: "UN CLIC POUR DÉLIVRER VOTRE EMAIL", body: "Validez : https://app.mailinblack.com/mibc/validate?token=cc33." }) === "https://app.mailinblack.com/mibc/validate?token=cc33",
    );
  }

  console.log(failures === 0 ? "\nTous les tests du lien anti-spam passent.\n" : `\n${failures} test(s) en échec.\n`);
  process.exit(failures === 0 ? 0 : 1);
}

main();
