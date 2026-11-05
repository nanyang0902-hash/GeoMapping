/**
 * GPS定位与轨迹记录模块
 * GPS Positioning & Track Recording Module
 */
const GPS = {
    watchId: null,
    currentPosition: null,
    isTracking: false,
    trackPoints: [],
    routeId: null,
    routeStartTime: null,
    lastTrackPoint: null,
    trackInterval: 5,        // GPS采集间隔(秒)
    minTrackDistance: 10,    // 最小记录距离(米)
    elevationGain: 0,
    totalDistance: 0,

    init() {
        // GPS 始终可用（NativeBridge 有回退机制）
        console.log('[GPS] 初始化定位模块');
        return true;
    },

    async startWatching() {
        if (this.watchId) return;

        this.watchId = await NativeBridge.watchPosition(
            (pos) => this.onPositionUpdate(pos),
            (err) => this.onPositionError(err)
        );

        document.getElementById('gpsStatus').classList.add('active');
        document.getElementById('gpsStatus').textContent = '📍 定位中...';
    },

    async stopWatching() {
        if (this.watchId) {
            // NativeBridge 和浏览器 GPS 都通过此清除
            if (NativeBridge.isNative) {
                try {
                    const { Geolocation } = await import('@capacitor/geolocation');
                    await Geolocation.clearWatch({ id: this.watchId });
                } catch(e) {}
            } else {
                navigator.geolocation.clearWatch(this.watchId);
            }
            this.watchId = null;
        }
        document.getElementById('gpsStatus').classList.remove('active');
        document.getElementById('gpsStatus').textContent = '📍 已停止';
    },

    onPositionUpdate(position) {
        const pos = {
            latitude: position.coords.latitude,
            longitude: position.coords.longitude,
            elevation: position.coords.altitude || null,
            accuracy: position.coords.accuracy,
            speed: position.coords.speed || null,
            heading: position.coords.heading || null,
            timestamp: new Date(position.timestamp).toISOString(),
        };

        this.currentPosition = pos;

        // 更新UI
        document.getElementById('gpsStatus').textContent = '📍 已定位';
        document.getElementById('gpsStatus').classList.add('active');
        document.getElementById('gpsCoords').textContent =
            `${pos.latitude.toFixed(6)}, ${pos.longitude.toFixed(6)}`;
        document.getElementById('gpsElevation').textContent =
            `高程: ${pos.elevation ? pos.elevation.toFixed(1) + 'm' : '--'}`;
        document.getElementById('gpsAccuracy').textContent =
            `精度: ${pos.accuracy ? pos.accuracy.toFixed(1) + 'm' : '--'}`;

        // 如果是轨迹记录模式，添加轨迹点
        if (this.isTracking) {
            this.addTrackPoint(pos);
        }

        // 更新地图上的当前位置
        MobileApp.updateCurrentLocationMarker(pos);
    },

    onPositionError(error) {
        const messages = {
            1: '定位被拒绝（请开启GPS权限）',
            2: '定位不可用（信号弱）',
            3: '定位超时',
        };
        document.getElementById('gpsStatus').textContent = '⚠️ ' + (messages[error.code] || '定位错误');
        document.getElementById('gpsStatus').classList.remove('active');
    },

    // 开始轨迹记录
    startRecording() {
        if (this.isTracking) return;

        this.isTracking = true;
        this.trackPoints = [];
        this.routeStartTime = new Date().toISOString();
        this.lastTrackPoint = null;
        this.elevationGain = 0;
        this.totalDistance = 0;

        // UI更新
        document.getElementById('recordStatus').style.display = 'inline';
        document.getElementById('btnRecord').classList.add('recording');
        document.getElementById('btnRecord').querySelector('.btn-label').textContent = '停止';
        document.getElementById('btnRecord').querySelector('.record-icon').textContent = '⏹️';

        MobileApp.toast('🔴 开始记录轨迹');
    },

    // 停止轨迹记录
    async stopRecording() {
        if (!this.isTracking) return;

        this.isTracking = false;

        // UI更新
        document.getElementById('recordStatus').style.display = 'none';
        document.getElementById('btnRecord').classList.remove('recording');
        document.getElementById('btnRecord').querySelector('.btn-label').textContent = '记录';
        document.getElementById('btnRecord').querySelector('.record-icon').textContent = '⏺️';

        MobileApp.toast(`轨迹记录完成！共 ${this.trackPoints.length} 个点，${this.totalDistance.toFixed(2)}km`);

        // 保存轨迹到本地存储
        const route = {
            id: Date.now(),
            name: `路线_${new Date().toLocaleDateString('zh-CN')}`,
            route_date: new Date().toLocaleDateString('zh-CN'),
            start_time: this.routeStartTime,
            end_time: new Date().toISOString(),
            total_distance: this.totalDistance,
            trackpoints: this.trackPoints,
        };

        await Storage.saveLocalRoute(route);
        MobileApp.updateRouteList();
        MobileApp.renderTrackOnMap(this.trackPoints);
    },

    // 添加轨迹点（带距离过滤）
    addTrackPoint(pos) {
        // 距离过滤
        if (this.lastTrackPoint && this.trackPoints.length > 0) {
            const dist = this.calcDistance(
                this.lastTrackPoint.latitude, this.lastTrackPoint.longitude,
                pos.latitude, pos.longitude
            );
            if (dist < this.minTrackDistance) return;

            this.totalDistance += dist / 1000;

            // 累计爬升
            if (this.lastTrackPoint.elevation && pos.elevation) {
                const elevDiff = pos.elevation - this.lastTrackPoint.elevation;
                if (elevDiff > 0) this.elevationGain += elevDiff;
            }
        }

        this.trackPoints.push(pos);
        this.lastTrackPoint = pos;

        // 实时渲染轨迹
        MobileApp.renderTrackOnMap(this.trackPoints);
    },

    // 计算两点距离 (Haversine公式, 返回米)
    calcDistance(lat1, lon1, lat2, lon2) {
        const R = 6371000;
        const dLat = (lat2 - lat1) * Math.PI / 180;
        const dLon = (lon2 - lon1) * Math.PI / 180;
        const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
                  Math.cos(lat1 * Math.PI/180) * Math.cos(lat2 * Math.PI/180) *
                  Math.sin(dLon/2) * Math.sin(dLon/2);
        return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    },

    // 获取当前GPS信息（用于填充采集表单）
    getCurrentInfo() {
        if (!this.currentPosition) return null;
        return {
            latitude: this.currentPosition.latitude,
            longitude: this.currentPosition.longitude,
            elevation: this.currentPosition.elevation,
            accuracy: this.currentPosition.accuracy,
        };
    },

    // 计算方位角
    calculateBearing(lat1, lon1, lat2, lon2) {
        const dLon = (lon2 - lon1) * Math.PI / 180;
        const y = Math.sin(dLon) * Math.cos(lat2 * Math.PI / 180);
        const x = Math.cos(lat1 * Math.PI / 180) * Math.sin(lat2 * Math.PI / 180) -
                  Math.sin(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.cos(dLon);
        return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
    },
};
