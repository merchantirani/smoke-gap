// PAUSE SERVICE WORKER - Optimized v8.0
// Enhanced caching, offline support, and background sync

const CACHE_VERSION = 'v8';
const CACHE_NAME = `pause-cache-${CACHE_VERSION}`;
const RUNTIME_CACHE = `pause-runtime-${CACHE_VERSION}`;
const OFFLINE_CACHE = `pause-offline-${CACHE_VERSION}`;

// ==================== CACHE CONFIGURATION ====================

// Precache critical files on install
const PRECACHE_FILES = [
  './',
  './index.html',
  './app.js',
  './lucide.min.js',
  './tailwind.min.css',
  './manifest.json',
  './icons/favicon.ico',
  './icons/pause_favicon_16.png',
  './icons/pause_favicon_32.png',
  './icons/favicon_48.png',
  './icons/pause_icon_72.png',
  './icons/pause_icon_96.png',
  './icons/pause_icon_128.png',
  './icons/pause_icon_144.png',
  './icons/pause_icon_152.png',
  './icons/pause_icon_180.png',
  './icons/pause_icon_192.png',
  './icons/pause_icon_256.png',
  './icons/pause_icon_384.png',
  './icons/pause_icon_512.png'
];

// CDN patterns for runtime caching
const CDN_CACHE_PATTERNS = [
  /^https:\/\/cdn\.tailwindcss\.com/,
  /^https:\/\/cdn\.jsdelivr\.net/,
  /^https:\/\/unpkg\.com/,
  /^https:\/\/cdnjs\.cloudflare\.com/,
  /^https:\/\/api\.fontshare\.com/,
  /^https:\/\/fonts\.googleapis\.com/,
  /^https:\/\/fonts\.gstatic\.com/
];

// Cache size limits
const MAX_CACHE_SIZE = {
  runtime: 50, // Max entries in runtime cache
  cdn: 100     // Max entries in CDN cache
};

// Cache expiration times (in milliseconds)
const CACHE_EXPIRATION = {
  runtime: 7 * 24 * 60 * 60 * 1000, // 7 days
  cdn: 30 * 24 * 60 * 60 * 1000     // 30 days
};

// ==================== INSTALL ====================
self.addEventListener('install', (e) => {
  console.log('[SW] Installing version:', CACHE_VERSION);

  e.waitUntil(
    (async () => {
      try {
        const cache = await caches.open(CACHE_NAME);
        console.log('[SW] Precaching critical files...');

        // Cache files in parallel with error handling
        const cachePromises = PRECACHE_FILES.map(async (file) => {
          try {
            await cache.add(file);
            console.log('[SW] ✓ Cached:', file);
            return true;
          } catch (err) {
            console.warn('[SW] ✗ Failed to cache:', file, err.message);
            return false;
          }
        });

        await Promise.all(cachePromises);
        console.log('[SW] Precache complete');

        // Create offline cache with fallback page
        const offlineCache = await caches.open(OFFLINE_CACHE);
        const offlinePage = new Response(offlineHTML(), {
          headers: { 'Content-Type': 'text/html' }
        });
        await offlineCache.put('./offline.html', offlinePage);

        return self.skipWaiting();
      } catch (err) {
        console.error('[SW] Precache failed:', err);
        return self.skipWaiting();
      }
    })()
  );
});

