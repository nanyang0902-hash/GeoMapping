/**
 * 桌面端主应用控制器
 */
const App = {
    currentProjectId: null,

    async init() {
        // 0. 先绑定事件（确保选择器可交互，即使后续步骤失败）
        try { this.bindEvents(); } catch(e) { console.error(e); }

        // 1. 初始化地图
        try { MapModule.init(); } catch(e) { console.error('Map init failed:', e); }

        // 2. 加载符号库
        try { SymbolLib.load(); } catch(e) {}

        // 3. 加载项目列表
        try { await this.loadProjects(); } catch(e) { console.error('loadProjects failed:', e); }

        // 4. 检查API状态
        try { this.checkApiStatus(); } catch(e) {}

        // 定时更新
        setInterval(function() {
            try { App.updateStatusBar(); } catch(e) {}
        }, 30000);
    },

    bindEvents() {
        var self = this;
        function safeOn(id, event, fn) {
            var el = document.getElementById(id);
            if (el) el.addEventListener(event, fn);
        }
        // 项目选择
        safeOn('projectSelect', 'change', function(e) { if (e.target.value) self.loadProject(e.target.value); });
        safeOn('btnNewProject', 'click', function() { self.showNewProjectForm(); });
        safeOn('btnProjectInfo', 'click', function() { self.showProjectInfo(); });
        safeOn('btnBackHome', 'click', function() { window.location.href = '/'; });
        safeOn('btnPrintLayout', 'click', function() { self.openPrintLayout(); });

        // 底图切换
        safeOn('baseMapSelect', 'change', function(e) { MapModule.switchBaseMap(e.target.value); });

        // DEM 地形阴影开关
        safeOn('layerDEM', 'change', function(e) { MapModule.toggleDEM(e.target.checked); });

        // 图层切换
        ['points','routes','boundaries','faults','areas','photos','navigation'].forEach(function(name) {
            safeOn('layer' + name.charAt(0).toUpperCase() + name.slice(1), 'change', function(e) {
                MapModule.toggleLayer(name, e.target.checked);
            });
        });

        // 面板Tab切换
        var tabBtns = document.querySelectorAll('.tab-btn');
        for (var i = 0; i < tabBtns.length; i++) {
            tabBtns[i].addEventListener('click', function() {
                var btns = document.querySelectorAll('.tab-btn');
                var contents = document.querySelectorAll('.tab-content');
                for (var j = 0; j < btns.length; j++) btns[j].classList.remove('active');
                for (var k = 0; k < contents.length; k++) contents[k].classList.remove('active');
                this.classList.add('active');
                var tabEl = document.getElementById('tab-' + this.dataset.tab);
                if (tabEl) tabEl.classList.add('active');
                // 切换到数据面板时自动刷新
                if (this.dataset.tab === 'data' && self._dataPanelDirty) {
                    self._renderDataPanel();
                }
            });
        }

        // 工具按钮
        var toolBtns = document.querySelectorAll('.tool-btn');
        for (var t = 0; t < toolBtns.length; t++) {
            toolBtns[t].addEventListener('click', function() {
                self.handleToolAction(this.dataset.action);
            });
        }

        // 关闭右键菜单
        document.addEventListener('click', function(e) {
            if (!e.target.closest('.context-menu')) {
                var cm = document.getElementById('contextMenu');
                if (cm) cm.style.display = 'none';
            }
        });

        // 右键菜单项
        var ctxItems = document.querySelectorAll('.context-item');
        for (var c = 0; c < ctxItems.length; c++) {
            ctxItems[c].addEventListener('click', function() {
                self.handleContextAction(this.dataset.action);
            });
        }

        // 右侧面板关闭
        safeOn('btnClosePanel', 'click', function() {
            var ac = document.getElementById('attributeContent');
            if (ac) ac.innerHTML = '<p class="placeholder">点击地图要素查看属性</p>';
        });

        // 模态框关闭
        safeOn('modalOverlay', 'click', function(e) {
            if (e.target === document.getElementById('modalOverlay')) self.closeModal();
        });

        // 键盘快捷键
        document.addEventListener('keydown', function(e) {
            if (e.key === 'Escape') {
                self.closeModal();
                var cm = document.getElementById('contextMenu');
                if (cm) cm.style.display = 'none';
                self._hideLayerActionMenu();
                // 取消几何编辑（最高优先级）
                if (Editor._geomEdit) {
                    Editor._cancelGeometryEdit();
                    self.clearActiveTool();
                    return;
                }
                // 取消测量
                if (MapModule.measureActive) {
                    MapModule.clearMeasure();
                    self.clearActiveTool();
                }
                // 取消绘制
                if (Editor.editMode) {
                    Editor.cancelEdit();
                    self.clearActiveTool();
                }
            }
        });

        // 图层标签点击 → 缩放至图层
        var layerLabels = document.querySelectorAll('.layer-item label');
        for (var i = 0; i < layerLabels.length; i++) {
            layerLabels[i].addEventListener('click', function(e) {
                // 如果点击的是 label，通过关联的 checkbox 找到 layer 名
                var layerItem = this.closest('.layer-item');
                if (layerItem) {
                    var layerName = layerItem.dataset.layer;
                    if (layerName) MapModule.zoomToLayer(layerName);
                }
            });
        }

        // 图层操作按钮 ⋯
        var layerActionBtns = document.querySelectorAll('.layer-action-btn');
        for (var a = 0; a < layerActionBtns.length; a++) {
            layerActionBtns[a].addEventListener('click', function(e) {
                e.stopPropagation();
                self._showLayerActionMenu(this.dataset.layer, this);
            });
        }

        // 图层操作菜单项
        var layerMenuItems = document.querySelectorAll('.layer-menu-item');
        for (var m = 0; m < layerMenuItems.length; m++) {
            layerMenuItems[m].addEventListener('click', function(e) {
                var action = this.dataset.action;
                var menu = document.getElementById('layerActionMenu');
                var layerName = menu ? menu._currentLayer : null;
                self._hideLayerActionMenu();
                if (!layerName) return;
                self._handleLayerAction(action, layerName);
            });
        }

        // 全部范围 和 刷新统计
        safeOn('btnZoomAll', 'click', function() { MapModule.zoomToAll(); });
        safeOn('btnLayerStats', 'click', function() { self._refreshLayerStats(); });

        // 点击其他区域关闭图层菜单
        document.addEventListener('click', function(e) {
            if (!e.target.closest('.layer-action-btn') && !e.target.closest('.layer-action-menu')) {
                self._hideLayerActionMenu();
            }
        });
    },

    _showLayerActionMenu: function(layerName, btn) {
        var menu = document.getElementById('layerActionMenu');
        if (!menu) return;
        var rect = btn.getBoundingClientRect();
        var panel = btn.closest('.panel-content');
        var panelRect = panel ? panel.getBoundingClientRect() : null;
        menu.style.display = 'block';
        menu.style.position = 'fixed';
        menu.style.left = (rect.right + 4) + 'px';
        menu.style.top = rect.top + 'px';
        // 确保菜单不超出面板
        if (panelRect && rect.right + 160 > panelRect.right) {
            menu.style.left = (rect.left - 158) + 'px';
        }
        menu._currentLayer = layerName;
    },

    _hideLayerActionMenu: function() {
        var menu = document.getElementById('layerActionMenu');
        if (menu) { menu.style.display = 'none'; menu._currentLayer = null; }
    },

    _handleLayerAction: function(action, layerName) {
        switch(action) {
            case 'zoom-layer':
                MapModule.zoomToLayer(layerName);
                break;
            case 'export-layer-geojson':
                if (this.currentProjectId) {
                    window.open('/api/export/geojson/' + this.currentProjectId + '?type=' + layerName);
                    this.notify('开始下载 ' + layerName + ' GeoJSON...', 'info');
                }
                break;
            case 'export-layer-csv':
                if (this.currentProjectId) {
                    window.open('/api/export/csv/' + this.currentProjectId + '?type=' + layerName);
                    this.notify('开始下载 ' + layerName + ' CSV...', 'info');
                }
                break;
            case 'show-attrs':
                // 切换到数据面板并高亮对应分类
                var tabBtn = document.querySelector('.tab-btn[data-tab="data"]');
                if (tabBtn) tabBtn.click();
                this.notify('请在数据面板查看 ' + layerName + ' 的属性', 'info');
                break;
        }
    },

    _refreshLayerStats: function() {
        if (!this.currentProjectId) {
            MapModule.updateLayerCounts(null);
            return;
        }
        // 从地图当前图层统计
        MapModule.updateLayerCounts(null);
        this.notify('图层统计已刷新', 'info');
    },

    async loadProjects() {
        try {
            const projects = await api.projects.list();
            const select = document.getElementById('projectSelect');
            select.innerHTML = '<option value="">-- 选择项目 --</option>';
            projects.forEach(p => {
                const option = document.createElement('option');
                option.value = p.id;
                option.textContent = p.name;
                select.appendChild(option);
            });
        } catch (e) {
            console.warn('加载项目列表失败:', e);
        }
    },

    async loadProject(projectId) {
        try {
            document.getElementById('projectSelect').value = projectId;
            this.currentProjectId = projectId;
            const data = await MapModule.loadProjectData(projectId);
            this.updateStatusBar(data);
            this.updateDataPanel();
            this.notify('项目加载成功', 'success');
        } catch (e) {
            this.notify('加载项目失败: ' + e.message, 'error');
        }
    },

    async showNewProjectForm() {
        const content = document.getElementById('modalContent');
        content.innerHTML = `
            <span class="close-btn" onclick="App.closeModal()">✕</span>
            <h2>📁 新建项目</h2>
            <form id="newProjectForm" class="attr-form" onsubmit="return false;">
                <div class="attr-row">
                    <label>项目名称 *</label>
                    <input type="text" name="name" placeholder="例如：西山地质填图" required>
                </div>
                <div class="attr-row">
                    <label>项目区域</label>
                    <input type="text" name="region" placeholder="例如：北京市房山区">
                </div>
                <div class="attr-row">
                    <label>描述</label>
                    <textarea name="description" rows="3" placeholder="项目说明..."></textarea>
                </div>
                <div class="attr-row">
                    <label>坐标系统</label>
                    <select name="crs">
                        <option value="EPSG:4326">WGS84 (EPSG:4326)</option>
                        <option value="EPSG:4490">CGCS2000 (EPSG:4490)</option>
                        <option value="EPSG:3857">Web Mercator (EPSG:3857)</option>
                    </select>
                </div>
                <div class="btn-group">
                    <button type="button" class="btn-primary" onclick="App.createProject()">✅ 创建项目</button>
                    <button type="button" class="btn-secondary" onclick="App.closeModal()">取消</button>
                </div>
            </form>
        `;
        document.getElementById('modalOverlay').style.display = 'flex';
    },

    async createProject() {
        const form = document.getElementById('newProjectForm');
        const formData = new FormData(form);
        const data = Object.fromEntries(formData.entries());

        try {
            const result = await api.projects.create(data);
            this.notify('项目创建成功!', 'success');
            this.closeModal();
            await this.loadProjects();
            document.getElementById('projectSelect').value = result.id;
            this.currentProjectId = result.id;
            this.updateStatusBar();
        } catch (e) {
            this.notify('创建失败: ' + e.message, 'error');
        }
    },

    async showProjectInfo() {
        if (!this.currentProjectId) {
            this.notify('请先选择项目', 'info');
            return;
        }

        try {
            const project = await api.projects.get(this.currentProjectId);
            const content = document.getElementById('modalContent');
            content.innerHTML = `
                <span class="close-btn" onclick="App.closeModal()">✕</span>
                <h2>📋 项目信息</h2>
                <div class="attr-form">
                    <div class="attr-row"><label>名称</label><span>${project.name}</span></div>
                    <div class="attr-row"><label>区域</label><span>${project.region || '--'}</span></div>
                    <div class="attr-row"><label>坐标系统</label><span>${project.crs}</span></div>
                    <div class="attr-row"><label>描述</label><span>${project.description || '--'}</span></div>
                    <div class="attr-row"><label>创建时间</label><span>${project.created_at}</span></div>
                    <hr>
                    <h4>数据统计</h4>
                    <div style="display:grid;grid-template-columns:repeat(2,1fr);gap:8px;">
                        <div>📍 地质点: <b>${project.stats?.point_count || 0}</b></div>
                        <div>🔵 路线: <b>${project.stats?.route_count || 0}</b></div>
                        <div>📷 照片: <b>${project.stats?.photo_count || 0}</b></div>
                        <div>🧪 样品: <b>${project.stats?.sample_count || 0}</b></div>
                    </div>
                    <div class="btn-group" style="margin-top:12px;">
                        <button class="btn-danger" onclick="App.deleteProject(${project.id})">🗑️ 删除项目</button>
                    </div>
                </div>
            `;
            document.getElementById('modalOverlay').style.display = 'flex';
        } catch (e) {
            this.notify('获取项目信息失败: ' + e.message, 'error');
        }
    },

    async deleteProject(projectId) {
        if (!confirm('确定要删除此项目吗？所有关联数据将被永久删除！')) return;

        try {
            await api.projects.delete(projectId);
            this.notify('项目已删除', 'success');
            this.closeModal();
            this.currentProjectId = null;
            MapModule.clearAllLayers();
            await this.loadProjects();
            this.updateStatusBar();
        } catch (e) {
            this.notify('删除失败: ' + e.message, 'error');
        }
    },

    _activeTool: null,

    _setActiveTool: function(action) {
        // 先移除所有旧的 active 类，确保只有一个按钮高亮
        var oldBtns = document.querySelectorAll('.tool-btn.active');
        for (var i = 0; i < oldBtns.length; i++) oldBtns[i].classList.remove('active');
        this._activeTool = action;
        if (action) {
            var btn = document.querySelector('.tool-btn[data-action="' + action + '"]');
            if (btn) btn.classList.add('active');
        }
    },

    clearActiveTool: function() { this._setActiveTool(null); },

    handleToolAction(action) {
        if (!this.currentProjectId && !['new-project', 'import-data'].includes(action)) {
            this.notify('请先选择项目', 'info');
            return;
        }

        var instant = ['edit-feature','delete-feature','import-data',
            'export-geojson','export-csv','export-kml','export-shp',
            'topology-check','data-check','navigate-to-point','gps-add-point'];

        // 清理测量状态、活跃工具、几何编辑
        if (MapModule.measureActive) MapModule.clearMeasure();
        if (Editor._geomEdit) Editor.endGeometryEdit();
        if (this._activeTool) {
            var oldBtn = document.querySelector('.tool-btn[data-action="' + this._activeTool + '"]');
            if (oldBtn) oldBtn.classList.remove('active');
            if (Editor.editMode) Editor.cancelEdit();
            this._activeTool = null;
        }

        if (instant.indexOf(action) === -1) this._setActiveTool(action);

        switch(action) {
            case 'draw-point':       Editor.startDrawPoint(); break;
            case 'draw-line':        Editor.startDrawLine('boundary'); break;
            case 'draw-polygon':     Editor.startDrawPolygon(); break;
            case 'navigate-to-point':this.showNavigateDialog(); break;
            case 'route-navigation': this.showRouteNavDialog(); break;
            case 'edit-feature':     this.notify('右键点击地图上的要素 → 选择"编辑属性"', 'info'); break;
            case 'delete-feature':   this.notify('右键点击地图上的要素 → 选择"删除此要素"', 'info'); break;
            case 'measure-distance': MapModule.startMeasure('distance'); break;
            case 'measure-area':     MapModule.startMeasure('area'); break;
            case 'measure-bearing':  this.measureBearing(); break;
            case 'measure-slope':    MapModule.startSlopeMeasure(); break;
            case 'gps-locate':
                if (MapModule.gpsWatchId) { MapModule.stopGpsTracking(); this._setActiveTool(null); }
                else { MapModule.startGpsTracking(); }
                break;
            case 'gps-add-point':    MapModule.addPointAtMyLocation(); break;
            case 'import-data':      this.showImportDialog(); break;
            case 'export-geojson':   this.exportData('geojson'); break;
            case 'export-csv':       this.exportData('csv'); break;
            case 'export-kml':       this.exportData('kml'); break;
            case 'export-shp':       this.exportData('shp'); break;
            case 'convert-crs':      this.showCrsConvertDialog(); break;
            case 'topology-check':   this.runTopologyCheck(); break;
            case 'data-check':       this.runDataCheck(); break;
        }
    },

    measureBearing() {
        // 先停止之前的测量
        if (MapModule.measureActive) MapModule.stopMeasure();
        MapModule.measureActive = true;
        MapModule._measureType = 'bearing';
        MapModule.measureLayer.clearLayers();

        var self = this;
        var clickHandler1 = function(e1) {
            // 手动移除自身（不用 once，确保 stopMeasure 能清理）
            MapModule.map.off('click', clickHandler1);
            MapModule._measureBearingClick1 = null;
            // 放置起点标记（纳入 measureLayer 管理）
            L.circleMarker(e1.latlng, { radius: 5, color: '#ff6600', fillOpacity: 0.8 })
                .addTo(MapModule.measureLayer).bindPopup('起点');
            // 提示线（从起点到鼠标）
            var hintLine = L.polyline([e1.latlng, e1.latlng], { color: '#ff6600', weight: 1, dashArray: '3,3' })
                .addTo(MapModule.measureLayer);
            var mouseMoveHandler = function(me) {
                hintLine.setLatLngs([e1.latlng, me.latlng]);
            };
            MapModule.map.on('mousemove', mouseMoveHandler);
            MapModule._measureBearingMouseMove = mouseMoveHandler;

            var clickHandler2 = function(e2) {
                // 手动移除自身
                MapModule.map.off('click', clickHandler2);
                MapModule.map.off('mousemove', mouseMoveHandler);
                MapModule._measureBearingClick2 = null;
                MapModule._measureBearingMouseMove = null;
                // 放置终点标记
                L.circleMarker(e2.latlng, { radius: 5, color: '#ff6600', fillOpacity: 0.8 })
                    .addTo(MapModule.measureLayer).bindPopup('终点');
                // 更新提示线为实线
                hintLine.setLatLngs([e1.latlng, e2.latlng]);
                hintLine.setStyle({ color: '#ff6600', weight: 2, dashArray: null });
                var bearing = self.calculateBearing(e1.latlng, e2.latlng);
                var dist = e1.latlng.distanceTo(e2.latlng);
                var el = document.getElementById('measureResult');
                if (el) {
                    el.style.display = 'block';
                    el.textContent = '🧭 方位角: ' + bearing.toFixed(1) + '° | 距离: ' + (dist > 1000 ? (dist/1000).toFixed(2)+'km' : dist.toFixed(1)+'m');
                }
                MapModule.measureActive = false;
                // 1.5 秒后自动清除
                MapModule._measureClearTimer = setTimeout(function() {
                    var el2 = document.getElementById('measureResult');
                    if (el2) el2.style.display = 'none';
                    MapModule.measureLayer.clearLayers();
                    MapModule._measureClearTimer = null;
                    if (typeof App !== 'undefined') App.clearActiveTool();
                }, 1500);
            };
            MapModule.map.on('click', clickHandler2);
            MapModule._measureBearingClick2 = clickHandler2;
        };

        MapModule.map.on('click', clickHandler1);
        MapModule._measureBearingClick1 = clickHandler1;
        this.notify('🧭 单击起点，再单击终点（按 Esc 或切换工具取消）', 'info');
    },

    calculateBearing(p1, p2) {
        const dLon = (p2.lng - p1.lng) * Math.PI / 180;
        const lat1 = p1.lat * Math.PI / 180;
        const lat2 = p2.lat * Math.PI / 180;
        const y = Math.sin(dLon) * Math.cos(lat2);
        const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon);
        let bearing = Math.atan2(y, x) * 180 / Math.PI;
        return (bearing + 360) % 360;
    },

    // ===== 导航至调查点 =====
    async showNavigateDialog() {
        if (!this.currentProjectId) { this.notify('请先选择项目', 'info'); return; }

        var content = document.getElementById('modalContent');
        content.innerHTML = '<div style="text-align:center;padding:24px;color:var(--fill-tertiary)">加载调查点列表...</div>';
        document.getElementById('modalOverlay').style.display = 'flex';

        try {
            var data = await api.projects.overview(this.currentProjectId);
            var points = data.points || [];
            var routes = data.routes || [];

            content.innerHTML = ''
                + '<span class="close-btn" onclick="App.closeModal()">✕</span>'
                + '<h2>🧭 导航至调查点</h2>'
                + '<div style="margin-bottom:12px">'
                + '<input type="text" id="navSearch" placeholder="搜索编号或类型..." '
                + 'style="width:100%;padding:8px 10px;border-radius:6px;border:0.5px solid var(--separator);'
                + 'background:#fff;font-size:13px;font-family:inherit" oninput="App.filterNavList()">'
                + '</div>'
                + '<div id="navList" style="max-height:360px;overflow-y:auto">'
                + this._buildNavList(points, routes)
                + '</div>';

            this._navData = { points: points, routes: routes };
        } catch(e) {
            content.innerHTML = '<span class="close-btn" onclick="App.closeModal()">✕</span>'
                + '<h2>🧭 导航至调查点</h2>'
                + '<p style="color:var(--danger);padding:16px">加载失败: ' + e.message + '</p>';
        }
    },

    _buildNavList: function(points, routes, filter) {
        filter = (filter || '').toLowerCase();
        var html = '';

        if (routes.length > 0) {
            html += '<h4 style="font-size:11px;font-weight:600;color:var(--fill-tertiary);margin:8px 0 4px;padding:4px 0;border-bottom:0.5px solid var(--separator)">🔵 野外路线 (' + routes.length + ')</h4>';
            routes.forEach(function(r) {
                if (filter && r.name.toLowerCase().indexOf(filter) === -1) return;
                var flat = '--', flng = '--';
                if (r.route_geom) {
                    try { var coords = MapModule._parseRouteGeom(r.route_geom); if (coords && coords.length) { flat = coords[0][0]; flng = coords[0][1]; } } catch(e) {}
                }
                html += '<div class="nav-item" onclick="App.navigateToFeature(\'route\',' + r.id + ',' + flat + ',' + flng + ')" style="padding:8px 10px;margin:2px 0;border-radius:6px;cursor:pointer">'
                    + '<span><b>' + r.name + '</b> <span style="color:var(--fill-tertiary)">' + (r.route_date || '') + '</span></span>'
                    + '<span style="color:var(--fill-tertiary);font-size:11px;float:right">起点 ' + (typeof flat==='number'?flat.toFixed(5):flat) + ',' + (typeof flng==='number'?flng.toFixed(5):flng) + '</span>'
                    + '</div>';
            });
        }

        html += '<h4 style="font-size:11px;font-weight:600;color:var(--fill-tertiary);margin:12px 0 4px;padding:4px 0;border-bottom:0.5px solid var(--separator)">📍 地质点 (' + points.length + ')</h4>';
        if (points.length === 0) {
            html += '<p style="color:var(--fill-tertiary);text-align:center;padding:20px">暂无调查点数据</p>';
        } else {
            points.forEach(function(p) {
                if (filter && (p.point_number+'').toLowerCase().indexOf(filter) === -1 && (p.point_type+'').toLowerCase().indexOf(filter) === -1) return;
                html += '<div class="nav-item" onclick="App.navigateToFeature(\'point\',' + p.id + ',' + p.latitude + ',' + p.longitude + ')" style="padding:8px 10px;margin:2px 0;border-radius:6px;cursor:pointer;transition:all 0.15s;display:flex;justify-content:space-between;align-items:center;font-size:12px">'
                    + '<span><b>' + p.point_number + '</b> <span style="color:var(--fill-tertiary)">' + (p.point_type || '') + '</span></span>'
                    + '<span style="color:var(--fill-tertiary);font-size:11px">' + p.latitude.toFixed(5) + ',' + p.longitude.toFixed(5) + '</span>'
                    + '</div>';
            });
        }
        return html;
    },

    filterNavList: function() {
        var filter = document.getElementById('navSearch').value;
        var list = document.getElementById('navList');
        if (list && this._navData) {
            list.innerHTML = this._buildNavList(this._navData.points, this._navData.routes, filter);
            // hover effect
            var items = list.querySelectorAll('.nav-item');
            for (var i = 0; i < items.length; i++) {
                items[i].addEventListener('mouseenter', function() { this.style.background = 'var(--fill-quinary)'; });
                items[i].addEventListener('mouseleave', function() { this.style.background = 'transparent'; });
            }
        }
    },

    navigateToFeature: function(type, id, lat, lng) {
        this.closeModal();
        MapModule.flyToFeature(type, id, lat, lng);
    },

    // ===== 路径导航 =====

    showRouteNavDialog: function() {
        // 委托给 Navigation 模块
        if (typeof Navigation !== 'undefined') {
            Navigation.show();
        } else {
            this.notify('导航模块未加载', 'error');
        }
    },

    async openPrintLayout() {
        if (!this.currentProjectId) {
            this.notify('请先选择项目', 'info');
            return;
        }

        var mapEl = document.getElementById('map');
        var mapContainer = mapEl ? mapEl.parentElement : null;
        var bounds = MapModule.map.getBounds();
        
        // 保存可见图层配置 + 项目数据 + 地图地理范围（用于比例尺计算）
        var state = {
            projectId: this.currentProjectId,
            center: [MapModule.map.getCenter().lat, MapModule.map.getCenter().lng],
            zoom: MapModule.map.getZoom(),
            baseMap: MapModule._currentBaseMap || 'amap',
            visibleLayers: {
                points: document.getElementById('layerPoints')?.checked ?? true,
                routes: document.getElementById('layerRoutes')?.checked ?? true,
                boundaries: document.getElementById('layerBoundaries')?.checked ?? true,
                faults: document.getElementById('layerFaults')?.checked ?? true,
                areas: document.getElementById('layerAreas')?.checked ?? true,
                photos: document.getElementById('layerPhotos')?.checked ?? true,
            },
            // 存储地图容器像素尺寸和地理范围，供比例尺计算
            mapPixelSize: {
                width: mapContainer ? mapContainer.clientWidth : (mapEl ? mapEl.clientWidth : 800),
                height: mapContainer ? mapContainer.clientHeight : (mapEl ? mapEl.clientHeight : 600)
            },
            mapBounds: {
                north: bounds.getNorth(),
                south: bounds.getSouth(),
                east: bounds.getEast(),
                west: bounds.getWest()
            }
        };
        sessionStorage.setItem('printLayoutState', JSON.stringify(state));

        // 截图地图区域（JPEG 格式，避免 sessionStorage 超限）
        this.notify('正在生成地图快照...', 'info');
        try {
            if (!window.html2canvas) {
                await new Promise(function(resolve, reject) {
                    var s = document.createElement('script');
                    s.src = 'https://cdn.jsdelivr.net/npm/html2canvas@1.4.1/dist/html2canvas.min.js';
                    s.onload = resolve; s.onerror = function() { reject(new Error('html2canvas 加载失败')); };
                    document.head.appendChild(s);
                });
            }
            var mapEl = document.getElementById('map');
            if (mapEl && window.html2canvas) {
                var canvas = await html2canvas(mapEl, {
                    useCORS: true,
                    allowTaint: true,    // 允许跨域瓦片（高德/ESRI 无 CORS 头）
                    backgroundColor: '#ffffff',
                    scale: 1,
                    logging: false,
                });
                // 如果截图太大，先缩放
                var maxW = 1600;
                if (canvas.width > maxW) {
                    var ratio = maxW / canvas.width;
                    var small = document.createElement('canvas');
                    small.width = maxW; small.height = Math.round(canvas.height * ratio);
                    var sctx = small.getContext('2d');
                    sctx.drawImage(canvas, 0, 0, small.width, small.height);
                    canvas = small;
                }
                // 用 JPEG 格式（比 PNG 小 5-10 倍）
                var dataUrl = canvas.toDataURL('image/jpeg', 0.85);
                try {
                    sessionStorage.setItem('mapSnapshot', dataUrl);
                } catch(se) {
                    // sessionStorage 满了，降质量重试
                    dataUrl = canvas.toDataURL('image/jpeg', 0.5);
                    try { sessionStorage.setItem('mapSnapshot', dataUrl); }
                    catch(se2) { throw new Error('截图过大，存储失败。请缩小浏览器窗口后重试。'); }
                }
                this.notify('地图快照已生成', 'success');
            }
        } catch(e) {
            this.notify('地图截图失败: ' + (e.message || e), 'error');
            console.error('地图截图失败:', e);
        }

        // 获取项目数据存起来（供图例使用）
        try {
            var data = await api.projects.overview(this.currentProjectId);
            sessionStorage.setItem('printProjectData', JSON.stringify(data));
        } catch(e) {}

        // 直接在主界面打开出图面板
        PrintPanel.open();
    },

    showImportDialog() {
        var content = document.getElementById('modalContent');
        content.innerHTML = ''
            + '<span class="close-btn" onclick="App.closeModal()">✕</span>'
            + '<h2>📥 导入数据</h2>'
            + '<div style="display:flex;gap:16px;min-height:320px">'
            // 左栏：格式选择
            + '<div style="flex:1;border-right:0.5px solid var(--separator);padding-right:12px">'
            + '<h4 style="margin-bottom:8px;font-size:12px;color:var(--fill-tertiary)">选择格式</h4>'
            + '<div id="importFormatList" style="display:flex;flex-direction:column;gap:4px">'
            + ['📦 Shapefile (.shp)|shapefile|.shp,.dbf,.shx,.prj',
               '📄 GeoJSON (.geojson)|geojson|.geojson,.json',
               '📊 CSV (.csv)|csv|.csv',
               '🌐 KML / KMZ (.kml)|kml|.kml,.kmz',
               '🛰️ GPX (.gpx)|gpx|.gpx']
              .map(function(opt) { var p = opt.split('|'); return '<label class="import-format-item" style="display:flex;align-items:center;gap:8px;padding:8px 10px;border-radius:6px;cursor:pointer;border:1px solid transparent" onmouseenter="this.style.background=\'var(--fill-quinary)\'" onmouseleave="if(!this.classList.contains(\'active\'))this.style.background=\'transparent\'"><input type="radio" name="importFormat" value="' + p[1] + '" data-accept="' + p[2] + '" onchange="App._onImportFormatChange(this)">' + p[0] + '</label>'; }).join('')
            + '</div>'
            + '</div>'
            // 右栏：目标类型 + 文件
            + '<div style="flex:2;padding-left:4px">'
            + '<h4 style="margin-bottom:8px;font-size:12px;color:var(--fill-tertiary)">导入设置</h4>'
            + '<div class="attr-form">'
            + '<div class="attr-row"><label>导入目标 *</label>'
            + '<select id="importTargetType" required onchange="App._updateImportAccept()">'
            + '<option value="">-- 请选择 --</option>'
            + '<option value="geo_points">📍 地质点 (geological_points)</option>'
            + '<option value="routes">🔵 野外路线 (field_routes)</option>'
            + '<option value="boundaries">🟤 地质界线 (geological_boundaries)</option>'
            + '<option value="faults">🔴 断层 (faults)</option>'
            + '<option value="areas">🟡 地层面 (geological_areas)</option>'
            + '</select></div>'
            + '<div class="attr-row"><label>选择文件</label>'
            + '<input type="file" id="importFile" accept=".shp,.dbf,.shx,.prj,.geojson,.json,.csv,.kml,.kmz,.gpx" multiple onchange="App._onImportFileSelected()"></div>'
            + '<div id="importPreview" style="max-height:220px;overflow-y:auto;font-size:11px;margin-top:8px;display:none"></div>'
            + '<div class="btn-group" style="margin-top:12px">'
            + '<button class="btn-primary" onclick="App.doImport()">📥 开始导入</button>'
            + '<button class="btn-secondary" onclick="App._previewImport()">🔍 预览</button>'
            + '</div></div></div></div>';
        document.getElementById('modalOverlay').style.display = 'flex';
        // 默认选中第一个格式
        var first = document.querySelector('input[name="importFormat"]');
        if (first) first.checked = true;
    },

    _onImportFormatChange: function(radio) {
        var fileInput = document.getElementById('importFile');
        if (fileInput) fileInput.accept = radio.dataset.accept;
    },

    _updateImportAccept: function() {
        var target = document.getElementById('importTargetType');
        var fileInput = document.getElementById('importFile');
        if (!target || !fileInput) return;
        // 路线类型时推荐 GPX
        if (target.value === 'routes') {
            fileInput.accept = '.gpx,.geojson,.json,.kml';
        }
    },

    _onImportFileSelected: function() {
        // 文件选择后自动检测格式
        var fileInput = document.getElementById('importFile');
        if (!fileInput || !fileInput.files || fileInput.files.length === 0) return;
        var name = fileInput.files[0].name.toLowerCase();
        var format = null;
        if (name.endsWith('.shp') || name.endsWith('.dbf')) format = 'shapefile';
        else if (name.endsWith('.geojson') || name.endsWith('.json')) format = 'geojson';
        else if (name.endsWith('.csv')) format = 'csv';
        else if (name.endsWith('.kml') || name.endsWith('.kmz')) format = 'kml';
        else if (name.endsWith('.gpx')) format = 'gpx';
        if (format) {
            var radio = document.querySelector('input[name="importFormat"][value="' + format + '"]');
            if (radio) radio.checked = true;
        }
    },

    async _previewImport() {
        var fileInput = document.getElementById('importFile');
        if (!fileInput || !fileInput.files || fileInput.files.length === 0) {
            this.notify('请先选择文件', 'info'); return;
        }
        if (!this.currentProjectId) {
            this.notify('请先选择项目', 'info'); return;
        }
        var targetType = document.getElementById('importTargetType');
        if (!targetType || !targetType.value) {
            this.notify('请选择导入目标类型', 'info'); return;
        }

        var formData = new FormData();
        for (var i = 0; i < fileInput.files.length; i++) {
            formData.append('files', fileInput.files[i]);
        }
        formData.append('project_id', String(this.currentProjectId));
        formData.append('target_type', targetType.value);

        try {
            var result = await api.sync.importPreview(formData);
            this._showImportPreview(result);
        } catch (e) {
            this.notify('预览失败: ' + (e.message || e), 'error');
        }
    },

    _showImportPreview: function(data) {
        var container = document.getElementById('importPreview');
        if (!container) return;
        container.style.display = 'block';
        var html = '';
        html += '<div style="padding:4px 0;color:var(--fill-tertiary);border-bottom:0.5px solid var(--separator);margin-bottom:4px">';
        html += '格式: <b>' + (data.format || '?') + '</b> | 目标: <b>' + (data.target_type || '?') + '</b> | ';
        html += '共 <b>' + (data.total_points || 0) + '</b> 点, <b>' + (data.total_lines || 0) + '</b> 线, <b>' + (data.total_polygons || 0) + '</b> 面';
        if (data.total_routes) html += ', <b>' + data.total_routes + '</b> 路线';
        html += '</div>';

        if (data.column_mapping) {
            html += '<div style="font-size:10px;color:var(--accent);margin:4px 0">列映射: ' + JSON.stringify(data.column_mapping) + '</div>';
        }

        // 预览前几条
        var points = data.preview_points || [];
        if (points.length > 0) {
            html += '<table style="width:100%;border-collapse:collapse;font-size:10px"><thead><tr>';
            var keys = Object.keys(points[0]).slice(0, 6);
            keys.forEach(function(k) { html += '<th style="text-align:left;padding:2px 4px;border-bottom:1px solid var(--separator);color:var(--fill-tertiary)">' + k + '</th>'; });
            html += '</tr></thead><tbody>';
            points.slice(0, 8).forEach(function(p) {
                html += '<tr>';
                keys.forEach(function(k) { html += '<td style="padding:2px 4px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:100px">' + (p[k] != null ? String(p[k]).substring(0, 40) : '') + '</td>'; });
                html += '</tr>';
            });
            if (points.length > 8) html += '<tr><td colspan="' + keys.length + '" style="color:var(--fill-tertiary);text-align:center;padding:4px">... 共 ' + (data.total_points || points.length) + ' 条</td></tr>';
            html += '</tbody></table>';
        } else {
            html += '<p style="color:var(--fill-tertiary);text-align:center;padding:12px">文件解析成功，点击"开始导入"执行</p>';
        }
        container.innerHTML = html;
    },

    async doImport() {
        var fileInput = document.getElementById('importFile');
        if (!fileInput || !fileInput.files || fileInput.files.length === 0) {
            this.notify('请先选择文件再导入', 'error'); return;
        }
        if (!this.currentProjectId) {
            this.notify('请先选择项目', 'error'); return;
        }
        var targetType = document.getElementById('importTargetType');
        if (!targetType || !targetType.value) {
            this.notify('请选择导入目标类型', 'error'); return;
        }
        var formData = new FormData();
        var fileCount = fileInput.files.length;
        for (var i = 0; i < fileCount; i++) {
            formData.append('files', fileInput.files[i]);
        }
        formData.append('project_id', String(this.currentProjectId));
        formData.append('target_type', targetType.value);

        // Disable import button to prevent double-click
        var importBtn = document.querySelector('#modalContent .btn-primary');
        if (importBtn) { importBtn.disabled = true; importBtn.textContent = '⏳ 导入中...'; }

        try {
            var result = await api.sync.importFiles(formData);
            this.notify(result.message || '导入完成: ' + (result.imported_count || 0) + ' 条', 'success');
            // Reset file input so user can re-import the same files if needed
            fileInput.value = '';
            // Hide preview
            var preview = document.getElementById('importPreview');
            if (preview) { preview.style.display = 'none'; preview.innerHTML = ''; }
            this.closeModal();
            if (this.currentProjectId) { await MapModule.loadProjectData(this.currentProjectId); }
            this.updateStatusBar();
            this.updateDataPanel();
        } catch (e) {
            var msg = e.message || String(e);
            if (msg.indexOf('Failed to fetch') >= 0 || msg.indexOf('NetworkError') >= 0) {
                msg = '无法连接后端！请确保 python backend/app.py 已启动';
            }
            this.notify('导入失败: ' + msg, 'error');
        } finally {
            if (importBtn) { importBtn.disabled = false; importBtn.textContent = '📥 开始导入'; }
        }
    },

    exportData(format) {
        if (!this.currentProjectId) return;

        switch(format) {
            case 'geojson':
                window.open(api.export.geojsonUrl(this.currentProjectId));
                break;
            case 'csv':
                window.open(api.export.csvUrl(this.currentProjectId));
                break;
            case 'kml':
                window.open(api.export.kmlUrl(this.currentProjectId));
                break;
            case 'shp':
                window.open(api.export.shpUrl(this.currentProjectId));
                break;
        }
        this.notify(`开始下载 ${format.toUpperCase()} 文件...`, 'info');
    },

    showCrsConvertDialog() {
        var self = this;
        var modal = document.getElementById('modalOverlay');
        var content = document.getElementById('modalContent');
        content.innerHTML = `
            <h2>🗺️ 坐标转换 <small style="color:#718096;font-size:13px;">CGCS2000 ↔ WGS84 ↔ Web Mercator</small></h2>
            <div class="form-group"><label>源坐标系</label>
                <select id="crsFrom"><option value="EPSG:4326">WGS84 (GPS经纬度)</option>
                <option value="EPSG:4490">CGCS2000 大地坐标系</option>
                <option value="EPSG:3857">Web Mercator (米)</option></select></div>
            <div class="form-group"><label>目标坐标系</label>
                <select id="crsTo"><option value="EPSG:4490">CGCS2000 大地坐标系</option>
                <option value="EPSG:4326">WGS84 (GPS经纬度)</option>
                <option value="EPSG:3857">Web Mercator (米)</option></select></div>
            <div class="form-group"><label>输入坐标（每行一个：经度,纬度 或 X,Y）</label>
                <textarea id="crsInput" rows="4" placeholder="例: 103.834, 36.061" style="width:100%;background:var(--fill-tertiary);color:var(--fill-primary);border:1px solid var(--separator);border-radius:4px;padding:8px;"></textarea></div>
            <div class="modal-buttons">
                <button onclick="App.doConvertCrs()">🔄 转换</button>
                <button class="cancel" onclick="App.closeModal()">关闭</button>
            </div>
            <div id="crsResult" style="margin-top:12px;padding:10px;background:var(--fill-quaternary);border-radius:4px;min-height:40px;"></div>`;
        modal.style.display = 'flex';
    },

    async doConvertCrs() {
        var from = document.getElementById('crsFrom').value;
        var to = document.getElementById('crsTo').value;
        var raw = document.getElementById('crsInput').value.trim();
        var resultDiv = document.getElementById('crsResult');

        if (!raw) { resultDiv.innerHTML = '<span style="color:#feb2b2;">请输入坐标</span>'; return; }

        var lines = raw.split('\n').filter(function(l) { return l.trim(); });
        var points = [];
        for (var i = 0; i < lines.length; i++) {
            var parts = lines[i].split(/[,，\s]+/);
            if (parts.length >= 2) {
                points.push([parseFloat(parts[0]), parseFloat(parts[1])]);
            }
        }
        if (points.length === 0) { resultDiv.innerHTML = '<span style="color:#feb2b2;">无法解析坐标</span>'; return; }

        resultDiv.innerHTML = '⏳ 转换中...';
        try {
            var resp = await fetch('/api/export/convert-coords', {
                method: 'POST', headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({points: points, from_crs: from, to_crs: to})
            });
            var data = await resp.json();
            if (data.error) { resultDiv.innerHTML = '<span style="color:#feb2b2;">' + data.error + '</span>'; return; }
            var html = '<b>转换结果 (' + data.from_crs + ' → ' + data.to_crs + ')</b><br>';
            for (var j = 0; j < data.points.length; j++) {
                var r = data.points[j];
                html += (j+1) + '. X: ' + r.x + '  Y: ' + r.y + '<br>';
            }
            resultDiv.innerHTML = html;
        } catch(e) {
            resultDiv.innerHTML = '<span style="color:#feb2b2;">转换失败: ' + (e.message || e) + '</span>';
        }
    },

    async runTopologyCheck() {
        if (!this.currentProjectId) return;

        try {
            const [boundaryResult, areaResult] = await Promise.all([
                api.boundaries.topologyCheck(this.currentProjectId),
                api.areas.topologyCheck(this.currentProjectId),
            ]);

            const issues = [...boundaryResult.issues, ...areaResult.issues];
            const content = document.getElementById('modalContent');

            content.innerHTML = `
                <span class="close-btn" onclick="App.closeModal()">✕</span>
                <h2>🔍 拓扑检查结果</h2>
                <p style="color:var(--text-secondary);margin-bottom:12px;">
                    共发现 <b style="color:${issues.length > 0 ? 'var(--danger)' : 'var(--success)'}">${issues.length}</b> 个问题
                </p>
                ${issues.length === 0 ? '<p>✅ 拓扑检查通过！</p>' : ''}
                ${issues.map(i => `
                    <div style="padding:8px;margin:4px 0;background:rgba(255,0,0,0.1);border-radius:4px;">
                        <b>${i.type}:</b> ${i.message}
                    </div>
                `).join('')}
            `;
            document.getElementById('modalOverlay').style.display = 'flex';
        } catch (e) {
            this.notify('拓扑检查失败: ' + e.message, 'error');
        }
    },

    async runDataCheck() {
        if (!this.currentProjectId) return;

        try {
            const result = await api.sync.checkData(this.currentProjectId);

            const content = document.getElementById('modalContent');
            content.innerHTML = `
                <span class="close-btn" onclick="App.closeModal()">✕</span>
                <h2>✅ 数据完整性检查</h2>
                <p style="color:var(--text-secondary);margin-bottom:12px;">
                    ${result.is_complete ? '✅ 数据完整，无异常' : `⚠️ 发现 ${result.total_issues} 个问题`}
                </p>
                ${result.issues.map(i => `
                    <div style="padding:8px;margin:4px 0;background:rgba(255,165,0,0.15);border-radius:4px;">
                        <b>${i.type}:</b> ${i.message}
                    </div>
                `).join('')}
            `;
            document.getElementById('modalOverlay').style.display = 'flex';
        } catch (e) {
            this.notify('数据检查失败: ' + e.message, 'error');
        }
    },

    handleContextAction(action) {
        var f = MapModule.selectedFeature;
        var latlng = MapModule._contextLatLng;
        document.getElementById('contextMenu').style.display = 'none';
        if (!f && action !== 'navigate-to' && action !== 'copy-coords') {
            this.notify('未选中要素，请右键点击要素', 'warning');
            return;
        }

        switch(action) {
            case 'edit-feature':
                if (f.geoPointId) Editor.editPoint(f.geoPointId);
                else if (f.routeId) Editor.editRoute(f.routeId);
                else if (f.boundaryId) Editor.editBoundary(f.boundaryId);
                else if (f.faultId) Editor.editFault(f.faultId);
                else if (f.areaId) Editor.editArea(f.areaId);
                else this.notify('该要素暂不支持编辑', 'info');
                break;
            case 'edit-geometry':
                if (f.routeId) Editor.startGeometryEdit('route', f.routeId);
                else if (f.boundaryId) Editor.startGeometryEdit('boundary', f.boundaryId);
                else if (f.faultId) Editor.startGeometryEdit('fault', f.faultId);
                else if (f.areaId) Editor.startGeometryEdit('area', f.areaId);
                else this.notify('该要素暂不支持几何编辑', 'info');
                break;
            case 'delete-point':
                if (f.geoPointId) Editor.deleteFeature('point', f.geoPointId);
                else if (f.boundaryId) Editor.deleteFeature('boundary', f.boundaryId);
                else if (f.faultId) Editor.deleteFeature('fault', f.faultId);
                else if (f.areaId) Editor.deleteFeature('area', f.areaId);
                else if (f.routeId) Editor.deleteFeature('route', f.routeId);
                else this.notify('无法识别要删除的要素类型', 'error');
                break;
            case 'navigate-to':
                if (latlng) {
                    MapModule.map.setView(latlng, 16);
                    L.circleMarker(latlng, { radius: 8, color: '#ff4444', fillOpacity: 0.5 })
                        .addTo(MapModule.map).bindPopup('导航目标');
                }
                break;
            case 'copy-coords':
                if (latlng) {
                    var text = latlng.lat.toFixed(6) + ', ' + latlng.lng.toFixed(6);
                    navigator.clipboard.writeText(text).then(function() {
                        App.notify('坐标已复制: ' + text, 'info');
                    });
                }
                break;
        }
    },

    async checkApiStatus() {
        try {
            var health = await api.health();
            var el = document.getElementById('apiStatus');
            el.textContent = 'API: OK';
            el.style.color = '#34c759';
            el.title = 'http://localhost:5002';
        } catch (e) {
            var el = document.getElementById('apiStatus');
            el.textContent = 'API: 离线! 请访问 http://localhost:5002/desktop/';
            el.style.color = '#ff3b30';
            el.style.fontWeight = 'bold';
            el.style.fontSize = '12px';
        }
    },

    async updateStatusBar(data) {
        if (!this.currentProjectId) {
            document.getElementById('pointCount').textContent = '地质点: --';
            document.getElementById('routeCount').textContent = '路线: --';
            return;
        }

        try {
            if (!data) {
                const stats = await api.sync.status(this.currentProjectId);
                document.getElementById('pointCount').textContent = `地质点: ${stats.points_total}`;
                document.getElementById('routeCount').textContent = `路线: ${stats.routes_total}`;
                document.getElementById('featureCount').textContent =
                    `照片: ${stats.photos_total} | 样品: ${stats.samples_total}`;
            } else {
                document.getElementById('pointCount').textContent = `地质点: ${data.points?.length || 0}`;
                document.getElementById('routeCount').textContent = `路线: ${data.routes?.length || 0}`;
            }
        } catch (e) {}
    },

    selectFeature(type, id) {
        if (type === 'point') {
            Editor.showPointDetail(id);
        }
    },

    // ===== 数据管理面板 =====
    refreshDataPanel: function() {
        if (!this.currentProjectId) {
            document.getElementById('dataPanelContent').innerHTML = '<p class="placeholder">请先选择项目</p>';
            return;
        }
        // 从地图当前渲染的数据刷新
        this._renderDataPanel();
    },

    _dataPanelDirty: true,

    updateDataPanel: function() {
        this._dataPanelDirty = true;
        // 如果当前在数据面板，立即刷新
        var panel = document.getElementById('tab-data');
        if (panel && panel.classList.contains('active')) {
            this._renderDataPanel();
        }
    },

    _renderDataPanel: function() {
        var container = document.getElementById('dataPanelContent');
        if (!container) return;
        var html = '';
        var total = 0;

        var layers = MapModule.layers;
        var categories = [
            { key: 'points',     name: '地质点', icon: '📍', color: '#0066ff', dType: 'point' },
            { key: 'routes',     name: '野外路线', icon: '🔵', color: '#3388ff', dType: 'route' },
            { key: 'boundaries', name: '地质界线', icon: '🟤', color: '#8b4513', dType: 'boundary' },
            { key: 'faults',     name: '断层',     icon: '🔴', color: '#ff0000', dType: 'fault' },
            { key: 'areas',      name: '地层面',   icon: '🟡', color: '#ffd700', dType: 'area' },
        ];

        categories.forEach(function(cat) {
            var layer = layers[cat.key];
            if (!layer) return;
            var items = [];
            layer.eachLayer(function(f) {
                var id = f.geoPointId || f.routeId || f.boundaryId || f.faultId || f.areaId;
                if (id == null) return;  // 跳过无ID要素
                // 优先使用 featureLabel（名称+类型），其次用坐标或 ID
                var label = f.featureLabel || '';
                if (!label) {
                    if (f.geoPointId) {
                        var ll = f.getLatLng ? f.getLatLng() : null;
                        label = ll ? ll.lat.toFixed(5) + ', ' + ll.lng.toFixed(5) : '点#' + f.geoPointId;
                    } else if (f.routeId) {
                        label = '路线#' + f.routeId;
                    } else if (f.boundaryId) {
                        label = '界线#' + f.boundaryId;
                    } else if (f.faultId) {
                        label = '断层#' + f.faultId;
                    } else if (f.areaId) {
                        label = '面#' + f.areaId;
                    }
                }
                items.push({ id: id, label: label, cat: cat.key, dType: cat.dType });
            });
            total += items.length;

            if (items.length > 0) {
                html += '<div style="margin-bottom:4px">';
                html += '<div style="font-size:10px;font-weight:600;color:var(--fill-tertiary);padding:3px 0;border-bottom:0.5px solid var(--separator);margin-bottom:2px">' + cat.icon + ' ' + cat.name + ' (' + items.length + ')</div>';
                items.forEach(function(item) {
                    html += '<div class="data-item" style="padding:3px 6px;margin:1px 0;border-radius:4px;font-size:11px;display:flex;justify-content:space-between;align-items:center">'
                        + '<span onclick="App._flyToDataItem(\'' + item.cat + '\',' + item.id + ')" style="cursor:pointer;flex:1;color:' + cat.color + ';font-weight:500">' + item.label + '</span>'
                        + '<span style="display:flex;gap:1px">'
                        + '<button onclick="App._editDataItem(\'' + item.dType + '\',' + item.id + ')" style="border:none;background:none;cursor:pointer;font-size:12px;padding:1px 3px;color:var(--accent)" title="编辑">✏️</button>'
                        + '<button onclick="App._deleteDataItem(\'' + item.dType + '\',' + item.id + ')" style="border:none;background:none;cursor:pointer;font-size:12px;padding:1px 3px;color:var(--danger)" title="删除">🗑️</button>'
                        + '</span></div>';
                });
                html += '</div>';
            }
        });

        if (total === 0) {
            html = '<p class="placeholder">暂无数据<br>请导入或创建要素</p>';
        }

        container.innerHTML = html;

        // 悬停效果
        var items = container.querySelectorAll('.data-item');
        for (var i = 0; i < items.length; i++) {
            items[i].addEventListener('mouseenter', function() { this.style.background = 'var(--fill-quinary)'; });
            items[i].addEventListener('mouseleave', function() { this.style.background = 'transparent'; });
        }

        this._dataPanelDirty = false;
    },

    _editDataItem: function(type, id) {
        if (!id) { this.notify('无法识别该要素', 'error'); return; }
        if (type === 'point') {
            Editor.editPoint(id);
        } else if (type === 'route') {
            Editor.editRoute(id);
        } else if (type === 'boundary') {
            Editor.editBoundary(id);
        } else if (type === 'fault') {
            Editor.editFault(id);
        } else if (type === 'area') {
            Editor.editArea(id);
        } else {
            this.notify('不支持的要素类型: ' + type, 'error');
        }
    },

    _deleteDataItem: function(type, id) {
        if (!id) { this.notify('无法识别该要素', 'error'); return; }
        if (!confirm('确定删除此要素？此操作不可撤销。')) return;
        var apiMap = {
            point: api.points, route: api.routes, boundary: api.boundaries,
            fault: api.faults, area: api.areas
        };
        var fn = apiMap[type];
        if (!fn) { this.notify('不支持的要素类型: ' + type, 'error'); return; }
        var self = this;
        fn.delete(id).then(function() {
            self.notify('已删除', 'success');
            if (self.currentProjectId) {
                MapModule.loadProjectData(self.currentProjectId).then(function() {
                    self.updateDataPanel(); self.updateStatusBar();
                });
            }
        }).catch(function(e) {
            var msg = e.message || String(e);
            if (msg.indexOf('Unexpected token') >= 0 || msg.indexOf('<!doctype') >= 0) {
                msg = '后端未启动，请运行 python backend/app.py';
            }
            self.notify('删除失败: ' + msg, 'error');
        });
    },

    _flyToDataItem: function(cat, id) {
        var layer = MapModule.layers[cat];
        if (!layer) return;
        layer.eachLayer(function(f) {
            var fid = f.geoPointId || f.routeId || f.boundaryId || f.faultId || f.areaId;
            if (fid === id) {
                if (f.getLatLng) {
                    MapModule.map.flyTo(f.getLatLng(), 16, { duration: 0.8 });
                } else if (f.getBounds) {
                    MapModule.map.flyToBounds(f.getBounds(), { padding: [50, 50], duration: 0.8 });
                } else if (f.getLatLngs) {
                    var ll = f.getLatLngs();
                    if (Array.isArray(ll[0])) ll = ll[0];
                    if (ll.length) MapModule.map.flyTo(L.latLng(ll[0]), 16, { duration: 0.8 });
                }
            }
        });
    },

    closeModal() {
        document.getElementById('modalOverlay').style.display = 'none';
    },

    // ===== 地层单元管理 =====
    showStrataPanel() {
        var btns = document.querySelectorAll('.tab-btn');
        var contents = document.querySelectorAll('.tab-content');
        for (var j = 0; j < btns.length; j++) btns[j].classList.remove('active');
        for (var k = 0; k < contents.length; k++) contents[k].classList.remove('active');
        var btn = document.querySelector('.tab-btn[data-tab="strata"]');
        if (btn) btn.classList.add('active');
        var tabEl = document.getElementById('tab-strata');
        if (tabEl) tabEl.classList.add('active');
        this.loadStrataList();
    },

    async loadStrataList() {
        const container = document.getElementById('strataList');
        if (!this.currentProjectId) {
            container.innerHTML = '<p style="color:var(--fill-secondary);padding:10px">请先选择项目</p>';
            return;
        }
        try {
            const strata = await api.strata.list(this.currentProjectId);
            if (strata.length === 0) {
                container.innerHTML = '<p style="color:var(--fill-secondary);padding:10px">暂无地层单元，点击添加地层</p>';
                return;
            }
            container.innerHTML = strata.map(s => `
                <div style="padding:8px;margin-bottom:6px;border-radius:6px;background:var(--bg-tertiary);border-left:4px solid ${s.color || '#808080'}">
                    <div style="display:flex;justify-content:space-between;align-items:center">
                        <b>${s.code}</b>
                        <span style="font-size:0.85em;color:var(--fill-secondary)">${s.stratigraphic_age || ''}</span>
                    </div>
                    <div style="font-weight:600;margin:4px 0">${s.name}</div>
                    <div style="font-size:0.85em;color:var(--fill-secondary);display:flex;gap:8px;flex-wrap:wrap">
                        <span>岩性: ${s.lithology || '--'}</span>
                        <span>厚度: ${s.thickness_min || 0}-${s.thickness_max || 0}m</span>
                        <span>${s.contact_type || ''}</span>
                    </div>
                    <div style="display:flex;gap:6px;margin-top:6px">
                        <button onclick="App.editStratum(${s.id})" style="flex:1;padding:4px;border-radius:4px;border:1px solid var(--separator);background:var(--bg);color:var(--text);cursor:pointer;font-size:11px">✏️ 编辑</button>
                        <button onclick="App.deleteStratum(${s.id})" style="padding:4px;border-radius:4px;border:1px solid var(--separator);background:var(--bg);color:var(--text);cursor:pointer;font-size:11px">🗑️</button>
                    </div>
                </div>
            `).join('');
        } catch (e) {
            container.innerHTML = '<p style="color:var(--danger);padding:10px">加载失败: ' + (e.message || '未知错误') + '</p>';
        }
    },

    showStrataForm(stratum) {
        const form = document.getElementById('strataForm');
        const list = document.getElementById('strataList');
        form.style.display = 'block';
        list.style.display = 'none';
        form.dataset.editId = stratum ? stratum.id : '';

        if (stratum) {
            document.getElementById('dsCode').value = stratum.code || '';
            document.getElementById('dsName').value = stratum.name || '';
            document.getElementById('dsAge').value = stratum.stratigraphic_age || '';
            document.getElementById('dsLithology').value = stratum.lithology || '';
            document.getElementById('dsDesc').value = stratum.description || '';
            document.getElementById('dsColor').value = stratum.color || '#808080';
            document.getElementById('dsMinThick').value = stratum.thickness_min || '';
            document.getElementById('dsMaxThick').value = stratum.thickness_max || '';
            document.getElementById('dsContact').value = stratum.contact_type || '';
            document.getElementById('dsRemarks').value = stratum.remarks || '';
        } else {
            document.getElementById('dsCode').value = '';
            document.getElementById('dsName').value = '';
            document.getElementById('dsAge').value = '';
            document.getElementById('dsLithology').value = '';
            document.getElementById('dsDesc').value = '';
            document.getElementById('dsColor').value = '#808080';
            document.getElementById('dsMinThick').value = '';
            document.getElementById('dsMaxThick').value = '';
            document.getElementById('dsContact').value = '';
            document.getElementById('dsRemarks').value = '';
        }
    },

    cancelStrataForm() {
        document.getElementById('strataForm').style.display = 'none';
        document.getElementById('strataList').style.display = 'block';
    },

    async saveStratum() {
        const editId = document.getElementById('strataForm').dataset.editId;
        const data = {
            project_id: this.currentProjectId,
            code: document.getElementById('dsCode').value,
            name: document.getElementById('dsName').value,
            stratigraphic_age: document.getElementById('dsAge').value,
            lithology: document.getElementById('dsLithology').value,
            description: document.getElementById('dsDesc').value,
            color: document.getElementById('dsColor').value,
            thickness_min: parseFloat(document.getElementById('dsMinThick').value) || null,
            thickness_max: parseFloat(document.getElementById('dsMaxThick').value) || null,
            contact_type: document.getElementById('dsContact').value,
            remarks: document.getElementById('dsRemarks').value,
        };
        if (!data.code || !data.name) {
            this.notify('代号与名称不能为空', 'warning');
            return;
        }
        try {
            if (editId) {
                await api.strata.update(parseInt(editId), data);
                this.notify('地层单元已更新', 'success');
            } else {
                await api.strata.create(data);
                this.notify('地层单元已创建', 'success');
            }
            this.cancelStrataForm();
            await this.loadStrataList();
        } catch (e) {
            this.notify('保存失败: ' + (e.message || '未知错误'), 'error');
        }
    },

    async editStratum(id) {
        try {
            const stratum = await api.strata.get(id);
            this.showStrataForm(stratum);
        } catch (e) {
            this.notify('加载失败', 'error');
        }
    },

    async deleteStratum(id) {
        if (!confirm('确定删除此地层单元?')) return;
        try {
            await api.strata.delete(id);
            this.notify('已删除', 'success');
            await this.loadStrataList();
        } catch (e) {
            this.notify('删除失败', 'error');
        }
    },

    notify(message, type = 'info') {
        const el = document.createElement('div');
        el.className = `notification ${type}`;
        el.textContent = message;
        document.body.appendChild(el);
        setTimeout(() => el.remove(), 3000);
    },
};

// 启动应用
document.addEventListener('DOMContentLoaded', () => App.init());
