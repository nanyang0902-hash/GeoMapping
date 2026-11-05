/**
 * API 通信模块 - 封装所有后端接口调用
 */
const API_BASE = '/api';

const api = {
    async request(method, url, data = null) {
        const options = {
            method,
            headers: { 'Content-Type': 'application/json' },
        };
        if (data) options.body = JSON.stringify(data);

        try {
            const res = await fetch(API_BASE + url, options);
            if (!res.ok) {
                const err = await res.json();
                throw new Error(err.error || `HTTP ${res.status}`);
            }
            return await res.json();
        } catch (e) {
            if (e.message.includes('Failed to fetch')) {
                throw new Error('无法连接到服务器，请检查后端是否启动');
            }
            throw e;
        }
    },

    // === 项目管理 ===
    projects: {
        list: () => api.request('GET', '/projects/'),
        get: (id) => api.request('GET', `/projects/${id}`),
        create: (data) => api.request('POST', '/projects/', data),
        update: (id, data) => api.request('PUT', `/projects/${id}`, data),
        delete: (id) => api.request('DELETE', `/projects/${id}`),
        overview: (id) => api.request('GET', `/projects/${id}/overview`),
    },

    // === 路线管理 ===
    routes: {
        list: (projectId) => api.request('GET', `/routes/project/${projectId}`),
        get: (id) => api.request('GET', `/routes/${id}`),
        create: (data) => api.request('POST', '/routes/', data),
        update: (id, data) => api.request('PUT', `/routes/${id}`, data),
        delete: (id) => api.request('DELETE', `/routes/${id}`),
        addTrackpoints: (routeId, points) => api.request('POST', `/routes/${routeId}/trackpoints`, { points }),
        getTrackpoints: (routeId) => api.request('GET', `/routes/${routeId}/trackpoints`),
        getLog: (routeId) => api.request('GET', `/routes/${routeId}/log`),
    },

    // === 地质点管理 ===
    points: {
        list: (projectId, params = {}) => {
            const qs = new URLSearchParams(params).toString();
            return api.request('GET', `/points/project/${projectId}${qs ? '?' + qs : ''}`);
        },
        get: (id) => api.request('GET', `/points/${id}`),
        create: (data) => api.request('POST', '/points/', data),
        update: (id, data) => api.request('PUT', `/points/${id}`, data),
        delete: (id) => api.request('DELETE', `/points/${id}`),
        check: (id, checked) => api.request('POST', `/points/${id}/check`, { is_checked: checked ? 1 : 0 }),
        batchUpdate: (ids, updates) => api.request('POST', '/points/batch', { ids, updates }),
        nextNumber: (projectId, prefix) => {
            const qs = new URLSearchParams({ project_id: projectId, prefix }).toString();
            return api.request('GET', `/points/next-number?${qs}`);
        },
    },

    // === 照片管理 ===
    photos: {
        list: (projectId, params = {}) => {
            const qs = new URLSearchParams(params).toString();
            return api.request('GET', `/photos/project/${projectId}${qs ? '?' + qs : ''}`);
        },
        upload: (formData) => {
            return fetch(API_BASE + '/photos/upload', {
                method: 'POST',
                body: formData,
            }).then(r => r.json());
        },
        delete: (id) => api.request('DELETE', `/photos/${id}`),
        fileUrl: (id) => API_BASE + `/photos/${id}/file`,
    },

    // === 样品管理 ===
    samples: {
        list: (projectId) => api.request('GET', `/samples/project/${projectId}`),
        create: (data) => api.request('POST', '/samples/', data),
        update: (id, data) => api.request('PUT', `/samples/${id}`, data),
        delete: (id) => api.request('DELETE', `/samples/${id}`),
        exportData: (projectId) => api.request('GET', `/samples/export?project_id=${projectId}`),
    },

    // === 界线管理 ===
    boundaries: {
        list: (projectId) => api.request('GET', `/boundaries/project/${projectId}`),
        get: (id) => api.request('GET', `/boundaries/${id}`),
        create: (data) => api.request('POST', '/boundaries/', data),
        update: (id, data) => api.request('PUT', `/boundaries/${id}`, data),
        delete: (id) => api.request('DELETE', `/boundaries/${id}`),
        topologyCheck: (projectId) => api.request('GET', `/boundaries/project/${projectId}/topology-check`),
    },

    // === 断层管理 ===
    faults: {
        list: (projectId) => api.request('GET', `/faults/project/${projectId}`),
        get: (id) => api.request('GET', `/faults/${id}`),
        create: (data) => api.request('POST', '/faults/', data),
        update: (id, data) => api.request('PUT', `/faults/${id}`, data),
        delete: (id) => api.request('DELETE', `/faults/${id}`),
    },

    // === 地层面管理 ===
    areas: {
        list: (projectId) => api.request('GET', `/areas/project/${projectId}`),
        get: (id) => api.request('GET', `/areas/${id}`),
        create: (data) => api.request('POST', '/areas/', data),
        update: (id, data) => api.request('PUT', `/areas/${id}`, data),
        delete: (id) => api.request('DELETE', `/areas/${id}`),
        topologyCheck: (projectId) => api.request('GET', `/areas/project/${projectId}/topology-check`),
    },

    // === 导航 ===
    navigation: {
        route: (origin, destination, mode) => api.request('POST', '/navigation/route', { origin, destination, mode }),
    },

    // === 同步 ===
    sync: {
        import: (data) => api.request('POST', '/sync/import', data),
        importFiles: (formData) => fetch(API_BASE + '/sync/import', { method: 'POST', body: formData }).then(r => {
            if (!r.ok) return r.json().then(e => { throw new Error(e.error || 'HTTP ' + r.status); });
            return r.json();
        }),
        importPreview: (formData) => {
            formData.append('preview', '1');
            return fetch(API_BASE + '/sync/import', { method: 'POST', body: formData }).then(r => {
                if (!r.ok) return r.json().then(e => { throw new Error(e.error || 'HTTP ' + r.status); });
                return r.json();
            });
        },
        export: (projectId) => api.request('GET', `/sync/export/${projectId}`),
        status: (projectId) => api.request('GET', `/sync/status/${projectId}`),
        checkData: (projectId) => api.request('GET', `/sync/check-data/${projectId}`),
    },

    // === 导出 ===
    export: {
        geojson: (projectId, type) => api.request('GET', `/export/geojson/${projectId}?type=${type || 'all'}`),
        csvUrl: (projectId) => API_BASE + `/export/csv/${projectId}`,
        kmlUrl: (projectId) => API_BASE + `/export/kml/${projectId}`,
        shpUrl: (projectId) => API_BASE + `/export/shapefile/${projectId}`,
    },

    // === 符号库 ===
    symbols: {
        list: (params = {}) => {
            const qs = new URLSearchParams(params).toString();
            return api.request('GET', `/symbols/${qs ? '?' + qs : ''}`);
        },
        init: () => api.request('POST', '/symbols/init'),
        create: (data) => api.request('POST', '/symbols/', data),
    },

    // === 地层单元管理 ===
    strata: {
        list: (projectId) => api.request('GET', `/strata/project/${projectId}`),
        get: (id) => api.request('GET', `/strata/${id}`),
        create: (data) => api.request('POST', '/strata/', data),
        update: (id, data) => api.request('PUT', `/strata/${id}`, data),
        delete: (id) => api.request('DELETE', `/strata/${id}`),
        summary: (projectId) => api.request('GET', `/strata/project/${projectId}/summary`),
    },

    // === 配置 ===
    config: {
        get: () => api.request('GET', '/config'),
    },

    // === 健康检查 ===
    health: () => api.request('GET', '/health'),
};
