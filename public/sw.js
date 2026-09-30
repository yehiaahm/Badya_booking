// Badya Spaces — shows push notifications on the phone, like any other app's,
// and opens the right screen when one is tapped. It does nothing else (no offline caching).

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch (e) {
    data = { body: event.data ? event.data.text() : "" };
  }
  const arabic = /[؀-ۿ]/.test((data.title || "") + (data.body || ""));
  event.waitUntil(
    self.registration.showNotification(data.title || "Badya Spaces", {
      body: data.body || "",
      icon: "icons/icon-192.png",
      badge: "icons/badge-96.png",
      tag: data.tag,
      renotify: !!data.tag,
      dir: arabic ? "rtl" : "ltr",
      lang: arabic ? "ar" : "en",
      data: { link: data.link || "/" },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  // The app uses hash routes: /bookings/BK-1 → <app>/#/bookings/BK-1
  const url = new URL(self.registration.scope);
  url.hash = (event.notification.data && event.notification.data.link) || "/";
  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      for (const w of windows) {
        if (w.url.startsWith(self.registration.scope)) {
          await w.focus();
          if ("navigate" in w) await w.navigate(url.href);
          return;
        }
      }
      await self.clients.openWindow(url.href);
    })(),
  );
});

// The push service renewed the subscription: hand the new one to the server.
self.addEventListener("pushsubscriptionchange", (event) => {
  event.waitUntil(
    (async () => {
      const options = event.oldSubscription && event.oldSubscription.options;
      if (!options) return;
      const sub = await self.registration.pushManager.subscribe(options);
      await fetch(new URL("api/me/subscribePush", self.registration.scope), {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json", "X-Requested-With": "badya-spaces" },
        body: JSON.stringify({ args: [sub.toJSON()] }),
      });
    })(),
  );
});
