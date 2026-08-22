// PAUSE SERVICE WORKER - Offline Caching v4.0 (Always-Fresh Network-First)
const CACHE_VERSION = 'v18';
const CACHE_NAME = `pause-cache-${CACHE_VERSION}`;
const RUNTIME_CACHE = `pause-runtime-${CACHE_VERSION}`;

// Files to precache on install (critical app files)
const PRECACHE_FILES = [
  './index.html',
  './app.js',
  './lucide.min.js',
  './manifest.json',
  './icons/pause_icon_192.png',
  './icons/pause_icon_512.png',
  './icons/pause_icon_180.png',
  './icons/favicon.ico',
  './icons/pause_favicon_16.png',
  './icons/pause_favicon_32.png'
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
  console.log('[SW] Installing version:', CACHE_VERSION);

  e.waitUntil(
    (async () => {
      try {
        const cache = await caches.open(CACHE_NAME);
        console.log('[SW] Precaching files...');

        // Cache files one by one with error handling
        for (const file of PRECACHE_FILES) {
          try {
            await cache.add(file);
            console.log('[SW] ✓ Cached:', file);
          } catch (err) {
            console.warn('[SW] ✗ Failed to cache:', file, err.message);
          }
        }

        console.log('[SW] Precache complete');
        return self.skipWaiting();
      } catch (err) {
        console.error('[SW] Precache failed:', err);
        return self.skipWaiting();
      }
    })()
  );
});

// ==================== ACTIVATE ====================
self.addEventListener('activate', (e) => {
  console.log('[SW] Activating version:', CACHE_VERSION);

  e.waitUntil(
    (async () => {
      // Delete old caches
      const cacheNames = await caches.keys();
      const deletePromises = cacheNames
        .filter(name => name !== CACHE_NAME && name !== RUNTIME_CACHE)
        .map(name => {
          console.log('[SW] Deleting old cache:', name);
          return caches.delete(name);
        });

      await Promise.all(deletePromises);

      // Claim all clients immediately
      await self.clients.claim();
      console.log('[SW] Activation complete');
    })()
  );
});

// ==================== FETCH STRATEGIES ====================

// Helper: Check if URL should be cached from CDN
function isCDNUrl(url) {
  return CDN_CACHE_PATTERNS.some(pattern => pattern.test(url));
}

// Helper: Is this a navigation request?
function isNavigationRequest(request) {
  return request.mode === 'navigate' ||
    (request.method === 'GET' && request.headers.get('accept')?.includes('text/html'));
}

// Strategy: Cache First with Network Fallback (for static assets)
async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) {
    return cached;
  }

  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(CACHE_NAME);
      await cache.put(request, response.clone());
    }
    return response;
  } catch (err) {
    console.error('[SW] Fetch failed:', request.url, err);
    throw err;
  }
}

// Strategy: Network First with Cache Fallback (for HTML pages & dynamic scripts)
async function networkFirst(request) {
  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(CACHE_NAME);
      await cache.put(request, response.clone());
    }
    return response;
  } catch (err) {
    console.log('[SW] Network failed, trying cache:', request.url);
    const cached = await caches.match(request);
    if (cached) {
      return cached;
    }

    // Return offline page for navigation requests
    if (isNavigationRequest(request)) {
      const offlinePage = await caches.match('./index.html');
      if (offlinePage) return offlinePage;
    }

    throw err;
  }
}

// Strategy: Stale While Revalidate (for CDN resources)
async function staleWhileRevalidate(request) {
  const cache = await caches.open(RUNTIME_CACHE);
  const cached = await cache.match(request);

  const fetchPromise = fetch(request)
    .then(async response => {
      if (response.ok) {
        await cache.put(request, response.clone());
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
  try {
    const url = new URL(e.request.url);

    // Skip non-GET requests
    if (e.request.method !== 'GET') {
      return;
    }

    // Skip chrome-extension and other non-http(s) requests
    if (!url.protocol.startsWith('http')) {
      return;
    }

    // Skip cross-origin requests that aren't CDN
    if (url.origin !== location.origin && !isCDNUrl(url.href)) {
      return;
    }

    // Navigation requests (HTML pages) - Network First
    if (isNavigationRequest(e.request)) {
      e.respondWith(networkFirst(e.request));
      return;
    }

    // Local code files (HTML, JS, CSS) - Network First for instant code updates
    if (url.origin === location.origin) {
      if (url.pathname.endsWith('.js') || url.pathname.endsWith('.html') || url.pathname.endsWith('.css') || url.pathname === '/') {
        e.respondWith(networkFirst(e.request));
        return;
      }
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
  } catch (err) {
    console.error('[SW] Fetch handler error:', err);
  }
});

// ==================== MESSAGE HANDLER ====================
self.addEventListener('message', (e) => {
  if (e.data && e.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }

  if (e.data && e.data.type === 'GET_CACHE_STATUS') {
    caches.keys().then(names => {
      // Check if our cache exists
      const hasCache = names.includes(CACHE_NAME);
      const hasRuntimeCache = names.includes(RUNTIME_CACHE);

      if (e.ports && e.ports[0]) {
        e.ports[0].postMessage({
          version: CACHE_VERSION,
          caches: names,
          ready: hasCache && hasRuntimeCache
        });
      }
    }).catch(err => {
      console.error('[SW] Error getting cache status:', err);
    });
  }

  if (e.data && e.data.type === 'CLEAR_CACHES') {
    caches.keys().then(names => {
      names.forEach(name => caches.delete(name));
      console.log('[SW] All caches cleared');
    });
  }
});

// ==================== ERROR HANDLING ====================
self.addEventListener('error', (e) => {
  console.error('[SW] Error:', e.error);
});

self.addEventListener('unhandledrejection', (e) => {
  console.error('[SW] Unhandled rejection:', e.reason);
});

console.log('[SW] Service Worker v' + CACHE_VERSION + ' loaded');
