self.addEventListener('push', function(event) {
    let data = { title: "Nexus Alert", body: "You have a new notification." };
    if (event.data) {
        try {
            data = event.data.json();
        } catch(e) {
            data.body = event.data.text();
        }
    }

    let badgePromise = Promise.resolve();
    if (navigator.setAppBadge && data.badgeCount) {
        badgePromise = navigator.setAppBadge(data.badgeCount).catch(() => {});
    }

    const options = {
        body: data.body,
        icon: '/pwa-512x512.png',
        badge: '/pwa-192x192.png',
        vibrate: [200, 100, 200],
        data: {
            dateOfArrival: Date.now(),
            primaryKey: 'nexus-push'
        }
    };

    event.waitUntil(
        Promise.all([
            badgePromise,
            self.registration.showNotification(data.title, options)
        ])
    );
});

self.addEventListener('notificationclick', function(event) {
    event.notification.close();
    
    if (navigator.clearAppBadge) {
        navigator.clearAppBadge().catch(() => {});
    }

    event.waitUntil(
        clients.matchAll({ type: 'window' }).then(windowClients => {
            for (var i = 0; i < windowClients.length; i++) {
                var client = windowClients[i];
                if (client.url.includes(self.registration.scope) && 'focus' in client) {
                    return client.focus();
                }
            }
            if (clients.openWindow) {
                return clients.openWindow('/');
            }
        })
    );
});
