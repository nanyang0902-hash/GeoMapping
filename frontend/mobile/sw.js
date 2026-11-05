/**
 * Service Worker - 离线缓存与PWA支持 (增强版)
 * 支持多底图离线缓存、API数据缓存、离线回退
 */
const CACHE_NAME = 'geo-mapping-v2.0.0';
const TILE_CACHE = 'map-tiles-v2';
const API_CACHE = 'api-cache-v1';

const CACHE_URLS = [
    '/mobile/',
    '/mobile/index.html',
    '/mobile/css/style.css',
    '/mobile/css/leaflet.css',
    '/mobile/js/app.js',
    '/mobile/js/gps.js',
    '/mobile/js/storage.js',
    '/mobile/js/capacitor-adapter.js',
    '/mobile/manifest.json',
    '/desktop/js/api.js',
    // Leaflet CDN 回退
    'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css',
    'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js',
];

// 地图瓦片域名白名单
const TILE_DOMAINS = [
    'tile.openstreetmap.org',
    'tile.opentopomap.org',
    'server.arcgisonline.com',
    'webrd0.is.autonavi.com',
    'webrd1.is.autonavi.com',
    'webrd2.is.autonavi.com',
    'webrd3.is.autonavi.com',
    'webst0.is.autonavi.com',
    'webst1.is.autonavi.com',
    'webst2.is.autonavi.com',
    'webst3.is.autonavi.com',
    'services.arcgisonline.com',
];

// 安装 - 预缓存核心资源
self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME).then((cache) => {
            console.log('[SW] 预缓存核心资源...');
            return cache.addAll(CACHE_URLS).catch(err => {
                console.warn('[SW] 部分资源缓存失败:', err);
            });
        }).then(() => self.skipWaiting())
    );
});

// 激活 - 清理旧缓存
self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys().then((names) => {
            return Promise.all(
                names.filter(n => ![CACHE_NAME, TILE_CACHE, API_CACHE].includes(n))
                    .map(n => caches.delete(n))
            );
        }).then(() => self.clients.claim())
    );
});

// 请求拦截 - 智能缓存策略
self.addEventListener('fetch', (event) => {
    const url = new URL(event.request.url);

    // 跳过非 GET 请求
    if (event.request.method !== 'GET') return;

    // 1. API 请求 - Network First, 缓存备用 (5分钟过期)
    if (url.pathname.startsWith('/api/')) {
        event.respondWith(
            fetch(event.request).then((response) => {
                if (response.ok) {
                    const clone = response.clone();
                    caches.open(API_CACHE).then((cache) => {
                        cache.put(event.request, clone);
                    });
                }
                return response;
            }).catch(() => {
                return caches.match(event.request).then((cached) => {
                    if (cached) return cached;
                    return new Response(JSON.stringify({ error: '离线模式，API暂不可用' }), {
                        status: 503,
                        headers: { 'Content-Type': 'application/json' }
                    });
                });
            })
        );
        return;
    }

    // 2. 地图瓦片 - Cache First + 后台更新
    if (isTileRequest(url)) {
        event.respondWith(
            caches.match(event.request).then((cached) => {
                // 后台更新缓存（即使缓存命中也尝试更新）
                fetch(event.request).then((response) => {
                    if (response.ok) {
                        caches.open(TILE_CACHE).then((cache) => {
                            cache.put(event.request, response.clone());
                        });
                    }
                }).catch(() => {});

                // 返回缓存或网络结果
                if (cached) return cached;
                return fetch(event.request).then((response) => {
                    if (response.ok) {
                        const clone = response.clone();
                        caches.open(TILE_CACHE).then((cache) => {
                            cache.put(event.request, clone);
                        });
                    }
                    return response;
                }).catch(() => {
                    // 返回透明占位图
                    return new Response(createTransparentTile(), {
                        headers: { 'Content-Type': 'image/png' }
                    });
                });
            })
        );
        return;
    }

    // 3. 静态资源 - Stale While Revalidate
    event.respondWith(
        caches.match(event.request).then((cached) => {
            const fetchPromise = fetch(event.request).then((response) => {
                if (response.ok) {
                    const clone = response.clone();
                    caches.open(CACHE_NAME).then((cache) => {
                        cache.put(event.request, clone);
                    });
                }
                return response;
            }).catch(() => cached);

            return cached || fetchPromise;
        })
    );
});

// 判断是否为瓦片请求
function isTileRequest(url) {
    return TILE_DOMAINS.some(domain => url.hostname.includes(domain));
}

// 生成透明 1x1 PNG (离线占位)
function createTransparentTile() {
    const transparentPng = Uint8Array.from([
        0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0x00, 0x00, 0x00, 0x0D,
        0x49, 0x48, 0x44, 0x52, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
        0x08, 0x06, 0x00, 0x00, 0x00, 0x1F, 0x15, 0xC4, 0x89, 0x00, 0x00, 0x00,
        0x0A, 0x49, 0x44, 0x41, 0x54, 0x78, 0x9C, 0x63, 0x00, 0x01, 0x00, 0x00,
        0x05, 0x00, 0x01, 0x0D, 0x0A, 0x2D, 0xB4, 0x00, 0x00, 0x00, 0x00, 0x49,
        0x45, 0x4E, 0x44, 0xAE, 0x42, 0x60, 0x82
    ]);
    return transparentPng;
}

// 后台同步 - 用于数据同步
self.addEventListener('sync', (event) => {
    if (event.tag === 'sync-geodata') {
        event.waitUntil(
            self.clients.matchAll().then((clients) => {
                clients.forEach((client) => {
                    client.postMessage({ type: 'REQUEST_SYNC' });
                });
            })
        );
    }
});
