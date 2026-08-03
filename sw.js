// PAUSE SERVICE WORKER - Offline Caching v2.0
const CACHE_VERSION = 'v2';
const CACHE_NAME = `pause-cache-${CACHE_VERSION}`;
const RUNTIME_CACHE = `pause-runtime-${CACHE_VERSION}`;

// Files to precache on install (critical app files)
const PRECACHE_FILES = [
  './',
  './index.html',
  './app.js',
  './privacy.html',
  './manifest.json',
  './icons/pause_icon_192.png',
  './icons/pause_icon_512.png',
  './icons/favicon.ico'
];

// CDN resources to cache at runtime
const CDN_CACHE_PATTERNS = [
  /^https:\/\/cdn\.tailwindcss\.com/,
  /^https:\/\/cdn\.jsdelivr\.net/,
  /^https:\/\/unpkg\.com/,
  /^https:\/\/cdnjs\.cloudflare\.com/,
  /^https:\/\/api\.fontshare\.com/,
  /^https:\/\/fonts\.googleapis\.com/,
  /^https:\/\/fonts\.gstatic\.com/
];

// ==================== INSTALL ====================
self.addEventListener('install', (e) => {
  console.log('[SW] Installing...');
  e.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => {
        console.log('[SW] Precaching critical files');
        return cache.addAll(PRECACHE_FILES);
      })
      .then(() => self.skipWaiting())
      .catch(err => {
        console.error('[SW] Precache failed:', err);
        return self.skipWaiting();
      })
  );
});

// ==================== ACTIVATE ====================
self.addEventListener('activate', (e) => {
  console.log('[SW] Activating...');
  e.waitUntil(
    caches.keys()
      .then(cacheNames => {
        return Promise.all(
          cacheNames
            .filter(name => name !== CACHE_NAME && name !== RUNTIME_CACHE)
            .map(name => {
              console.log('[SW] Deleting old cache:', name);
              return caches.delete(name);
            })
        );
      })
      .then(() => self.clients.claim())
  );
});

// ==================== FETCH STRATEGIES ====================

// Helper: Check if URL should be cached from CDN
function isCDNUrl(url) {
  return CDN_CACHE_PATTERNS.some(pattern => pattern.test(url));
}

// Helper: Is this a navigation request?
function isNavigationRequest(request) {
  return request.mode === 'navigate';
}

// Strategy: Cache First (for static assets)
async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) {
    return cached;
  }

  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(CACHE_NAME);
      cache.put(request, response.clone());
    }
    return response;
  } catch (err) {
    console.error('[SW] Fetch failed:', request.url, err);
    throw err;
  }
}

// Strategy: Network First (for HTML pages)
async function networkFirst(request) {
  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(CACHE_NAME);
      cache.put(request, response.clone());
    }
    return response;
  } catch (err) {
    console.log('[SW] Network failed, trying cache:', request.url);
    const cached = await caches.match(request);
    if (cached) {
      return cached;
    }
    throw err;
  }
}

// Strategy: Stale While Revalidate (for CDN resources)
async function staleWhileRevalidate(request) {
  const cache = await caches.open(RUNTIME_CACHE);
  const cached = await cache.match(request);

  const fetchPromise = fetch(request)
    .then(response => {
      if (response.ok) {
        cache.put(request, response.clone());
      }
      return response;
    })
    .catch(err => {
      console.log('[SW] CDN fetch failed:', request.url);
      return cached;
    });

  return cached || fetchPromise;
}

// ==================== MAIN FETCH HANDLER ====================
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);

  // Skip non-GET requests
  if (e.request.method !== 'GET') {
    return;
  }

  // Skip chrome-extension and other non-http(s) requests
  if (!url.protocol.startsWith('http')) {
    return;
  }

  // Navigation requests (HTML pages) - Network First
  if (isNavigationRequest(e.request)) {
    e.respondWith(networkFirst(e.request));
    return;
  }

  // Local app files - Cache First
  if (url.origin === location.origin) {
    e.respondWith(cacheFirst(e.request));
    return;
  }

  // CDN resources - Stale While Revalidate
  if (isCDNUrl(url.href)) {
    e.respondWith(staleWhileRevalidate(e.request));
    return;
  }

  // External requests - Network First with cache fallback
  e.respondWith(networkFirst(e.request));
});

// ==================== BACKGROUND SYNC ====================
self.addEventListener('sync', (e) => {
  if (e.tag === 'sync-data') {
    console.log('[SW] Background sync triggered');
    // Future: Sync data when connection is restored
  }
});

// ==================== NOTIFICATION CLICK ====================
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  e.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true })
      .then(clientList => {
        for (let client of clientList) {
          if (client.url && 'focus' in client) {
            return client.focus();
          }
        }
        if (clients.openWindow) {
          return clients.openWindow('./');
        }
      })
  );
});

// ==================== MESSAGE HANDLER ====================
self.addEventListener('message', (e) => {
  if (e.data && e.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }

  if (e.data && e.data.type === 'GET_CACHE_STATUS') {
    caches.keys().then(names => {
      e.ports[0].postMessage({
        version: CACHE_VERSION,
        caches: names
      });
    });
  }
});

console.log('[SW] Service Worker loaded - Cache version:', CACHE_VERSION);
