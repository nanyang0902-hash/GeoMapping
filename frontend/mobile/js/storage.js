/**
 * 本地存储模块 - IndexedDB封装，离线数据管理
 * Local Storage Module - Offline data persistence using IndexedDB
 */
const Storage = {
    db: null,
    DB_NAME: 'GeoMappingDB',
    DB_VERSION: 1,

    async init() {
        return new Promise((resolve, reject) => {
            const request = indexedDB.open(this.DB_NAME, this.DB_VERSION);

            request.onupgradeneeded = (e) => {
                const db = e.target.result;

                // 地质点存储
                if (!db.objectStoreNames.contains('points')) {
                    const pointsStore = db.createObjectStore('points', { keyPath: 'id', autoIncrement: true });
                    pointsStore.createIndex('project_id', 'project_id', { unique: false });
                    pointsStore.createIndex('point_type', 'point_type', { unique: false });
                    pointsStore.createIndex('synced', 'synced', { unique: false });
                }

                // 路线存储
                if (!db.objectStoreNames.contains('routes')) {
                    const routesStore = db.createObjectStore('routes', { keyPath: 'id' });
                    routesStore.createIndex('synced', 'synced', { unique: false });
                }

                // 照片存储
                if (!db.objectStoreNames.contains('photos')) {
                    const photosStore = db.createObjectStore('photos', { keyPath: 'id', autoIncrement: true });
                    photosStore.createIndex('point_id', 'point_id', { unique: false });
                }

                // 设置存储
                if (!db.objectStoreNames.contains('settings')) {
                    db.createObjectStore('settings', { keyPath: 'key' });
                }

                // 离线地图瓦片
                if (!db.objectStoreNames.contains('tiles')) {
                    db.createObjectStore('tiles', { keyPath: 'url' });
                }
            };

            request.onsuccess = (e) => {
                this.db = e.target.result;
                console.log('[Storage] IndexedDB 初始化完成');
                resolve();
            };

            request.onerror = (e) => {
                console.error('[Storage] IndexedDB 初始化失败:', e.target.error);
                reject(e.target.error);
            };
        });
    },

    // ===== 地质点操作 =====
    async savePoint(pointData) {
        const data = {
            ...pointData,
            synced: false,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
        };

        return new Promise((resolve, reject) => {
            const tx = this.db.transaction('points', 'readwrite');
            const store = tx.objectStore('points');
            const request = store.add(data);
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
    },

    async getPoints(projectId = null, type = null) {
        return new Promise((resolve, reject) => {
            const tx = this.db.transaction('points', 'readonly');
            const store = tx.objectStore('points');
            const request = store.getAll();

            request.onsuccess = () => {
                let points = request.result;

                if (projectId) {
                    points = points.filter(p => p.project_id == projectId);
                }
                if (type) {
                    points = points.filter(p => p.point_type === type);
                }

                // 按时间倒序
                points.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
                resolve(points);
            };
            request.onerror = () => reject(request.error);
        });
    },

    async updatePoint(id, data) {
        return new Promise((resolve, reject) => {
            const tx = this.db.transaction('points', 'readwrite');
            const store = tx.objectStore('points');
            const getReq = store.get(id);

            getReq.onsuccess = () => {
                const existing = getReq.result;
                if (!existing) {
                    reject(new Error('点不存在'));
                    return;
                }
                const updated = { ...existing, ...data, updated_at: new Date().toISOString(), synced: false };
                store.put(updated);
                resolve();
            };
            getReq.onerror = () => reject(getReq.error);
        });
    },

    async deletePoint(id) {
        return new Promise((resolve, reject) => {
            const tx = this.db.transaction('points', 'readwrite');
            const store = tx.objectStore('points');
            const request = store.delete(id);
            request.onsuccess = () => resolve();
            request.onerror = () => reject(request.error);
        });
    },

    async getUnsyncedPoints() {
        return new Promise((resolve, reject) => {
            const tx = this.db.transaction('points', 'readonly');
            const store = tx.objectStore('points');
            const index = store.index('synced');
            const request = index.getAll(0);  // synced = false (0)

            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
    },

    async markSynced(ids) {
        const tx = this.db.transaction('points', 'readwrite');
        const store = tx.objectStore('points');

        for (const id of ids) {
            const getReq = store.get(id);
            getReq.onsuccess = () => {
                const data = getReq.result;
                if (data) {
                    data.synced = true;
                    store.put(data);
                }
            };
        }

        return new Promise((resolve) => {
            tx.oncomplete = () => resolve();
        });
    },

    // ===== 路线操作 =====
    async saveLocalRoute(route) {
        return new Promise((resolve, reject) => {
            const tx = this.db.transaction('routes', 'readwrite');
            const store = tx.objectStore('routes');
            const data = { ...route, synced: false };
            const request = store.put(data);
            request.onsuccess = () => resolve();
            request.onerror = () => reject(request.error);
        });
    },

    async getLocalRoutes() {
        return new Promise((resolve, reject) => {
            const tx = this.db.transaction('routes', 'readonly');
            const store = tx.objectStore('routes');
            const request = store.getAll();
            request.onsuccess = () => {
                const routes = request.result;
                routes.sort((a, b) => new Date(b.start_time) - new Date(a.start_time));
                resolve(routes);
            };
            request.onerror = () => reject(request.error);
        });
    },

    // ===== 照片存储 =====
    async savePhoto(photoData) {
        return new Promise((resolve, reject) => {
            const tx = this.db.transaction('photos', 'readwrite');
            const store = tx.objectStore('photos');
            const request = store.add({
                ...photoData,
                created_at: new Date().toISOString(),
            });
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
    },

    // ===== 设置操作 =====
    async saveSetting(key, value) {
        return new Promise((resolve, reject) => {
            const tx = this.db.transaction('settings', 'readwrite');
            const store = tx.objectStore('settings');
            store.put({ key, value });
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error);
        });
    },

    async getSetting(key, defaultValue = null) {
        return new Promise((resolve, reject) => {
            const tx = this.db.transaction('settings', 'readonly');
            const store = tx.objectStore('settings');
            const request = store.get(key);
            request.onsuccess = () => {
                resolve(request.result ? request.result.value : defaultValue);
            };
            request.onerror = () => reject(request.error);
        });
    },

    // ===== 离线地图瓦片 =====
    async cacheTile(url, blob) {
        return new Promise((resolve, reject) => {
            const tx = this.db.transaction('tiles', 'readwrite');
            const store = tx.objectStore('tiles');
            store.put({ url, data: blob, cached_at: Date.now() });
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error);
        });
    },

    async getCachedTile(url) {
        return new Promise((resolve, reject) => {
            const tx = this.db.transaction('tiles', 'readonly');
            const store = tx.objectStore('tiles');
            const request = store.get(url);
            request.onsuccess = () => resolve(request.result ? request.result.data : null);
            request.onerror = () => reject(request.error);
        });
    },

    // ===== 数据导出 =====
    async exportAllData() {
        const [points, routes] = await Promise.all([
            this.getPoints(),
            this.getLocalRoutes(),
        ]);

        return {
            export_time: new Date().toISOString(),
            version: '1.0.0',
            app: '地质填图系统-移动端',
            data: {
                points,
                routes,
            }
        };
    },

    // 获取存储统计
    async getStats() {
        const [points, routes] = await Promise.all([
            this.getPoints(),
            this.getLocalRoutes(),
        ]);

        return {
            points_total: points.length,
            points_synced: points.filter(p => p.synced).length,
            points_unsynced: points.filter(p => !p.synced).length,
            routes_total: routes.length,
        };
    },
};
