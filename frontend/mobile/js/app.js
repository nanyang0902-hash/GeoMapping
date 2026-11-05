/**
 * 移动端主应用控制器
 * Mobile Application Main Controller
 */
const MobileApp = {
    map: null,
    baseMapLayer: null,
    currentLocationMarker: null,
    locationCircle: null,
    trackLayer: null,
    pointsLayer: null,
    routeLayer: null,
    currentProjectId: null,
    activePanel: null,

    isDesktopPreview: false,

    async init() {
        // 检测桌面端预览模式
        this.isDesktopPreview = !!(window.__DESKTOP_PREVIEW__);

        // 初始化存储
        await Storage.init();

        // 初始化地图
        this.initMap();

        // 初始化GPS（桌面预览模式跳过真实GPS）
        if (!this.isDesktopPreview && GPS.init()) {
            GPS.startWatching();
        }

        // 加载设置
        await this.loadSettings();

        // 加载项目列表
        await this.loadProjects();

        // 加载本地数据到地图
        await this.loadLocalDataToMap();

        // 更新路线回放列表
        await this.updateRouteList();

        // 绑定事件
        this.bindEvents();

        // 桌面预览：显示模拟GPS栏
        if (this.isDesktopPreview) {
            this._showMockGpsBar();
        }

        // 注册Service Worker
        if ('serviceWorker' in navigator) {
            navigator.serviceWorker.register('/mobile/sw.js').catch(() => {});
        }

        console.log('📱 地质填图移动端初始化完成' + (this.isDesktopPreview ? ' (桌面预览)' : ''));
    },

    _showMockGpsBar: function() {
        var bar = document.getElementById('mockGpsBar');
        if (bar) bar.style.display = 'flex';
    },

    setMockGps: function() {
        var latEl = document.getElementById('mockLat');
        var lngEl = document.getElementById('mockLng');
        if (!latEl || !lngEl) return;

        var lat = parseFloat(latEl.value);
        var lng = parseFloat(lngEl.value);
        if (isNaN(lat) || isNaN(lng)) {
            this.showToast('请输入有效的经纬度');
            return;
        }

        // 模拟定位
        this.currentLocation = { lat: lat, lng: lng, accuracy: 5, elevation: null };
        this._updateMockLocationMarker();

        // 填充采集表单坐标
        var cfLat = document.getElementById('cfLat');
        var cfLng = document.getElementById('cfLng');
        var cfElev = document.getElementById('cfElevation');
        var cfAcc = document.getElementById('cfAccuracy');
        if (cfLat) cfLat.value = lat.toFixed(6);
        if (cfLng) cfLng.value = lng.toFixed(6);
        if (cfElev) cfElev.value = '--';
        if (cfAcc) cfAcc.value = '5 m (模拟)';

        // 飞到模拟位置
        this.map.setView([lat, lng], 15);
        this.showToast('已模拟定位: ' + lat.toFixed(5) + ', ' + lng.toFixed(5));
    },

    _updateMockLocationMarker: function() {
        if (!this.currentLocation) return;
        var p = this.currentLocation;
        if (this.currentLocationMarker) {
            this.map.removeLayer(this.currentLocationMarker);
            if (this.locationCircle) this.map.removeLayer(this.locationCircle);
        }
        this.currentLocationMarker = L.circleMarker([p.lat, p.lng], {
            radius: 10, fillColor: '#007aff', color: '#fff', weight: 3, fillOpacity: 0.9, zIndexOffset: 9999
        }).addTo(this.map);
        this.locationCircle = L.circle([p.lat, p.lng], {
            radius: p.accuracy || 5, color: '#007aff', fillColor: '#007aff', fillOpacity: 0.08, weight: 1.5
        }).addTo(this.map);

        // 同步位置卡片
        this._updateLocationCard({
            latitude: p.lat, longitude: p.lng,
            elevation: p.elevation || null, accuracy: p.accuracy || null
        });
    },

    showToast: function(msg) {
        var el = document.getElementById('toast');
        if (!el) return;
        el.textContent = msg;
        el.style.display = 'block';
        el.style.opacity = '1';
        clearTimeout(this._toastTimer);
        this._toastTimer = setTimeout(function() {
            el.style.opacity = '0';
            setTimeout(function() { el.style.display = 'none'; }, 300);
        }, 2000);
    },

    initMap() {
        this.map = L.map('mobileMap', {
            center: [35.0, 105.0],
            zoom: 5,
            zoomControl: false,
            attributionControl: false,
        });

        // 注册底图（对齐桌面端 BASE_MAPS + DEM_LAYERS）
        this._registerBaseMaps();
        // 默认高德街道图
        this._setDefaultBaseMap();

        this.trackLayer = L.featureGroup().addTo(this.map);
        this.pointsLayer = L.featureGroup().addTo(this.map);
        this.routeLayer = L.featureGroup().addTo(this.map);

        L.control.zoom({ position: 'topright' }).addTo(this.map);
    },

    /// 对齐桌面端 MapModule.BASE_MAPS
    _registerBaseMaps() {
        this.baseMaps = {};

        // 高德街道图
        this.baseMaps['amap'] = L.tileLayer(
            'https://webrd0{s}.is.autonavi.com/appmaptile?lang=zh_cn&size=1&scale=1&style=8&x={x}&y={y}&z={z}',
            { subdomains: '1234', maxZoom: 18, attribution: '&copy; 高德地图', crossOrigin: 'anonymous' }
        );

        // 高德卫星+路网 双层叠加（对齐桌面 amap_sat layerGroup）
        var sat = L.tileLayer(
            'https://webst0{s}.is.autonavi.com/appmaptile?style=6&x={x}&y={y}&z={z}',
            { subdomains: '1234', maxZoom: 18, crossOrigin: 'anonymous' }
        );
        var road = L.tileLayer(
            'https://wprd0{s}.is.autonavi.com/appmaptile?lang=zh_cn&size=1&scl=1&style=8&x={x}&y={y}&z={z}',
            { subdomains: '1234', maxZoom: 18, crossOrigin: 'anonymous' }
        );
        this.baseMaps['amap_sat'] = L.layerGroup([sat, road]);

        // Esri 卫星影像
        this.baseMaps['esri_sat'] = L.tileLayer(
            'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
            { maxZoom: 19, attribution: '&copy; Esri', crossOrigin: 'anonymous' }
        );

        // Esri 地形图
        this.baseMaps['esri_topo'] = L.tileLayer(
            'https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/{z}/{y}/{x}',
            { maxZoom: 19, attribution: '&copy; Esri', crossOrigin: 'anonymous' }
        );

        // DEM 山体阴影覆盖层（独立，不替换底图）
        this._demLayer = null;
    },

    _setDefaultBaseMap() {
        var key = 'amap';
        this.baseMaps[key].addTo(this.map);
        this._currentBaseMap = key;
        this.baseMapLayer = this.baseMaps[key];  // 兼容旧引用
        // 同步下拉菜单
        var sel = document.getElementById('mobileBaseMap');
        if (sel) sel.value = key;
    },

    switchBaseMap(type) {
        if (!this.baseMaps || !this.baseMaps[type]) return;
        // 移除旧底图
        if (this._currentBaseMap && this.baseMaps[this._currentBaseMap]) {
            this.map.removeLayer(this.baseMaps[this._currentBaseMap]);
        }
        // 叠加新底图
        this.baseMaps[type].addTo(this.map);
        this._currentBaseMap = type;
        this.baseMapLayer = this.baseMaps[type];  // 兼容旧引用
        // DEM 若已开启，保持在最上层
        if (this._demLayer && this.map.hasLayer(this._demLayer)) {
            this.map.removeLayer(this._demLayer);
            this._demLayer.addTo(this.map);
        }
    },

    toggleDEM(visible) {
        if (!this._demLayer) {
            this._demLayer = L.tileLayer(
                'https://server.arcgisonline.com/ArcGIS/rest/services/World_Shaded_Relief/MapServer/tile/{z}/{y}/{x}',
                { maxZoom: 16, opacity: 0.45, attribution: '&copy; Esri Hillshade', crossOrigin: 'anonymous' }
            );
        }
        if (visible) {
            if (!this.map.hasLayer(this._demLayer)) this._demLayer.addTo(this.map);
        } else {
            if (this.map.hasLayer(this._demLayer)) this.map.removeLayer(this._demLayer);
        }
    },

    bindEvents() {
        // 底部导航
        document.querySelectorAll('.footer-btn[data-page]').forEach(btn => {
            btn.addEventListener('click', () => {
                if (btn.dataset.action === 'navigate') {
                    MobileNav.open();
                } else {
                    this.switchPage(btn.dataset.page);
                }
            });
        });

        // 轨迹记录按钮
        document.getElementById('btnRecord').addEventListener('click', () => {
            if (GPS.isTracking) {
                GPS.stopRecording();
            } else {
                GPS.startRecording();
            }
        });

        // 菜单按钮
        document.getElementById('btnMenu').addEventListener('click', () => this.openSideMenu());
        document.getElementById('btnLayers').addEventListener('click', () => this.openLayerPanel());
        document.getElementById('btnSync').addEventListener('click', () => this.syncData());

        // 照片预览
        document.getElementById('cfPhoto').addEventListener('change', (e) => {
            const preview = document.getElementById('cfPhotoPreview');
            preview.innerHTML = '';
            Array.from(e.target.files).forEach(file => {
                const reader = new FileReader();
                reader.onload = (ev) => {
                    const img = document.createElement('img');
                    img.src = ev.target.result;
                    preview.appendChild(img);
                };
                reader.readAsDataURL(file);
            });
        });

        // 点类型切换时自动更新表单
        document.getElementById('cfPointType').addEventListener('change', () => {
            this.updateCollectForm();
        });

        // 点击地图采集点
        this.map.on('contextmenu', (e) => {
            this.openCollectPanel(e.latlng);
        });
    },

    switchPage(page) {
        // 更新底部按钮激活状态
        document.querySelectorAll('.footer-btn').forEach(b => b.classList.remove('active'));
        document.querySelector(`[data-page="${page}"]`)?.classList.add('active');

        // 关闭所有面板
        this.closeAllPanels();

        switch(page) {
            case 'map':
                break;
            case 'collect':
                this.openCollectPanel();
                break;
            case 'data':
                this.openDataPanel();
                break;
            case 'settings':
                this.openSettingsPanel();
                break;
        }
    },

    // ===== 面板管理 =====
    _showOverlay() {
        var ov = document.getElementById('panelOverlay');
        if (ov) ov.classList.add('active');
    },
    _hideOverlay() {
        var ov = document.getElementById('panelOverlay');
        if (ov) ov.classList.remove('active');
    },

    openSideMenu() {
        this.closeAllPanels();
        document.getElementById('sideMenu').classList.add('open');
        this._showOverlay();
        this.activePanel = 'sideMenu';
    },

    closeSideMenu() {
        document.getElementById('sideMenu').classList.remove('open');
        this._hideOverlay();
        this.activePanel = null;
    },

    openLayerPanel() {
        this.closeAllPanels();
        document.getElementById('layerPanel').classList.add('open');
        this._showOverlay();
        this.activePanel = 'layerPanel';
    },

    closeLayerPanel() {
        document.getElementById('layerPanel').classList.remove('open');
        this._hideOverlay();
        this.activePanel = null;
    },

    openCollectPanel(latlng) {
        this.closeAllPanels();
        document.getElementById('collectPanel').classList.add('open');
        this._showOverlay();
        this.activePanel = 'collectPanel';

        // 自动填充GPS信息
        const gps = GPS.getCurrentInfo();
        if (gps) {
            document.getElementById('cfLat').value = gps.latitude.toFixed(6);
            document.getElementById('cfLng').value = gps.longitude.toFixed(6);
            document.getElementById('cfElevation').value = gps.elevation ? gps.elevation.toFixed(1) : '';
            document.getElementById('cfAccuracy').value = gps.accuracy ? gps.accuracy.toFixed(1) : '';
        } else if (latlng) {
            document.getElementById('cfLat').value = latlng.lat.toFixed(6);
            document.getElementById('cfLng').value = latlng.lng.toFixed(6);
        }

        // 生成点编号
        this.generatePointNumber();
    },

    closeCollectPanel() {
        document.getElementById('collectPanel').classList.remove('open');
        this._hideOverlay();
        this.activePanel = null;
    },

    openDataPanel() {
        this.closeAllPanels();
        document.getElementById('dataPanel').classList.add('open');
        this._showOverlay();
        this.activePanel = 'dataPanel';
        this.loadLocalPoints();
    },

    closeDataPanel() {
        document.getElementById('dataPanel').classList.remove('open');
        this._hideOverlay();
        this.activePanel = null;
    },

    openSettingsPanel() {
        this.closeAllPanels();
        document.getElementById('settingsPanel').classList.add('open');
        this._showOverlay();
        this.activePanel = 'settingsPanel';
    },

    closeSettingsPanel() {
        document.getElementById('settingsPanel').classList.remove('open');
        this._hideOverlay();
        this.activePanel = null;
    },

    closeAllPanels() {
        document.querySelectorAll('.side-panel').forEach(p => p.classList.remove('open'));
        if (MobileNav) MobileNav._cancelPick();
        this._hideOverlay();
        this.activePanel = null;
    },

    // ===== 地图操作 =====

    toggleLayer(name) {
        // 简化的图层切换
        switch(name) {
            case 'base': {
                var cur = this.baseMaps[this._currentBaseMap] || this.baseMapLayer;
                if (cur && this.map.hasLayer(cur)) {
                    this.map.removeLayer(cur);
                    // 移除后同步 checkbox
                    var cb = document.getElementById('mlBaseMap');
                    if (cb) cb.checked = false;
                } else if (cur) {
                    cur.addTo(this.map);
                    if (document.getElementById('mlBaseMap')) document.getElementById('mlBaseMap').checked = true;
                }
                break;
            }
            case 'dem':
                this.toggleDEM(!this._demLayer || !this.map.hasLayer(this._demLayer));
                break;
            case 'points':
                if (this.map.hasLayer(this.pointsLayer)) {
                    this.map.removeLayer(this.pointsLayer);
                } else {
                    this.pointsLayer.addTo(this.map);
                }
                break;
            case 'route':
                if (this.map.hasLayer(this.routeLayer)) {
                    this.map.removeLayer(this.routeLayer);
                } else {
                    this.routeLayer.addTo(this.map);
                }
                break;
            case 'track':
                if (this.map.hasLayer(this.trackLayer)) {
                    this.map.removeLayer(this.trackLayer);
                } else {
                    this.trackLayer.addTo(this.map);
                }
                break;
        }
    },

    switchCrs(crs) {
        this.toast(`坐标系统已切换为: ${crs}`);
        // 实际应用中需要坐标转换，这里做示意
    },

    /// 点击定位按钮 — 飞至当前位置
    locateMe() {
        var btn = document.getElementById('btnLocate');

        // 优先使用 GPS 实时定位，桌面预览模式用模拟位置
        var pos = GPS.currentPosition || this.currentLocation;

        if (!pos) {
            this.toast('⚠️ 暂未获取到定位信号');
            return;
        }

        // 按钮旋转动画
        if (btn) {
            btn.classList.add('locating');
            setTimeout(function() { btn.classList.remove('locating'); }, 600);
        }

        // 飞至当前位置
        this.map.flyTo([pos.latitude, pos.longitude], 16, {
            duration: 0.8,
            easeLinearity: 0.25,
        });

        // 显示位置卡片
        var cardPos = {
            latitude: pos.latitude,
            longitude: pos.longitude,
            elevation: pos.elevation || null,
            accuracy: pos.accuracy || null,
        };
        this._updateLocationCard(cardPos);
        this._showLocationCard();

        // 5 秒后自动收起卡片
        clearTimeout(this._locCardTimer);
        this._locCardTimer = setTimeout(() => this._hideLocationCard(), 5000);

        this.toast('📍 ' + pos.latitude.toFixed(5) + ', ' + pos.longitude.toFixed(5));
    },

    _updateLocationCard(pos) {
        var latEl = document.getElementById('locLat');
        var lngEl = document.getElementById('locLng');
        var elevEl = document.getElementById('locElev');
        var accEl = document.getElementById('locAcc');
        if (latEl) latEl.textContent = pos.latitude.toFixed(6) + '°';
        if (lngEl) lngEl.textContent = pos.longitude.toFixed(6) + '°';
        if (elevEl) elevEl.textContent = pos.elevation ? pos.elevation.toFixed(1) + ' m' : '--';
        if (accEl) accEl.textContent = pos.accuracy ? '±' + pos.accuracy.toFixed(1) + ' m' : '--';
    },

    _showLocationCard() {
        var card = document.getElementById('locationCard');
        if (card) card.classList.add('visible');
    },

    _hideLocationCard() {
        var card = document.getElementById('locationCard');
        if (card) card.classList.remove('visible');
    },

    updateCurrentLocationMarker(pos) {
        // 移除旧标记
        if (this.currentLocationMarker) {
            this.map.removeLayer(this.currentLocationMarker);
            if (this.locationCircle) this.map.removeLayer(this.locationCircle);
        }

        // 创建新标记（脉冲效果圆形标记）
        var icon = L.divIcon({
            className: 'current-location-marker',
            html: '<div class="pulse-circle"></div>',
            iconSize: [16, 16],
            iconAnchor: [8, 8],
        });

        this.currentLocationMarker = L.marker([pos.latitude, pos.longitude], {
            icon: icon,
            zIndexOffset: 1000,
        }).addTo(this.map);

        // 精度圆 — 使用 Apple Accent 色
        if (pos.accuracy) {
            this.locationCircle = L.circle([pos.latitude, pos.longitude], {
                radius: pos.accuracy,
                color: '#007aff',
                fillColor: '#007aff',
                fillOpacity: 0.08,
                weight: 1.5,
            }).addTo(this.map);
        }

        // 持续更新位置卡片
        this._updateLocationCard(pos);

        // 首次定位成功自动居中
        if (!this._hasInitialFix) {
            this._hasInitialFix = true;
            this.map.setView([pos.latitude, pos.longitude], 15);
            this._showLocationCard();
            clearTimeout(this._locCardTimer);
            this._locCardTimer = setTimeout(() => this._hideLocationCard(), 5000);
        }

        // 如果地图视图离当前位置太远（5km），自动拉近
        var mapCenter = this.map.getCenter();
        var dist = GPS.calcDistance(mapCenter.lat, mapCenter.lng, pos.latitude, pos.longitude);
        if (dist > 5000) {
            this.map.setView([pos.latitude, pos.longitude], this.map.getZoom());
        }
    },

    renderTrackOnMap(trackPoints) {
        this.trackLayer.clearLayers();

        if (trackPoints.length < 2) return;

        const coords = trackPoints.map(p => [p.latitude, p.longitude]);
        L.polyline(coords, {
            color: '#ff4444',
            weight: 4,
            opacity: 0.8,
        }).addTo(this.trackLayer);

        // 起点和终点标记
        const start = trackPoints[0];
        const end = trackPoints[trackPoints.length - 1];

        L.circleMarker([start.latitude, start.longitude], {
            radius: 6, color: '#00ff00', fillOpacity: 1,
        }).bindPopup('起点').addTo(this.trackLayer);

        L.circleMarker([end.latitude, end.longitude], {
            radius: 6, color: '#ff0000', fillOpacity: 1,
        }).bindPopup('当前位置').addTo(this.trackLayer);
    },

    async loadLocalDataToMap() {
        // 加载本地存储的地质点
        const points = await Storage.getPoints();
        this.renderLocalPoints(points);

        // 加载最近的路线
        const routes = await Storage.getLocalRoutes();
        if (routes.length > 0) {
            const lastRoute = routes[0];
            if (lastRoute.trackpoints && lastRoute.trackpoints.length > 0) {
                this.renderTrackOnMap(lastRoute.trackpoints);
            }
        }
    },

    renderLocalPoints(points) {
        this.pointsLayer.clearLayers();

        const iconMap = {
            '地质观察点': '#0066ff',
            '构造测量点': '#ff0000',
            '样品点': '#00aa00',
            '照片点': '#ff8800',
            '地貌点': '#8b4513',
            '水文点': '#00cccc',
            '工程地质点': '#a0522d',
        };

        points.forEach(p => {
            const color = iconMap[p.point_type] || '#888';
            const marker = L.circleMarker([p.latitude, p.longitude], {
                radius: 7,
                fillColor: color,
                color: '#fff',
                weight: 2,
                fillOpacity: 0.9,
            }).addTo(this.pointsLayer);

            marker.bindPopup(`
                <b>${p.point_number}</b><br>
                类型: ${p.point_type}<br>
                时间: ${new Date(p.created_at).toLocaleString('zh-CN')}<br>
                ${p.description ? '描述: ' + p.description.substring(0, 50) : ''}
            `);
        });
    },

    // ===== 地质点采集 =====
    async generatePointNumber() {
        const prefix = 'D';
        const points = await Storage.getPoints();
        const today = new Date().toISOString().slice(0, 10).replace(/-/g, '');
        const todayPoints = points.filter(p => p.created_at?.startsWith(today));

        const nextNum = todayPoints.length + 1;
        document.getElementById('cfPointNumber').value = `${prefix}${today.slice(2)}${String(nextNum).padStart(3, '0')}`;
    },

    updateCollectForm() {
        // 根据点类型调整表单（如构造点显示产状字段）
        const type = document.getElementById('cfPointType').value;
        // 可按需扩展
    },

    async submitPoint() {
        const pointNumber = document.getElementById('cfPointNumber').value;
        const pointType = document.getElementById('cfPointType').value;
        const lat = parseFloat(document.getElementById('cfLat').value);
        const lng = parseFloat(document.getElementById('cfLng').value);

        if (!lat || !lng) {
            this.toast('⚠️ 请先获取GPS定位');
            return;
        }

        if (!pointNumber) {
            this.toast('⚠️ 请输入点编号');
            return;
        }

        const pointData = {
            project_id: this.currentProjectId || 0,
            point_number: pointNumber,
            point_type: pointType,
            latitude: lat,
            longitude: lng,
            elevation: parseFloat(document.getElementById('cfElevation').value) || null,
            accuracy: parseFloat(document.getElementById('cfAccuracy').value) || null,
            location_method: 'GPS',
            rock_type: document.getElementById('cfRockType').value,
            stratum_age: document.getElementById('cfStratumAge').value,
            description: document.getElementById('cfDescription').value,
            synced: false,
        };

        try {
            await Storage.savePoint(pointData);
            this.toast('✅ 地质点保存成功！');

            // 清空表单
            document.getElementById('cfDescription').value = '';
            document.getElementById('cfStratumAge').value = '';
            document.getElementById('cfRockType').value = '';
            document.getElementById('cfPhotoPreview').innerHTML = '';
            document.getElementById('cfPhoto').value = '';

            // 刷新地图和数据
            await this.loadLocalDataToMap();
            await this.generatePointNumber();

        } catch (e) {
            this.toast('❌ 保存失败: ' + e.message);
        }
    },

    // ===== 数据列表 =====
    async loadLocalPoints() {
        const type = document.getElementById('dataFilter')?.value || '';
        const points = await Storage.getPoints(null, type);
        const container = document.getElementById('dataList');

        if (points.length === 0) {
            container.innerHTML = '<p class="placeholder">暂无采集数据<br>点击"采集"开始野外记录</p>';
            return;
        }

        container.innerHTML = points.map(p => `
            <div class="data-item">
                <div class="di-header">
                    <span class="di-number">📍 ${p.point_number}</span>
                    <span class="di-type">${p.point_type}</span>
                </div>
                <div class="di-details">
                    <span>${p.latitude?.toFixed(4)}, ${p.longitude?.toFixed(4)}</span>
                    ${p.elevation ? `<span>${p.elevation.toFixed(0)}m</span>` : ''}
                    <span>${new Date(p.created_at).toLocaleString('zh-CN')}</span>
                    <span>${p.synced ? '✅ 已同步' : '📱 本地'}</span>
                </div>
                ${p.description ? `<p style="font-size:0.8em;color:var(--text2);margin-top:4px;">${p.description.substring(0, 80)}</p>` : ''}
                <div class="di-actions">
                    <button onclick="MobileApp.locatePoint(${p.latitude}, ${p.longitude})">🗺️ 定位</button>
                    <button onclick="MobileApp.deleteLocalPoint(${p.id})">🗑️ 删除</button>
                </div>
            </div>
        `).join('');
    },

    locatePoint(lat, lng) {
        this.map.setView([lat, lng], 17);
        this.closeAllPanels();
    },

    async deleteLocalPoint(id) {
        if (!confirm('确定要删除此地质点吗？')) return;

        await Storage.deletePoint(id);
        this.toast('已删除');
        await this.loadLocalDataToMap();
        this.loadLocalPoints();
    },

    // ===== 数据同步 =====
    async syncData() {
        if (!this.currentProjectId) {
            this.toast('⚠️ 请先选择项目');
            return;
        }
        const unsynced = await Storage.getUnsyncedPoints();
        if (unsynced.length === 0) {
            this.toast('✅ 所有数据已同步');
            return;
        }

        this.toast(`🔄 正在同步 ${unsynced.length} 条数据...`);

        try {
            const data = {
                project_id: this.currentProjectId || 0,
                points: unsynced,
            };

            const result = await api.sync.import(data);

            // 标记为已同步
            const ids = unsynced.map(p => p.id);
            await Storage.markSynced(ids);

            this.toast(`✅ 同步完成！点:${result.imported?.points || unsynced.length}`);
            await this.loadLocalDataToMap();
            if (document.getElementById('dataPanel').classList.contains('open')) {
                this.loadLocalPoints();
            }
        } catch (e) {
            this.toast('⚠️ 同步失败，数据保留在本地');
            console.error('同步错误:', e);
        }
    },

    async exportLocalData() {
        try {
            const data = await Storage.exportAllData();
            const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `geological_data_${new Date().toISOString().slice(0,10)}.json`;
            a.click();
            URL.revokeObjectURL(url);
            this.toast('📤 数据导出成功');
        } catch (e) {
            this.toast('❌ 导出失败');
        }
    },

    // ===== 项目管理 =====
    async loadProjects() {
        try {
            const projects = await api.projects.list();
            const select = document.getElementById('mobileProjectSelect');
            select.innerHTML = '<option value="">-- 选择项目 --</option>';
            projects.forEach(p => {
                const opt = document.createElement('option');
                opt.value = p.id;
                opt.textContent = p.name;
                select.appendChild(opt);
            });
        } catch (e) {}
    },

    async switchProject(id) {
        this.currentProjectId = id ? parseInt(id) : null;
        if (id) {
            await this.loadRemoteData(id);
        }
    },

    async loadRemoteData(projectId) {
        try {
            const data = await api.projects.overview(projectId);
            // 合并远程数据到地图
            data.points?.forEach(p => {
                const marker = L.circleMarker([p.latitude, p.longitude], {
                    radius: 7, fillColor: '#00d2ff', color: '#fff',
                    weight: 2, fillOpacity: 0.9,
                }).addTo(this.pointsLayer);
                marker.bindPopup(`<b>${p.point_number}</b><br>${p.point_type}`);
            });
            this.toast(`加载了 ${data.points?.length || 0} 个远程点`);
        } catch (e) {
            console.warn('加载远程数据失败:', e);
        }
    },

    showNewProject() {
        const name = prompt('请输入项目名称:');
        if (!name) return;

        api.projects.create({
            name: name,
            description: '',
            region: '',
            crs: 'EPSG:4326'
        }).then(result => {
            this.currentProjectId = result.id;
            this.toast('✅ 项目创建成功');
            this.loadProjects();
        }).catch(e => {
            this.toast('❌ 创建失败: ' + e.message);
        });
    },

    // ===== 路线回放 =====
    async updateRouteList() {
        const routes = await Storage.getLocalRoutes();
        const select = document.getElementById('routeReplaySelect');
        select.innerHTML = '<option value="">-- 选择历史路线 --</option>';
        routes.forEach(r => {
            const opt = document.createElement('option');
            opt.value = r.id;
            opt.textContent = `${r.name} (${r.trackpoints?.length || 0}点)`;
            select.appendChild(opt);
        });
    },

    async replayRoute(routeId) {
        if (!routeId) return;

        const routes = await Storage.getLocalRoutes();
        const route = routes.find(r => r.id == routeId);
        if (!route || !route.trackpoints) return;

        // 缩放到路线范围
        const coords = route.trackpoints.map(p => [p.latitude, p.longitude]);
        this.map.fitBounds(L.latLngBounds(coords), { padding: [30, 30] });

        // 渲染路线
        this.renderTrackOnMap(route.trackpoints);
        this.closeSideMenu();
        this.toast(`正在回放: ${route.name}`);
    },

    // ===== 其他功能 =====
    showRouteLog() {
        const routes = Storage.getLocalRoutes();
        // 显示最近路线的日志
        this.closeSideMenu();
        this.toast('路线日志功能请查看桌面端');
    },

    async showSampleLedger() {
        this.closeSideMenu();
        const points = await Storage.getPoints(null, '样品点');
        if (points.length > 0) {
            this.toast(`共 ${points.length} 个样品点`);
        } else {
            this.toast('暂无样品数据');
        }
    },

    // ===== 地层单元管理 =====
    async showStrataPanel() {
        this.closeSideMenu();
        document.getElementById('strataPanel').classList.add('open');
        this._showOverlay();
        this.activePanel = 'strataPanel';
        await this.loadStrataList();
    },

    closeStrataPanel() {
        document.getElementById('strataPanel').classList.remove('open');
        this._hideOverlay();
        this.activePanel = null;
    },

    async loadStrataList() {
        const container = document.getElementById('strataList');
        if (!this.currentProjectId) {
            container.innerHTML = '<p class="placeholder">请先选择项目</p>';
            return;
        }
        try {
            const strata = await api.strata.list(this.currentProjectId);
            if (strata.length === 0) {
                container.innerHTML = '<p class="placeholder">暂无地层单元<br>点击添加地层</p>';
                return;
            }
            container.innerHTML = strata.map(s => `
                <div class="data-item" style="border-left: 4px solid ${s.color || '#808080'}">
                    <div class="di-header">
                        <span class="di-number">${s.code}</span>
                        <span class="di-type">${s.stratigraphic_age || ''}</span>
                    </div>
                    <div style="font-weight:bold;margin:4px 0">${s.name}</div>
                    <div class="di-details">
                        <span>岩性: ${s.lithology || '--'}</span>
                        <span>厚: ${s.thickness_min || 0}-${s.thickness_max || 0}m</span>
                        <span>${s.contact_type || ''}</span>
                    </div>
                    <div class="di-actions">
                        <button onclick="MobileApp.editStratum(${s.id})">✏️</button>
                        <button onclick="MobileApp.deleteStratum(${s.id})">🗑️</button>
                    </div>
                </div>
            `).join('');
        } catch (e) {
            container.innerHTML = '<p class="placeholder">加载失败: ' + (e.message || '未知错误') + '</p>';
        }
    },

    showStrataForm(stratum) {
        document.getElementById('strataListContainer').style.display = 'none';
        document.getElementById('strataForm').style.display = 'block';
        document.getElementById('strataForm').dataset.editId = stratum ? stratum.id : '';
        if (stratum) {
            document.getElementById('sfCode').value = stratum.code || '';
            document.getElementById('sfName').value = stratum.name || '';
            document.getElementById('sfAge').value = stratum.stratigraphic_age || '';
            document.getElementById('sfLithology').value = stratum.lithology || '';
            document.getElementById('sfDesc').value = stratum.description || '';
            document.getElementById('sfColor').value = stratum.color || '#808080';
            document.getElementById('sfMinThick').value = stratum.thickness_min || '';
            document.getElementById('sfMaxThick').value = stratum.thickness_max || '';
            document.getElementById('sfContact').value = stratum.contact_type || '';
            document.getElementById('sfRemarks').value = stratum.remarks || '';
        } else {
            document.getElementById('sfCode').value = '';
            document.getElementById('sfName').value = '';
            document.getElementById('sfAge').value = '';
            document.getElementById('sfLithology').value = '';
            document.getElementById('sfDesc').value = '';
            document.getElementById('sfColor').value = '#808080';
            document.getElementById('sfMinThick').value = '';
            document.getElementById('sfMaxThick').value = '';
            document.getElementById('sfContact').value = '';
            document.getElementById('sfRemarks').value = '';
        }
    },

    cancelStrataForm() {
        document.getElementById('strataListContainer').style.display = 'block';
        document.getElementById('strataForm').style.display = 'none';
    },

    async saveStratum() {
        const editId = document.getElementById('strataForm').dataset.editId;
        const data = {
            project_id: this.currentProjectId,
            code: document.getElementById('sfCode').value,
            name: document.getElementById('sfName').value,
            stratigraphic_age: document.getElementById('sfAge').value,
            lithology: document.getElementById('sfLithology').value,
            description: document.getElementById('sfDesc').value,
            color: document.getElementById('sfColor').value,
            thickness_min: parseFloat(document.getElementById('sfMinThick').value) || null,
            thickness_max: parseFloat(document.getElementById('sfMaxThick').value) || null,
            contact_type: document.getElementById('sfContact').value,
            remarks: document.getElementById('sfRemarks').value,
        };
        if (!data.code || !data.name) {
            this.toast('⚠️ 代号与名称不能为空');
            return;
        }
        try {
            if (editId) {
                await api.strata.update(parseInt(editId), data);
                this.toast('✅ 地层单元已更新');
            } else {
                await api.strata.create(data);
                this.toast('✅ 地层单元已创建');
            }
            this.cancelStrataForm();
            await this.loadStrataList();
        } catch (e) {
            this.toast('❌ 保存失败: ' + (e.message || '未知错误'));
        }
    },

    async editStratum(id) {
        try {
            const stratum = await api.strata.get(id);
            this.showStrataForm(stratum);
        } catch (e) {
            this.toast('❌ 加载失败');
        }
    },

    async deleteStratum(id) {
        if (!confirm('确定删除此地层单元?')) return;
        try {
            await api.strata.delete(id);
            this.toast('✅ 已删除');
            await this.loadStrataList();
        } catch (e) {
            this.toast('❌ 删除失败');
        }
    },

    async cacheMapArea() {
        this.toast('📥 开始缓存当前地图区域...');

        const bounds = this.map.getBounds();
        const zoom = this.map.getZoom();
        const baseType = document.getElementById('mobileBaseMap')?.value || 'amap';

        // 底图URL模板（对齐桌面端 BASE_MAPS）
        const urlTemplates = {
            amap: 'https://webrd0{s}.is.autonavi.com/appmaptile?lang=zh_cn&size=1&scale=1&style=8&x={x}&y={y}&z={z}',
            amap_sat: 'https://webst0{s}.is.autonavi.com/appmaptile?style=6&x={x}&y={y}&z={z}',
            esri_sat: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
            esri_topo: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/{z}/{y}/{x}',
        };
        const template = urlTemplates[baseType] || urlTemplates['amap'];

        // 缓存当前视图及上下两级
        let tiles = [];
        for (let z = Math.max(1, zoom - 2); z <= Math.min(18, zoom + 1); z++) {
            const nw = this.map.project(bounds.getNorthWest(), z);
            const se = this.map.project(bounds.getSouthEast(), z);
            const tileSize = 256;
            const minX = Math.floor(nw.x / tileSize);
            const maxX = Math.floor(se.x / tileSize);
            const minY = Math.floor(nw.y / tileSize);
            const maxY = Math.floor(se.y / tileSize);

            for (let x = minX; x <= maxX; x++) {
                for (let y = minY; y <= maxY; y++) {
                    let url = template.replace('{z}', z).replace('{x}', x).replace('{y}', y);
                    if (template.includes('{s}')) {
                        const subs = ['1', '2', '3', '4'];
                        url = url.replace('{s}', subs[(x + y) % 4]);
                    }
                    tiles.push(url);
                }
            }
        }

        // 去重
        tiles = [...new Set(tiles)];
        if (tiles.length > 2000) {
            this.toast('⚠️ 区域过大，仅缓存前2000个瓦片');
            tiles = tiles.slice(0, 2000);
        }

        // 逐个缓存瓦片
        let cached = 0, failed = 0;
        for (let i = 0; i < tiles.length; i++) {
            const url = tiles[i];
            try {
                // 先检查是否已缓存
                const existing = await Storage.getCachedTile(url);
                if (existing) {
                    cached++;
                    continue;
                }
                const response = await fetch(url, { mode: 'cors' });
                if (response.ok) {
                    const blob = await response.blob();
                    await Storage.cacheTile(url, blob);
                    cached++;
                } else {
                    failed++;
                }
            } catch (e) {
                failed++;
            }
            // 每50个更新一次进度
            if ((i + 1) % 50 === 0 || i === tiles.length - 1) {
                this.toast(`📥 缓存进度: ${i + 1}/${tiles.length} (成功${cached})`);
            }
        }

        this.toast(`✅ 缓存完成: ${cached}/${tiles.length} 个瓦片${failed > 0 ? ' (失败' + failed + ')' : ''}`);
    },

    async loadSettings() {
        const interval = await Storage.getSetting('gpsInterval', 5);
        const distance = await Storage.getSetting('trackDistance', 10);

        document.getElementById('setGpsInterval').value = interval;
        document.getElementById('setTrackDistance').value = distance;

        GPS.trackInterval = interval;
        GPS.minTrackDistance = distance;
    },

    async saveSettings() {
        const interval = parseInt(document.getElementById('setGpsInterval').value) || 5;
        const distance = parseInt(document.getElementById('setTrackDistance').value) || 10;

        await Storage.saveSetting('gpsInterval', interval);
        await Storage.saveSetting('trackDistance', distance);

        GPS.trackInterval = interval;
        GPS.minTrackDistance = distance;

        this.toast('✅ 设置已保存');
        this.closeAllPanels();
    },

    // ===== UI工具 =====
    toast(message) {
        const el = document.getElementById('toast');
        el.textContent = message;
        el.classList.add('show');
        clearTimeout(el._timeout);
        el._timeout = setTimeout(() => el.classList.remove('show'), 2500);
    },
};

// 启动应用
document.addEventListener('DOMContentLoaded', () => MobileApp.init());