// Offline fallback HTML
function offlineHTML() {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>PAUSE - Offline</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: #090A0F;
      color: #fff;
      display: flex;
      justify-content: center;
      align-items: center;
      min-height: 100vh;
      text-align: center;
      padding: 20px;
    }
    .offline-container {
      max-width: 400px;
      padding: 40px 30px;
      background: rgba(255,255,255,0.05);
      border-radius: 20px;
      border: 1px solid rgba(255,255,255,0.1);
    }
    h1 {
      font-size: 2rem;
      margin-bottom: 20px;
      background: linear-gradient(135deg, #00D4FF 0%, #7B68EE 100%);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
    }
    p {
      color: #9CA3AF;
      line-height: 1.6;
      margin-bottom: 30px;
    }
    .retry-btn {
      background: linear-gradient(135deg, #00D4FF 0%, #7B68EE 100%);
      color: #090A0F;
      border: none;
      padding: 14px 32px;
      border-radius: 12px;
      font-size: 16px;
      font-weight: 600;
      cursor: pointer;
      transition: transform 0.2s;
    }
    .retry-btn:hover { transform: scale(1.05); }
    .offline-icon {
      font-size: 4rem;
      margin-bottom: 20px;
      opacity: 0.6;
    }
  </style>
</head>
<body>
  <div class="offline-container">
    <div class="offline-icon">📡</div>
    <h1>You're Offline</h1>
    <p>No internet connection detected. Your data is safe and stored locally. Please check your connection and try again.</p>
    <button class="retry-btn" onclick="window.location.reload()">Try Again</button>
  </div>
</body>
</html>`;
}

// ==================== ACTIVATE ====================
self.addEventListener('activate', (e) => {
  console.log('[SW] Activating version:', CACHE_VERSION);

  e.waitUntil(
    (async () => {
      // Get all cache names
      const cacheNames = await caches.keys();

      // Delete old caches (keep current version caches)
      const deletePromises = cacheNames
        .filter(name =>
          name !== CACHE_NAME &&
          name !== RUNTIME_CACHE &&
          name !== OFFLINE_CACHE
        )
        .map(name => {
          console.log('[SW] Deleting old cache:', name);
          return caches.delete(name);
        });

      await Promise.all(deletePromises);

      // Enable navigation preload if supported
      if ('navigationPreload' in self.registration) {
        await self.registration.navigationPreload.enable();
        console.log('[SW] Navigation preload enabled');
      }

      // Claim all clients immediately
      await self.clients.claim();
      console.log('[SW] Activation complete');
    })()
  );
});

// ==================== CACHE UTILITIES ====================

// Check if URL should be cached from CDN
function isCDNUrl(url) {
  return CDN_CACHE_PATTERNS.some(pattern => pattern.test(url));
}

// Check if this is a navigation request
function isNavigationRequest(request) {
  return request.mode === 'navigate' ||
    (request.method === 'GET' && request.headers.get('accept')?.includes('text/html'));
}

// Check if request is for a static asset
function isStaticAsset(url) {
  return /\.(css|js|png|jpg|jpeg|gif|webp|svg|ico|woff2?|ttf|eot)$/i.test(url.pathname);
}

// Clean old cache entries (FIFO eviction)
async function cleanCache(cacheName, maxSize, maxAge) {
  try {
    const cache = await caches.open(cacheName);
    const keys = await cache.keys();

    // Remove entries older than maxAge
    if (maxAge) {
      const now = Date.now();
      for (const request of keys) {
        const response = await cache.match(request);
        if (response) {
          const dateHeader = response.headers.get('sw-cache-date');
          if (dateHeader && (now - parseInt(dateHeader)) > maxAge) {
            await cache.delete(request);
          }
        }
      }
    }

    // If still over limit, remove oldest entries (FIFO)
    const updatedKeys = await cache.keys();
    if (updatedKeys.length > maxSize) {
      const entriesToDelete = updatedKeys.length - maxSize;
      for (let i = 0; i < entriesToDelete; i++) {
        await cache.delete(updatedKeys[i]);
      }
      console.log(`[SW] Cleaned ${entriesToDelete} entries from ${cacheName}`);
    }
  } catch (err) {
    console.error(`[SW] Cache cleaning failed for ${cacheName}:`, err);
  }
}

// Add timestamp to response for expiration tracking
function addTimestamp(response) {
  const newHeaders = new Headers(response.headers);
  newHeaders.set('sw-cache-date', Date.now().toString());
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: newHeaders
  });
}

// ==================== CACHING STRATEGIES ====================

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
      await cache.put(request, addTimestamp(response.clone()));
    }
    return response;
  } catch (err) {
    console.error('[SW] Fetch failed:', request.url, err);
    throw err;
  }
}

// Strategy: Network First with Cache Fallback (for HTML pages)
async function networkFirst(request) {
  try {
    // Try network first
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(CACHE_NAME);
      await cache.put(request, addTimestamp(response.clone()));
    }
    return response;
  } catch (err) {
    console.log('[SW] Network failed, trying cache:', request.url);

    // Try cache
    const cached = await caches.match(request);
    if (cached) {
      return cached;
    }

    // Return offline page for navigation requests
    if (isNavigationRequest(request)) {
      const offlineCache = await caches.open(OFFLINE_CACHE);
      const offlinePage = await offlineCache.match('./offline.html');
      if (offlinePage) return offlinePage;

      // Fallback to cached index.html
      const indexPage = await caches.match('./index.html');
      if (indexPage) return indexPage;
    }

    throw err;
  }
}

// Strategy: Stale While Revalidate (for CDN resources)
async function staleWhileRevalidate(request) {
  const cache = await caches.open(RUNTIME_CACHE);
  const cached = await cache.match(request);

  // Return cached response immediately if available
  const fetchPromise = fetch(request)
    .then(async response => {
      if (response.ok) {
        await cache.put(request, addTimestamp(response.clone()));
        // Clean cache in background
        cleanCache(RUNTIME_CACHE, MAX_CACHE_SIZE.runtime, CACHE_EXPIRATION.runtime);
      }
      return response;
    })
    .catch(err => {
      console.log('[SW] CDN fetch failed:', request.url);
      return cached;
    });

  return cached || fetchPromise;
}

// Strategy: Network Only with Cache Update (for API calls)
async function networkOnly(request) {
  try {
    const response = await fetch(request);

    // Cache successful GET responses for offline support
    if (response.ok && request.method === 'GET') {
      const cache = await caches.open(RUNTIME_CACHE);
      await cache.put(request, addTimestamp(response.clone()));
    }

    return response;
  } catch (err) {
    // For API calls, try to return cached version if available
    const cached = await caches.match(request);
    if (cached) {
      console.log('[SW] Using cached API response:', request.url);
      return cached;
    }
    throw err;
  }
}

// ==================== MAIN FETCH HANDLER ====================
self.addEventListener('fetch', (e) => {
  try {
    const url = new URL(e.request.url);

    // Skip non-GET requests (except POST for background sync)
    if (e.request.method !== 'GET' && e.request.method !== 'POST') {
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

    // Handle navigation preload
    if (e.preloadResponse) {
      e.respondWith(
        (async () => {
          try {
            const response = await e.preloadResponse;
            if (response) {
              const cache = await caches.open(CACHE_NAME);
              await cache.put(e.request, addTimestamp(response.clone()));
              return response;
            }
          } catch (err) {
            console.log('[SW] Preload failed:', err);
          }

          // Fall through to normal strategies
          return handleRequest(e.request);
        })()
      );
      return;
    }

    e.respondWith(handleRequest(e.request));
  } catch (err) {
    console.error('[SW] Fetch handler error:', err);
  }
});

// Central request handler
async function handleRequest(request) {
  const url = new URL(request.url);

  // Navigation requests (HTML pages) - Network First
  if (isNavigationRequest(request)) {
    return networkFirst(request);
  }

  // Local app files
  if (url.origin === location.origin) {
    // app.js uses network-first to get updates quickly
    if (url.pathname.endsWith('app.js')) {
      return networkFirst(request);
    }

    // CSS files - Cache first for performance
    if (url.pathname.endsWith('.css')) {
      return cacheFirst(request);
    }

    // Other local files (manifest, icons) use cache-first for speed
    return cacheFirst(request);
  }

  // CDN resources - Stale While Revalidate
  if (isCDNUrl(url.href)) {
    return staleWhileRevalidate(request);
  }

  // External requests - Network First with cache fallback
  return networkFirst(request);
}

// ==================== BACKGROUND SYNC ====================
self.addEventListener('sync', (e) => {
  console.log('[SW] Background sync:', e.tag);

  if (e.tag === 'sync-smoking-data') {
    e.waitUntil(syncSmokingData());
  }
});

async function syncSmokingData() {
  try {
    // Get pending sync data from IndexedDB
    const pendingData = await getPendingSyncData();

    if (pendingData.length > 0) {
      console.log(`[SW] Syncing ${pendingData.length} pending items`);

      // Sync each item (placeholder - implement actual sync logic)
      for (const item of pendingData) {
        try {
          // await fetch('/api/sync', {
          //   method: 'POST',
          //   body: JSON.stringify(item),
          //   headers: { 'Content-Type': 'application/json' }
          // });
          console.log('[SW] Synced item:', item.id);
        } catch (err) {
          console.error('[SW] Failed to sync item:', item.id, err);
        }
      }
    }
  } catch (err) {
    console.error('[SW] Background sync failed:', err);
  }
}

// Placeholder for IndexedDB operations
async function getPendingSyncData() {
  // Implement actual IndexedDB retrieval
  return [];
}

// ==================== MESSAGE HANDLER ====================
self.addEventListener('message', (e) => {
  const { type, payload } = e.data || {};

  switch (type) {
    case 'SKIP_WAITING':
      self.skipWaiting();
      break;

    case 'GET_CACHE_STATUS':
      handleGetCacheStatus(e);
      break;

    case 'CLEAR_CACHES':
      handleClearCaches(e);
      break;

    case 'CLEAR_RUNTIME_CACHE':
      handleClearRuntimeCache(e);
      break;

    case 'UPDATE_CACHE':
      handleUpdateCache(e, payload);
      break;

    default:
      console.log('[SW] Unknown message type:', type);
  }
});

async function handleGetCacheStatus(e) {
  try {
    const cacheNames = await caches.keys();
    const hasPrecache = cacheNames.includes(CACHE_NAME);
    const hasRuntimeCache = cacheNames.includes(RUNTIME_CACHE);
    const hasOfflineCache = cacheNames.includes(OFFLINE_CACHE);

    // Get cache sizes
    const cacheSizes = {};
    for (const name of cacheNames) {
      const cache = await caches.open(name);
      const keys = await cache.keys();
      cacheSizes[name] = keys.length;
    }

    const status = {
      version: CACHE_VERSION,
      caches: cacheNames,
      ready: hasPrecache && hasRuntimeCache,
      sizes: cacheSizes,
      hasOfflinePage: hasOfflineCache
    };

    if (e.ports && e.ports[0]) {
      e.ports[0].postMessage(status);
    }
  } catch (err) {
    console.error('[SW] Error getting cache status:', err);
  }
}

async function handleClearCaches(e) {
  try {
    const cacheNames = await caches.keys();
    const deletePromises = cacheNames.map(name => {
      console.log('[SW] Clearing cache:', name);
      return caches.delete(name);
    });

    await Promise.all(deletePromises);
    console.log('[SW] All caches cleared');

    // Recreate precache
    self.dispatchEvent(new Event('install'));
  } catch (err) {
    console.error('[SW] Error clearing caches:', err);
  }
}

async function handleClearRuntimeCache(e) {
  try {
    await caches.delete(RUNTIME_CACHE);
    console.log('[SW] Runtime cache cleared');
  } catch (err) {
    console.error('[SW] Error clearing runtime cache:', err);
  }
}

async function handleUpdateCache(e, payload) {
  if (!payload || !payload.url) {
    console.error('[SW] Invalid update cache payload');
    return;
  }

  try {
    const response = await fetch(payload.url);
    if (response.ok) {
      const cache = await caches.open(CACHE_NAME);
      await cache.put(payload.url, addTimestamp(response.clone()));
      console.log('[SW] Updated cache for:', payload.url);
    }
  } catch (err) {
    console.error('[SW] Error updating cache:', err);
  }
}

// ==================== ERROR HANDLING ====================
self.addEventListener('error', (e) => {
  console.error('[SW] Error:', e.error);
});

self.addEventListener('unhandledrejection', (e) => {
  console.error('[SW] Unhandled rejection:', e.reason);
});

// ==================== PERIODIC CACHE CLEANUP ====================
// Run cleanup periodically
let lastCleanup = Date.now();
const CLEANUP_INTERVAL = 60 * 60 * 1000; // 1 hour

async function periodicCleanup() {
  const now = Date.now();
  if (now - lastCleanup > CLEANUP_INTERVAL) {
    console.log('[SW] Running periodic cache cleanup');
    await cleanCache(RUNTIME_CACHE, MAX_CACHE_SIZE.runtime, CACHE_EXPIRATION.runtime);
    lastCleanup = now;
  }
}

// Check for cleanup on each fetch
self.addEventListener('fetch', () => {
  periodicCleanup();
});

console.log('[SW] Service Worker v' + CACHE_VERSION + ' loaded');
