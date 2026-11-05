/**
 * 路径导航模块 — A→B 路径规划
 * Navigation Module — Route Planning
 * 使用后端代理的高德 Web API 进行驾车/步行/骑行路径规划
 */
const Navigation = {
    _navLayer: null,       // 导航路线图层
    _startMarker: null,    // 起点标记
    _endMarker: null,      // 终点标记
    _panelState: null,     // 地图选点时暂存面板状态
    _pickTarget: null,     // 'origin' | 'destination'
    _pickHandler: null,    // 地图点击 handler

    show: function() {
        var content = document.getElementById('modalContent');
        content.innerHTML = this._buildPanel();
        document.getElementById('modalOverlay').style.display = 'flex';

        // 默认填充起点为地图当前中心
        if (MapModule && MapModule.map) {
            var center = MapModule.map.getCenter();
            var originInput = document.getElementById('navOrigin');
            if (originInput && !originInput.value) {
                originInput.value = center.lng.toFixed(6) + ',' + center.lat.toFixed(6);
            }
        }
    },

    _buildPanel: function() {
        return ''
            + '<span class="close-btn" onclick="Navigation.close()">✕</span>'
            + '<h2>🗺️ 路径导航</h2>'
            + '<div style="padding:0 4px">'
            // 交通方式
            + '<div style="display:flex;gap:6px;margin-bottom:12px">'
            + '<label style="display:flex;align-items:center;gap:4px;cursor:pointer;padding:6px 12px;border-radius:6px;border:1px solid var(--separator);flex:1;text-align:center;font-size:13px" id="navModeDriving" onclick="Navigation.selectMode(\'driving\')">'
            + '<input type="radio" name="navMode" value="driving" checked style="display:none">🚗 驾车</label>'
            + '<label style="display:flex;align-items:center;gap:4px;cursor:pointer;padding:6px 12px;border-radius:6px;border:1px solid var(--separator);flex:1;text-align:center;font-size:13px" id="navModeWalking" onclick="Navigation.selectMode(\'walking\')">'
            + '<input type="radio" name="navMode" value="walking" style="display:none">🚶 步行</label>'
            + '<label style="display:flex;align-items:center;gap:4px;cursor:pointer;padding:6px 12px;border-radius:6px;border:1px solid var(--separator);flex:1;text-align:center;font-size:13px" id="navModeRiding" onclick="Navigation.selectMode(\'riding\')">'
            + '<input type="radio" name="navMode" value="riding" style="display:none">🚴 骑行</label>'
            + '</div>'
            // 起点
            + '<div class="attr-row"><label>起点</label>'
            + '<div style="display:flex;gap:4px"><input type="text" id="navOrigin" placeholder="经度,纬度" style="flex:1">'
            + '<button class="nav-pick-btn" onclick="Navigation.startMapPick(\'origin\')" title="地图选起点" style="padding:4px 8px;border:0.5px solid var(--separator);border-radius:4px;background:var(--fill-quaternary);cursor:pointer">🗺️</button></div>'
            + '</div>'
            // 终点
            + '<div class="attr-row"><label>终点</label>'
            + '<div style="display:flex;gap:4px"><input type="text" id="navDestination" placeholder="经度,纬度" style="flex:1">'
            + '<button class="nav-pick-btn" onclick="Navigation.startMapPick(\'destination\')" title="地图选终点" style="padding:4px 8px;border:0.5px solid var(--separator);border-radius:4px;background:var(--fill-quaternary);cursor:pointer">🗺️</button></div>'
            + '</div>'
            // 操作按钮
            + '<div class="btn-group" style="margin-top:12px">'
            + '<button class="btn-primary" onclick="Navigation.planRoute()">🧭 开始导航</button>'
            + '<button class="btn-secondary" onclick="Navigation.swapPoints()">🔀 交换</button>'
            + '<button class="btn-secondary" onclick="Navigation.clearRoute()">🗑️ 清除</button>'
            + '</div>'
            // 路线详情
            + '<div id="navResult" style="margin-top:12px;max-height:260px;overflow-y:auto;display:none"></div>'
            + '</div>';
    },

    close: function() {
        // 取消地图选点模式
        if (this._pickHandler) this._cancelMapPick();
        if (typeof App !== 'undefined') App.closeModal();
    },

    selectMode: function(mode) {
        ['driving','walking','riding'].forEach(function(m) {
            var el = document.getElementById('navMode' + m.charAt(0).toUpperCase() + m.slice(1));
            if (el) {
                el.style.borderColor = m === mode ? 'var(--accent)' : 'var(--separator)';
                el.style.background = m === mode ? 'var(--fill-quinary)' : 'transparent';
            }
        });
    },

    swapPoints: function() {
        var originEl = document.getElementById('navOrigin');
        var destEl = document.getElementById('navDestination');
        if (originEl && destEl) {
            var tmp = originEl.value;
            originEl.value = destEl.value;
            destEl.value = tmp;
        }
    },

    startMapPick: function(target) {
        // 保存面板状态
        this._panelState = {
            origin: document.getElementById('navOrigin')?.value || '',
            destination: document.getElementById('navDestination')?.value || '',
            mode: document.querySelector('input[name="navMode"]:checked')?.value || 'driving'
        };

        // 关闭模态框但保持状态
        document.getElementById('modalOverlay').style.display = 'none';

        this._pickTarget = target;
        MapModule.map.getContainer().style.cursor = 'crosshair';

        var self = this;
        this._pickHandler = function(e) {
            self._onMapPick(e);
        };
        MapModule.map.on('click', this._pickHandler);

        var label = target === 'origin' ? '起点' : '终点';
        App.notify('请在地图上点击选择' + label + '（按 Esc 取消）', 'info');
    },

    _onMapPick: function(e) {
        var coord = e.latlng.lng.toFixed(6) + ',' + e.latlng.lat.toFixed(6);

        // 清理拾取模式
        MapModule.map.off('click', this._pickHandler);
        this._pickHandler = null;
        MapModule.map.getContainer().style.cursor = '';

        // 重建面板
        var content = document.getElementById('modalContent');
        content.innerHTML = this._buildPanel();
        document.getElementById('modalOverlay').style.display = 'flex';

        // 恢复状态
        if (this._panelState) {
            var originEl = document.getElementById('navOrigin');
            var destEl = document.getElementById('navDestination');
            if (originEl) originEl.value = this._panelState.origin;
            if (destEl) destEl.value = this._panelState.destination;
            this.selectMode(this._panelState.mode);
        }

        // 填入拾取的坐标
        if (this._pickTarget === 'origin') {
            var el = document.getElementById('navOrigin');
            if (el) el.value = coord;
        } else {
            var el2 = document.getElementById('navDestination');
            if (el2) el2.value = coord;
        }

        // 放置临时标记（统一加到 navLayer 以便 clearRoute 能清理）
        var navLayer = MapModule.layers.navigation;

        var icon = this._pickTarget === 'origin'
            ? L.divIcon({ className: '', html: '<div style="background:#22c55e;color:#fff;width:28px;height:28px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:bold;border:3px solid #fff;box-shadow:0 2px 8px rgba(0,0,0,0.3)">起</div>', iconSize: [28,28], iconAnchor: [14,14] })
            : L.divIcon({ className: '', html: '<div style="background:#ef4444;color:#fff;width:28px;height:28px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:bold;border:3px solid #fff;box-shadow:0 2px 8px rgba(0,0,0,0.3)">终</div>', iconSize: [28,28], iconAnchor: [14,14] });

        if (this._pickTarget === 'origin') {
            if (this._startMarker) MapModule.map.removeLayer(this._startMarker);
            this._startMarker = L.marker(e.latlng, { icon: icon, zIndexOffset: 5000 }).addTo(navLayer);
        } else {
            if (this._endMarker) MapModule.map.removeLayer(this._endMarker);
            this._endMarker = L.marker(e.latlng, { icon: icon, zIndexOffset: 5000 }).addTo(navLayer);
        }

        this._pickTarget = null;
        this._panelState = null;
    },

    _cancelMapPick: function() {
        if (this._pickHandler) {
            MapModule.map.off('click', this._pickHandler);
            this._pickHandler = null;
        }
        MapModule.map.getContainer().style.cursor = '';
        this._pickTarget = null;
        this._panelState = null;
    },

    planRoute: async function() {
        var originEl = document.getElementById('navOrigin');
        var destEl = document.getElementById('navDestination');
        if (!originEl || !destEl) return;

        var origin = (originEl.value || '').trim();
        var destination = (destEl.value || '').trim();

        if (!origin) { App.notify('请输入起点坐标', 'warning'); return; }
        if (!destination) { App.notify('请输入终点坐标', 'warning'); return; }

        var modeEl = document.querySelector('input[name="navMode"]:checked');
        var mode = modeEl ? modeEl.value : 'driving';

        // 显示加载态
        var resultEl = document.getElementById('navResult');
        if (resultEl) {
            resultEl.style.display = 'block';
            resultEl.innerHTML = '<div style="text-align:center;padding:20px;color:var(--fill-tertiary)">⏳ 正在规划路线...</div>';
        }

        try {
            var result = await api.navigation.route(origin, destination, mode);

            if (result.error) {
                var msg = result.detail || result.error;
                // 特殊处理常见错误
                if (result.error === 'AMAP_ERROR') {
                    msg = result.detail || ('高德返回错误: ' + (result.amap_info || ''));
                    // 常见高德错误码
                    if (result.amap_infocode === '10003') msg = '高德 API Key 无效或未开通路径规划服务，请在控制台启用"路径规划"API';
                    else if (result.amap_infocode === '10001') msg = '高德 API Key 未配置或已过期';
                    else if (result.amap_infocode === '30001') msg = '起点坐标无法解析（不在中国境内）';
                    else if (result.amap_infocode === '30002') msg = '终点坐标无法解析（不在中国境内）';
                    else if (result.amap_infocode === '30003') msg = '无法规划路线，起终点之间无路可达';
                } else if (result.error === 'NO_ROUTE') {
                    msg = '未找到可行路线，请检查起终点是否可达';
                } else if (result.error === 'TIMEOUT') {
                    msg = '请求超时，请稍后重试';
                } else if (result.error === 'INVALID_ORIGIN') {
                    msg = '起点坐标格式错误';
                } else if (result.error === 'INVALID_DESTINATION') {
                    msg = '终点坐标格式错误';
                }
                App.notify('规划失败: ' + msg, 'error');
                if (resultEl) resultEl.innerHTML = '<p style="color:var(--danger);text-align:center;padding:12px">' + msg + '</p>';
                return;
            }

            // 渲染路线
            this._renderRoute(result);

            // 确认导航图层可见
            if (!MapModule.map.hasLayer(MapModule.layers.navigation)) {
                MapModule.layers.navigation.addTo(MapModule.map);
            }

            App.notify('路线规划成功 — ' + ({driving:'驾车',walking:'步行',riding:'骑行'}[result.mode]||'') + ': '
                + (result.distance > 1000 ? (result.distance/1000).toFixed(1)+'km' : result.distance+'m'), 'success');
        } catch(e) {
            var msg = e.message || '未知错误';
            App.notify('规划失败: ' + msg, 'error');
            if (resultEl) resultEl.innerHTML = '<p style="color:var(--danger);text-align:center;padding:12px">' + msg + '</p>';
        }
    },

    _lastRouteResult: null,

    _renderRoute: function(result) {
        // 保存结果供后续保存使用
        this._lastRouteResult = result;
        // 清除旧路线
        this.clearRoute();

        var navLayer = MapModule.layers.navigation;

        // 确保导航图层可见并勾选 checkbox
        var navCheckbox = document.getElementById('layerNavigation');
        if (navCheckbox && !navCheckbox.checked) {
            navCheckbox.checked = true;
        }
        if (!MapModule.map.hasLayer(navLayer)) {
            navLayer.addTo(MapModule.map);
        }

        // 绘制路线（SVG 渲染器，三层叠加确保在任何底图上可见）
        if (result.polyline && result.polyline.length > 1) {
            var svgRenderer = L.svg({ padding: 0.5 });

            // 深色外发光
            L.polyline(result.polyline, {
                color: '#0f2b6b', weight: 14, opacity: 0.35,
                lineJoin: 'round', lineCap: 'round', renderer: svgRenderer
            }).addTo(navLayer);

            // 白色描边
            L.polyline(result.polyline, {
                color: '#ffffff', weight: 9, opacity: 1.0,
                lineJoin: 'round', lineCap: 'round', renderer: svgRenderer
            }).addTo(navLayer);

            // 蓝色主线
            L.polyline(result.polyline, {
                color: '#2563eb', weight: 5, opacity: 1.0,
                lineJoin: 'round', lineCap: 'round', renderer: svgRenderer
            }).addTo(navLayer);

            console.log('[Navigation] 路线线已绘制:', result.polyline.length, '个点');
        } else {
            console.warn('[Navigation] polyline 数据不足，无法绘制路线');
            App.notify('路线数据为空，无法绘制路线', 'warning');
        }

        // 起终点标记
        var originCoords = result.origin.split(',').map(parseFloat);
        var destCoords = result.destination.split(',').map(parseFloat);

        var startIcon = L.divIcon({
            className: '', html: '<div style="background:#22c55e;color:#fff;width:32px;height:32px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:13px;font-weight:bold;border:3px solid #fff;box-shadow:0 2px 10px rgba(0,0,0,0.3)">起</div>',
            iconSize: [32,32], iconAnchor: [16,16]
        });
        this._startMarker = L.marker([originCoords[1], originCoords[0]], { icon: startIcon, zIndexOffset: 5000 }).addTo(navLayer);

        var endIcon = L.divIcon({
            className: '', html: '<div style="background:#ef4444;color:#fff;width:32px;height:32px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:13px;font-weight:bold;border:3px solid #fff;box-shadow:0 2px 10px rgba(0,0,0,0.3)">终</div>',
            iconSize: [32,32], iconAnchor: [16,16]
        });
        this._endMarker = L.marker([destCoords[1], destCoords[0]], { icon: endIcon, zIndexOffset: 5000 }).addTo(navLayer);

        // 缩放到路线范围（包含起终点）
        var boundsPts = [];
        if (result.polyline && result.polyline.length > 0) {
            boundsPts = boundsPts.concat(result.polyline);
        }
        boundsPts.push([originCoords[1], originCoords[0]]);
        boundsPts.push([destCoords[1], destCoords[0]]);
        if (boundsPts.length >= 2) {
            MapModule.map.fitBounds(L.latLngBounds(boundsPts), { padding: [80, 80], maxZoom: 16 });
        }

        // 渲染步骤详情
        var resultEl = document.getElementById('navResult');
        if (!resultEl) return;
        resultEl.style.display = 'block';

        var modeLabel = { driving: '驾车', walking: '步行', riding: '骑行' }[result.mode] || result.mode;
        var distKm = result.distance > 1000 ? (result.distance / 1000).toFixed(1) + ' km' : result.distance + ' m';
        var durationMin = result.duration > 3600
            ? Math.floor(result.duration / 3600) + '小时' + Math.round((result.duration % 3600) / 60) + '分钟'
            : Math.round(result.duration / 60) + '分钟';
        var plLen = result.polyline ? result.polyline.length : 0;

        var html = '<div style="background:var(--fill-quinary);padding:10px;border-radius:6px;margin-bottom:8px">'
            + '<b>' + modeLabel + '</b> | 总距离: <b>' + distKm + '</b> | 预计: <b>' + durationMin + '</b>'
            + '<div style="margin-top:4px;font-size:11px;border-top:0.5px solid var(--separator);padding-top:4px">'
            + '路线坐标: ' + (plLen > 0 ? '<span style="color:#22c55e">✅ ' + plLen + '个点</span>' : '<span style="color:#ef4444">❌ 为空</span>')
            + '</div></div>';

        if (result.steps && result.steps.length > 0) {
            html += '<div style="font-size:11px;color:var(--fill-secondary)">路线步骤:</div>';
            html += '<ol style="margin:4px 0;padding-left:20px;font-size:11px">';
            result.steps.forEach(function(s, i) {
                var inst = (s.instruction || '').replace(/<[^>]*>/g, ''); // 去除HTML标签
                var stepDist = s.distance > 1000 ? (s.distance/1000).toFixed(1)+'km' : s.distance+'m';
                html += '<li style="margin:3px 0;line-height:1.5">'
                    + inst + ' <span style="color:var(--fill-tertiary)">(' + stepDist + ')</span>'
                    + '</li>';
            });
            html += '</ol>';
        }

        // 保存为出野路线按钮
        html += '<div style="margin-top:12px;border-top:0.5px solid var(--separator);padding-top:10px">'
            + '<button class="btn-primary" onclick="Navigation._saveAsFieldRoute()" style="width:100%;padding:8px;border-radius:6px;border:none;background:var(--accent);color:#fff;cursor:pointer;font-size:13px;font-weight:600">💾 保存为出野路线</button>'
            + '<div style="font-size:10px;color:var(--fill-tertiary);margin-top:4px;text-align:center">将导航路线保存为野外调查路线，可在图层中查看和编辑</div>'
            + '</div>';

        resultEl.innerHTML = html;
    },

    /**
     * 将当前导航路线保存为出野路线（保存到数据库 + 刷新地图图层 + 数据面板）
     */
    _saveAsFieldRoute: async function() {
        var result = this._lastRouteResult;
        if (!result) {
            App.notify('请先规划一条路线，再点击保存', 'warning');
            return;
        }
        if (!result.polyline || result.polyline.length === 0) {
            App.notify('路线坐标数据为空，无法保存。请重新规划路线后再试', 'warning');
            return;
        }

        // 确保项目已选择
        var projectId = App.currentProjectId || MapModule.currentProject;
        if (!projectId) {
            App.notify('请先在顶部下拉框选择项目', 'info');
            return;
        }
        projectId = parseInt(projectId);

        // 询问路线名称
        var defaultName = '导航路线_' + new Date().toISOString().slice(0, 10).replace(/-/g, '');
        var routeName = prompt('请输入出野路线名称:', defaultName);
        if (!routeName || !routeName.trim()) {
            App.notify('已取消保存', 'info');
            return;
        }

        // 构建路线描述
        var modeLabel = { driving: '驾车', walking: '步行', riding: '骑行' }[result.mode] || result.mode;
        var distKm = result.distance > 1000 ? (result.distance / 1000).toFixed(1) + 'km' : result.distance + 'm';
        var durationMin = result.duration > 3600
            ? Math.floor(result.duration / 3600) + '小时' + Math.round((result.duration % 3600) / 60) + '分钟'
            : Math.round(result.duration / 60) + '分钟';
        var description = '由导航路线生成 | 方式: ' + modeLabel + ' | 距离: ' + distKm + ' | 预计: ' + durationMin;

        try {
            // 1. 创建路线记录到数据库
            var routeData = {
                project_id: projectId,
                name: routeName.trim(),
                description: description,
                route_date: new Date().toISOString().slice(0, 10),
            };
            console.log('[SaveRoute] 1/4 正在创建路线:', routeData);
            var newRoute = await api.routes.create(routeData);
            console.log('[SaveRoute] 2/4 路线已创建, id:', newRoute.id);

            // 2. 将 polyline 坐标转为 trackpoints
            var trackpoints = result.polyline.map(function(coord, idx) {
                return {
                    latitude: coord[0],
                    longitude: coord[1],
                    elevation: 0,
                    sequence: idx,
                    timestamp: new Date().toISOString(),
                };
            });
            console.log('[SaveRoute] 3/4 正在保存', trackpoints.length, '个轨迹点...');
            var tpResult = await api.routes.addTrackpoints(newRoute.id, trackpoints);
            console.log('[SaveRoute] 3/4 轨迹点已保存:', tpResult);

            // 3. 刷新地图数据（使用统一 projectId）
            console.log('[SaveRoute] 4/4 正在刷新地图数据...');
            var overviewData = await MapModule.loadProjectData(projectId);
            var routeCount = overviewData.routes ? overviewData.routes.length : 0;
            console.log('[SaveRoute] 4/4 地图已刷新, 当前路线总数:', routeCount);

            // 4. 确保路线图层可见
            var cb = document.getElementById('layerRoutes');
            if (cb && !cb.checked) { cb.checked = true; }
            MapModule.toggleLayer('routes', true);

            // 5. 直接渲染数据面板（不依赖 tab 激活状态）
            if (typeof App._renderDataPanel === 'function') {
                console.log('[SaveRoute] 正在刷新数据面板...');
                App._renderDataPanel();
            }

            App.notify('出野路线保存成功: ' + routeName.trim() + ' (共' + routeCount + '条路线)', 'success');
            console.log('[SaveRoute] ✅ 保存完成！路线名:', routeName.trim());

            // 6. 询问是否关闭导航面板
            if (confirm('路线已保存到图层及数据库。是否关闭导航面板？')) {
                this.close();
            }
        } catch (e) {
            App.notify('保存失败: ' + (e.message || '未知错误'), 'error');
            console.error('[Navigation] 保存出野路线失败:', e);
        }
    },

    clearRoute: function() {
        // 清理 navLayer 中的所有内容
        if (MapModule.layers.navigation) {
            MapModule.layers.navigation.clearLayers();
        }
        // 移除可能直接添加到 map 的旧标记（兼容旧代码）
        if (this._startMarker) {
            try { MapModule.map.removeLayer(this._startMarker); } catch(e) {}
            this._startMarker = null;
        }
        if (this._endMarker) {
            try { MapModule.map.removeLayer(this._endMarker); } catch(e) {}
            this._endMarker = null;
        }

        var resultEl = document.getElementById('navResult');
        if (resultEl) { resultEl.style.display = 'none'; resultEl.innerHTML = ''; }
    }
};

// Esc 取消地图选点
document.addEventListener('keydown', function(e) {
    if (e.key === 'Escape' && Navigation._pickHandler) {
        Navigation._cancelMapPick();
        // 恢复面板
        var content = document.getElementById('modalContent');
        if (content && Navigation._panelState) {
            content.innerHTML = Navigation._buildPanel();
            document.getElementById('modalOverlay').style.display = 'flex';
            var originEl = document.getElementById('navOrigin');
            var destEl = document.getElementById('navDestination');
            if (originEl) originEl.value = Navigation._panelState.origin || '';
            if (destEl) destEl.value = Navigation._panelState.destination || '';
            Navigation.selectMode(Navigation._panelState.mode || 'driving');
            Navigation._panelState = null;
        }
        App.notify('地图选点已取消', 'info');
    }
});
