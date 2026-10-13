/**
 * Fenêtre « Programmer les envois » avec 60 mails (Cowork #50, 13/10/2026) :
 * avec 52 mails, la liste poussait le bouton « Confirmer » hors de l'écran.
 * Sur fixtures, sans réseau : 5 lignes visibles, « Voir plus (55) », liste
 * dépliée complète ; la modale tient dans l'écran, le pied reste hors du
 * défilement. Exécution : `npm run test:aujourdhui`.
 */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ScheduleList, SCHEDULE_PREVIEW, visibleRows, type ScheduleRow } from "@/app/(app)/aujourdhui/_components/schedule-list";
import { Modal } from "@/components/ui/modal";

let failures = 0;
function check(name: string, condition: boolean, detail = "") {
  if (condition) console.log(`  ok   ${name}`);
  else {
    failures += 1;
    console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

const rows: ScheduleRow[] = Array.from({ length: 60 }, (_, i) => ({ key: `k${i}`, company: `Entreprise ${i + 1}`, type: "Intro", when: `Aujourd'hui 09:${String(i % 60).padStart(2, "0")}` }));
const count = (html: string, needle: string) => html.split(needle).length - 1;

console.log("\nProgrammer les envois : 60 mails");

check("5 premières lignes, puis le reste caché", visibleRows(rows, false).shown.length === SCHEDULE_PREVIEW && visibleRows(rows, false).hidden === 55);
check("dépliée : les 60", visibleRows(rows, true).shown.length === 60 && visibleRows(rows, true).hidden === 0);
check("5 mails ou moins : tout, sans bouton", visibleRows(rows.slice(0, 5), false).hidden === 0 && visibleRows(rows.slice(0, 3), false).shown.length === 3);

const folded = renderToStaticMarkup(createElement(ScheduleList, { rows }));
check("rendu replié : 5 lignes", count(folded, "<tr") === 5, String(count(folded, "<tr")));
check("rendu replié : « Voir plus (55) »", folded.includes("Voir plus (55)"));
check("rendu replié : la 6e entreprise n'est pas affichée", folded.includes("Entreprise 5<") && !folded.includes("Entreprise 6<"));

const open = renderToStaticMarkup(createElement(ScheduleList, { rows, defaultExpanded: true }));
check("« Voir plus » déplié : les 60 lignes, plus de bouton", count(open, "<tr") === 60 && !open.includes("Voir plus"), String(count(open, "<tr")));
check("la liste défile dans son conteneur", /data-schedule-list="[^"]*" class="[^"]*min-h-0 flex-1 overflow-y-auto/.test(open));

// La modale entière, liste dépliée : hauteur bornée à l'écran, pied hors de la zone qui défile.
const modal = renderToStaticMarkup(
  createElement(Modal, {
    open: true, onClose: () => undefined, title: "Programmer les envois", fitScreen: true,
    footer: createElement("button", { "data-confirm": "" }, "Confirmer 60 envoi(s)"),
    children: createElement(ScheduleList, { rows, defaultExpanded: true }),
  }),
);
check("fenêtre bornée à 90 % de l'écran, en colonne", /class="[^"]*flex max-h-\[90vh\] flex-col supports-\[height:100dvh\]:max-h-\[90dvh\]/.test(modal));
const listAt = modal.indexOf("data-schedule-list");
const bodyClose = modal.lastIndexOf("</table>");
const confirmAt = modal.indexOf("data-confirm");
check("le bouton Confirmer est APRÈS la liste, hors du corps qui défile", confirmAt > bodyClose && bodyClose > listAt);
check("pied fixe (shrink-0) qui contient Confirmer", /<div class="[^"]*shrink-0">\s*<button data-confirm/.test(modal));
check("corps : colonne qui laisse défiler son enfant", /class="px-5 py-4 flex min-h-0 flex-1 flex-col overflow-y-auto"/.test(modal));

const plain = renderToStaticMarkup(createElement(Modal, { open: true, onClose: () => undefined, title: "Autre", children: "x", footer: "y" }));
check("sans fitScreen : les autres modales ne changent pas", !plain.includes("max-h-") && !plain.includes("shrink-0") && plain.includes('class="px-5 py-4"'));

console.log(failures === 0 ? "\nTous les tests de la fenêtre de programmation passent.\n" : `\n${failures} test(s) en échec.\n`);
process.exit(failures === 0 ? 0 : 1);
