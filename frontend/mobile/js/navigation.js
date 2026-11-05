/**
 * 移动端路径导航模块
 * 复用桌面端后端 API: /api/navigation/route
 */
const MobileNav = {
    _navLayer: null,
    _lastResult: null,
    _pickTarget: null,
    _picking: false,
    _startMarker: null,   // 起点标记
    _endMarker: null,     // 终点标记

    init() {
        if (!MobileApp.map) return;
        if (!this._navLayer) {
            this._navLayer = L.featureGroup().addTo(MobileApp.map);
        }
    },

    open() {
        this.init();
        // 保存当前输入值（避免 _buildPanel 重建 HTML 时丢失）
        var savedOrigin = document.getElementById('mnOrigin')?.value || '';
        var savedDest = document.getElementById('mnDest')?.value || '';
        this._buildPanel();
        var panel = document.getElementById('navPanel');
        if (panel) panel.classList.add('open');
        MobileApp._showOverlay();
        MobileApp.activePanel = 'navPanel';
        // 恢复之前填入的坐标
        if (savedOrigin) { var o = document.getElementById('mnOrigin'); if (o) o.value = savedOrigin; }
        if (savedDest)   { var d = document.getElementById('mnDest'); if (d) d.value = savedDest; }
        // 首次打开时，默认填当前定位为起点
        if (!savedOrigin && !savedDest) {
            var pos = GPS.currentPosition || MobileApp.currentLocation;
            if (pos) {
                var el = document.getElementById('mnOrigin');
                if (el) el.value = pos.longitude.toFixed(6) + ',' + pos.latitude.toFixed(6);
            }
        }
    },

    close() {
        // 注意: 不要在这里 call _cancelPick()，因为 _startPick 需要保持 picking 状态
        // _cancelPick 只在 closeAllPanels 或手动取消时调用
        var panel = document.getElementById('navPanel');
        if (panel) panel.classList.remove('open');
        MobileApp._hideOverlay();
        MobileApp.activePanel = null;
    },

    _buildPanel() {
        var panel = document.getElementById('navPanel');
        if (!panel) return;
        panel.innerHTML = ''
            + '<div class="panel-head">'
            + '<h3>🗺️ 路径导航</h3>'
            + '<button class="icon-btn" onclick="MobileNav.close()">✕</button>'
            + '</div>'
            + '<div class="panel-body" style="padding:12px">'
            // 交通方式
            + '<div style="display:flex;gap:4px;margin-bottom:10px">'
            + ['driving|🚗 驾车','walking|🚶 步行','riding|🚴 骑行'].map(function(o) { var p=o.split('|'); return '<button class="nav-mode-btn" data-mode="' + p[0] + '" onclick="MobileNav._selectMode(\'' + p[0] + '\',this)" style="flex:1;padding:8px 4px;border:1px solid var(--separator);border-radius:6px;background:var(--fill-quaternary);font-size:11px;text-align:center;cursor:pointer">' + p[1] + '</button>'; }).join('')
            + '</div>'
            // 起点
            + '<div style="margin-bottom:8px"><label style="font-size:11px;color:var(--fill-tertiary)">起点</label>'
            + '<div style="display:flex;gap:4px"><input id="mnOrigin" placeholder="经度,纬度" style="flex:1;padding:8px;border:1px solid var(--separator);border-radius:6px;font-size:12px;background:var(--bg)">'
            + '<button onclick="MobileNav._useMyLocation(\'origin\')" style="padding:6px 8px;border:1px solid var(--accent);border-radius:6px;background:var(--fill-quinary);font-size:11px;cursor:pointer">📍</button>'
            + '<button class="nav-pick-btn" data-target="origin" style="padding:6px 8px;border:1px solid var(--separator);border-radius:6px;background:var(--fill-quaternary);font-size:11px;cursor:pointer">🗺️</button></div></div>'
            // 终点
            + '<div style="margin-bottom:12px"><label style="font-size:11px;color:var(--fill-tertiary)">终点</label>'
            + '<div style="display:flex;gap:4px"><input id="mnDest" placeholder="经度,纬度" style="flex:1;padding:8px;border:1px solid var(--separator);border-radius:6px;font-size:12px;background:var(--bg)">'
            + '<button onclick="MobileNav._useMyLocation(\'dest\')" style="padding:6px 8px;border:1px solid var(--accent);border-radius:6px;background:var(--fill-quinary);font-size:11px;cursor:pointer">📍</button>'
            + '<button class="nav-pick-btn" data-target="dest" style="padding:6px 8px;border:1px solid var(--separator);border-radius:6px;background:var(--fill-quaternary);font-size:11px;cursor:pointer">🗺️</button></div></div>'
            // 按钮
            + '<div style="display:flex;gap:6px;margin-bottom:12px">'
            + '<button onclick="MobileNav.plan()" style="flex:2;padding:10px;border:none;border-radius:8px;background:var(--accent);color:#fff;font-size:13px;font-weight:600;cursor:pointer">🧭 开始导航</button>'
            + '<button onclick="MobileNav._swap()" style="flex:1;padding:10px;border:1px solid var(--separator);border-radius:8px;background:var(--fill-quaternary);font-size:12px;cursor:pointer">🔀</button>'
            + '</div>'
            // 结果区域
            + '<div id="mnResult" style="display:none"></div>'
            + '</div>';

        // 绑定地图选点按钮
        setTimeout(() => {
            var btns = panel.querySelectorAll('.nav-pick-btn');
            btns.forEach(function(b) {
                b.addEventListener('click', function() { MobileNav._startPick(this.dataset.target); });
            });
        }, 100);

        // 默认选中驾车
        this._selectMode('driving', panel.querySelector('.nav-mode-btn[data-mode="driving"]'));
    },

    _selectMode(mode, btn) {
        var panel = document.getElementById('navPanel');
        if (!panel) return;
        panel.querySelectorAll('.nav-mode-btn').forEach(function(b) {
            b.style.background = 'var(--fill-quaternary)';
            b.style.borderColor = 'var(--separator)';
            b.style.color = '';
        });
        if (btn) {
            btn.style.background = 'var(--accent)';
            btn.style.borderColor = 'var(--accent)';
            btn.style.color = '#fff';
        }
        this._mode = mode;
    },

    _useMyLocation(target) {
        var pos = GPS.currentPosition || MobileApp.currentLocation;
        if (!pos) { MobileApp.toast('⚠️ 暂未获取到定位'); return; }
        var coord = pos.longitude.toFixed(6) + ',' + pos.latitude.toFixed(6);
        if (target === 'origin') {
            var el = document.getElementById('mnOrigin');
            if (el) el.value = coord;
        } else {
            var el2 = document.getElementById('mnDest');
            if (el2) el2.value = coord;
        }
    },

    _swap() {
        var o = document.getElementById('mnOrigin');
        var d = document.getElementById('mnDest');
        if (o && d) { var t = o.value; o.value = d.value; d.value = t; }
    },

    // 地图选点
    _startPick(target) {
        this._pickTarget = target;
        this._picking = true;
        MobileApp.map.getContainer().style.cursor = 'crosshair';
        MobileNav.close();  // 关闭面板以便看到地图
        MobileApp.toast('请在地图上点击选择' + (target === 'origin' ? '起点' : '终点'));
    },

    _onMapClick(e) {
        if (!this._picking) return;
        this._picking = false;
        MobileApp.map.getContainer().style.cursor = '';

        var coord = e.latlng.lng.toFixed(6) + ',' + e.latlng.lat.toFixed(6);

        // 移除同类型的旧标记，避免重复
        if (this._pickTarget === 'origin') {
            if (this._startMarker) this._navLayer.removeLayer(this._startMarker);
            var icon = L.divIcon({ className: '', html: '<div style="background:#22c55e;color:#fff;width:24px;height:24px;border-radius:50%;text-align:center;line-height:24px;font-size:10px;font-weight:bold;border:2px solid #fff;box-shadow:0 2px 6px rgba(0,0,0,0.3)">起</div>', iconSize: [24,24], iconAnchor: [12,12] });
            this._startMarker = L.marker(e.latlng, { icon: icon }).addTo(this._navLayer);
        } else {
            if (this._endMarker) this._navLayer.removeLayer(this._endMarker);
            var icon = L.divIcon({ className: '', html: '<div style="background:#ef4444;color:#fff;width:24px;height:24px;border-radius:50%;text-align:center;line-height:24px;font-size:10px;font-weight:bold;border:2px solid #fff;box-shadow:0 2px 6px rgba(0,0,0,0.3)">终</div>', iconSize: [24,24], iconAnchor: [12,12] });
            this._endMarker = L.marker(e.latlng, { icon: icon }).addTo(this._navLayer);
        }

        // 重新打开面板（会自动恢复之前填入的坐标）
        this.open();
        if (this._pickTarget === 'origin') {
            var el = document.getElementById('mnOrigin');
            if (el) el.value = coord;
        } else {
            var el2 = document.getElementById('mnDest');
            if (el2) el2.value = coord;
        }
        this._pickTarget = null;
    },

    _cancelPick() {
        this._picking = false;
        this._pickTarget = null;
        if (MobileApp.map) MobileApp.map.getContainer().style.cursor = '';
    },

    // 路径规划
    async plan() {
        var origin = (document.getElementById('mnOrigin')?.value || '').trim();
        var dest = (document.getElementById('mnDest')?.value || '').trim();
        if (!origin) { MobileApp.toast('⚠️ 请输入起点坐标'); return; }
        if (!dest) { MobileApp.toast('⚠️ 请输入终点坐标'); return; }

        var resultEl = document.getElementById('mnResult');
        if (resultEl) {
            resultEl.style.display = 'block';
            resultEl.innerHTML = '<div style="text-align:center;padding:16px;color:var(--fill-tertiary);font-size:12px">⏳ 正在规划路线...</div>';
        }

        try {
            var mode = this._mode || 'driving';
            var result = await api.navigation.route(origin, dest, mode);

            if (result.error) {
                MobileApp.toast('规划失败: ' + (result.detail || result.error));
                if (resultEl) resultEl.innerHTML = '<p style="color:var(--danger);text-align:center;padding:8px;font-size:12px">' + (result.detail || result.error) + '</p>';
                return;
            }

            this._lastResult = result;
            this._renderResult(result);
            MobileApp.toast('路线规划成功');
        } catch(e) {
            MobileApp.toast('规划失败: ' + (e.message || '网络错误'));
            if (resultEl) resultEl.innerHTML = '<p style="color:var(--danger);text-align:center;padding:8px;font-size:12px">' + (e.message||'网络错误') + '</p>';
        }
    },

    _renderResult(result) {
        // 清除旧导航层
        this._navLayer.clearLayers();
        this._startMarker = null;
        this._endMarker = null;

        // 绘制路线
        if (result.polyline && result.polyline.length > 1) {
            L.polyline(result.polyline, {
                color: '#2563eb', weight: 5, opacity: 0.9,
                lineJoin: 'round', lineCap: 'round'
            }).addTo(this._navLayer);
        }

        // 起终点标记
        var oc = result.origin.split(',').map(parseFloat);
        var dc = result.destination.split(',').map(parseFloat);
        var sIcon = L.divIcon({ className: '', html: '<div style="background:#22c55e;color:#fff;width:28px;height:28px;border-radius:50%;text-align:center;line-height:28px;font-size:12px;font-weight:bold;border:2px solid #fff">起</div>', iconSize: [28,28], iconAnchor: [14,14] });
        var eIcon = L.divIcon({ className: '', html: '<div style="background:#ef4444;color:#fff;width:28px;height:28px;border-radius:50%;text-align:center;line-height:28px;font-size:12px;font-weight:bold;border:2px solid #fff">终</div>', iconSize: [28,28], iconAnchor: [14,14] });
        L.marker([oc[1], oc[0]], { icon: sIcon }).addTo(this._navLayer);
        L.marker([dc[1], dc[0]], { icon: eIcon }).addTo(this._navLayer);

        // 缩放到路线
        var bounds = [];
        if (result.polyline) bounds = bounds.concat(result.polyline);
        bounds.push([oc[1], oc[0]], [dc[1], dc[0]]);
        if (bounds.length >= 2) {
            MobileApp.map.fitBounds(L.latLngBounds(bounds), { padding: [60,60], maxZoom: 16 });
        }

        // 渲染结果卡片
        var distKm = result.distance > 1000 ? (result.distance/1000).toFixed(1)+'km' : result.distance+'m';
        var durMin = result.duration > 3600 ? Math.floor(result.duration/3600)+'h'+Math.round((result.duration%3600)/60)+'min' : Math.round(result.duration/60)+'min';
        var modeLabel = {driving:'驾车',walking:'步行',riding:'骑行'}[result.mode]||result.mode;

        var resultEl = document.getElementById('mnResult');
        if (resultEl) {
            resultEl.style.display = 'block';
            resultEl.innerHTML = ''
                + '<div style="background:var(--fill-quinary);padding:10px;border-radius:8px;margin-top:8px">'
                + '<div style="display:flex;justify-content:space-between;margin-bottom:6px">'
                + '<b>' + modeLabel + '</b><span>' + distKm + ' | ' + durMin + '</span></div>'
                + '<button onclick="MobileNav._saveRoute()" style="width:100%;padding:10px;border:none;border-radius:8px;background:var(--accent);color:#fff;font-size:13px;font-weight:600;cursor:pointer;margin-top:6px">💾 保存为出野路线</button>'
                + '</div>';
        }
    },

    async _saveRoute() {
        var result = this._lastResult;
        if (!result || !result.polyline || result.polyline.length < 2) {
            MobileApp.toast('⚠️ 没有可保存的路线');
            return;
        }

        var projectId = MobileApp.currentProjectId;
        if (!projectId) {
            MobileApp.toast('⚠️ 请先在菜单中切换项目');
            return;
        }

        var defaultName = '移动路线_' + new Date().toISOString().slice(0,10).replace(/-/g,'');
        var routeName = prompt('路线名称:', defaultName);
        if (!routeName || !routeName.trim()) { MobileApp.toast('已取消'); return; }

        try {
            // 1. 创建路线
            var modeLabel = {driving:'驾车',walking:'步行',riding:'骑行'}[result.mode]||result.mode;
            var distKm = result.distance > 1000 ? (result.distance/1000).toFixed(1)+'km' : result.distance+'m';
            var newRoute = await api.routes.create({
                project_id: parseInt(projectId),
                name: routeName.trim(),
                description: '移动端导航 | 方式:' + modeLabel + ' | 距离:' + distKm,
                route_date: new Date().toISOString().slice(0,10),
            });

            // 2. 添加轨迹点
            var trackpoints = result.polyline.map(function(c, i) {
                return { latitude: c[0], longitude: c[1], elevation: 0, sequence: i, timestamp: new Date().toISOString() };
            });
            await api.routes.addTrackpoints(newRoute.id, trackpoints);

            MobileApp.toast('✅ 路线已保存: ' + routeName.trim());

            // 3. 重新加载远程数据
            if (projectId) await MobileApp.loadRemoteData(projectId);
        } catch(e) {
            MobileApp.toast('❌ 保存失败: ' + (e.message || '服务器错误'));
        }
    }
};

// 注册地图点击事件用于选点
document.addEventListener('DOMContentLoaded', function() {
    // 等 MobileApp 初始化后再绑定
    var check = setInterval(function() {
        if (MobileApp.map && MobileApp.map.on) {
            clearInterval(check);
            MobileApp.map.on('click', function(e) { MobileNav._onMapClick(e); });
        }
    }, 500);
    // 超时停止
    setTimeout(function() { clearInterval(check); }, 10000);
});
