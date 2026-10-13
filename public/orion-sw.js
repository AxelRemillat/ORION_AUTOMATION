/*
 * Service worker ORION — notifications sur le PC (Web Push, Cowork #28).
 *
 * Reçoit les deux événements poussés par le serveur (vraie réponse d'un
 * prospect, offre passée en Alerte) et les affiche même onglet ORION fermé,
 * tant que le navigateur tourne.
 *
 * ANTI-RAFALE : un événement arrivé moins d'une minute après le début d'une
 * notification encore affichée la remplace par un regroupement
 * (« ORION · 3 nouveautés »), au lieu d'empiler trois notifications.
 * Clic → la fiche, le mail ou l'offre (un regroupement ouvre la section).
 */
const BURST_MS = 60 * 1000;
const SECTIONS = { reply: "/cockpit", alerte: "/opportunites" };

/** Regroupe `incoming` dans la notification précédente si elle date de moins d'une minute. */
function burst(previous, incoming, now) {
  const item = { kind: incoming.kind || "test", title: incoming.title || "ORION", url: incoming.url || "/aujourdhui" };
  const recent = previous && now - previous.at < BURST_MS ? previous : null;
  const items = (recent ? recent.items : []).concat([item]);
  if (items.length === 1) return { title: item.title, body: incoming.body || "", url: item.url, at: now, items };
  const kinds = Array.from(new Set(items.map((entry) => entry.kind)));
  return {
    title: `ORION · ${items.length} nouveautés`,
    body: items.slice(-4).map((entry) => entry.title).join("\n"),
    url: kinds.length === 1 && SECTIONS[kinds[0]] ? SECTIONS[kinds[0]] : "/aujourdhui",
    at: recent.at,
    items,
  };
}

async function show(incoming) {
  const now = Date.now();
  const open = await self.registration.getNotifications();
  const previous = open.map((notification) => notification.data).filter((data) => data && now - data.at < BURST_MS).sort((a, b) => b.at - a.at)[0];
  const next = burst(previous || null, incoming, now);
  // Même tag que la notification regroupée : elle est remplacée, pas empilée.
  return self.registration.showNotification(next.title, { body: next.body, tag: `orion-${next.at}`, renotify: true, icon: "/orion-logo.png", data: next });
}

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

self.addEventListener("push", (event) => {
  let incoming = {};
  try {
    incoming = event.data ? event.data.json() : {};
  } catch (error) {
    incoming = { title: "ORION", body: event.data ? event.data.text() : "" };
  }
  event.waitUntil(show(incoming));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const path = (event.notification.data && event.notification.data.url) || "/aujourdhui";
  const url = new URL(path, self.location.origin).href;
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((windows) => {
      const orion = windows.find((client) => new URL(client.url).origin === self.location.origin && "navigate" in client);
      if (orion) return orion.focus().then(() => orion.navigate(url));
      return self.clients.openWindow(url);
    }),
  );
});

// Tests (scripts/notifs-pc.test.ts) : la règle de regroupement, sans navigateur.
self.__orionBurst = burst;
