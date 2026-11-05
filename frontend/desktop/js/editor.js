/**
 * 编辑模块 - 空间数据编辑、属性编辑、点线面绘制
 */
const Editor = {
    editMode: null,
    currentEditFeature: null,
    _drawCleanup: null,  // 保存绘制模式的清理函数

    // 取消当前编辑/绘制
    cancelEdit: function() {
        this.editMode = null;
        // 调用绘制模式注册的清理函数
        if (this._drawCleanup) {
            try { this._drawCleanup(); } catch(e) {}
            this._drawCleanup = null;
        }
    },

    // 绘制新地质点（触发属性表单）
    startDrawPoint() {
        // 先取消之前可能残留的绘制状态
        if (this._drawCleanup) { try { this._drawCleanup(); } catch(e) {} }
        this.editMode = 'draw-point';
        var self = this;
        function onClick(e) {
            cleanup();
            if (typeof App !== 'undefined') App.clearActiveTool();
            self.showPointForm(e.latlng.lat, e.latlng.lng);
        }
        function cleanup() {
            MapModule.map.off('click', onClick);
            self.editMode = null;
            self._drawCleanup = null;
        }
        this._drawCleanup = cleanup;
        MapModule.map.on('click', onClick);  // 用 on 而不是 once，确保 cancelEdit 能正确移除
        App.notify('请在地图上点击放置地质点位置（Esc 取消）', 'info');
    },

    // 绘制界线 —— 左键加点，右键确立
    startDrawLine(type) {
        var self = this;
        // 先取消之前可能残留的绘制状态
        if (this._drawCleanup) { try { this._drawCleanup(); } catch(e) {} }
        this.editMode = 'draw-line';
        var points = [];
        var tempLayer = L.featureGroup().addTo(MapModule.map);
        var previewLine = null;

        // 刷新预览
        function refreshPreview() {
            if (previewLine) tempLayer.removeLayer(previewLine);
            if (points.length >= 2) {
                previewLine = L.polyline(points, { color: '#8b4513', weight: 3, dashArray: '8,4' }).addTo(tempLayer);
            }
        }

        // 左键：添加顶点
        function onClick(e) {
            L.DomEvent.preventDefault(e);  // 阻止地图默认行为
            points.push([e.latlng.lat, e.latlng.lng]);
            L.circleMarker(e.latlng, { radius: 4, color: '#8b4513', fillOpacity: 1 }).addTo(tempLayer);
            refreshPreview();
            var el = document.getElementById('coordDisplay');
            if (el) el.textContent = '已添加 ' + points.length + ' 个顶点，右键完成';
        }

        // 右键：确立界线
        function onConfirm(e) {
            L.DomEvent.preventDefault(e);
            cleanup();
            if (typeof App !== 'undefined') App.clearActiveTool();
            if (points.length >= 2) {
                var wkt = 'LINESTRING(' + points.map(function(p) { return p[1] + ' ' + p[0]; }).join(',') + ')';
                self.showLineForm(wkt, type);
            } else {
                App.notify('至少需要 2 个顶点', 'warning');
            }
        }

        // 清理事件
        function cleanup() {
            MapModule.map.off('click', onClick);
            MapModule.map.off('contextmenu', onConfirm);
            MapModule.map.off('dblclick', onConfirm);
            tempLayer.remove();
            self.editMode = null;
            self._drawCleanup = null;
            var cd = document.getElementById('coordDisplay');
            if (cd) cd.textContent = '经度: --  纬度: --';
        }

        // 注册清理函数，供 cancelEdit 调用
        this._drawCleanup = cleanup;

        MapModule.map.on('click', onClick);
        MapModule.map.on('contextmenu', onConfirm);
        MapModule.map.on('dblclick', onConfirm);  // 双击也支持确立
        App.notify('🖱️ 左键添加顶点 → 右键确立界线（Esc 取消）', 'info');
    },

    // 绘制面 —— 左键加点，右键确立
    startDrawPolygon() {
        var self = this;
        // 先取消之前可能残留的绘制状态
        if (this._drawCleanup) { try { this._drawCleanup(); } catch(e) {} }
        this.editMode = 'draw-polygon';
        var points = [];
        var tempLayer = L.featureGroup().addTo(MapModule.map);
        var previewPoly = null;

        // 刷新预览
        function refreshPreview() {
            if (previewPoly) tempLayer.removeLayer(previewPoly);
            if (points.length >= 3) {
                previewPoly = L.polygon(points, { color: '#ffd700', weight: 2, fillColor: '#ffd700', fillOpacity: 0.25 }).addTo(tempLayer);
            } else if (points.length >= 2) {
                previewPoly = L.polyline(points, { color: '#ffd700', weight: 2, dashArray: '5,5' }).addTo(tempLayer);
            }
        }

        // 左键：添加顶点
        function onClick(e) {
            L.DomEvent.preventDefault(e);
            points.push([e.latlng.lat, e.latlng.lng]);
            tempLayer.clearLayers();
            previewPoly = null;
            // 重绘所有顶点
            points.forEach(function(p) {
                L.circleMarker(p, { radius: 4, color: '#ffd700', fillOpacity: 1 }).addTo(tempLayer);
            });
            refreshPreview();
            var el = document.getElementById('coordDisplay');
            if (el) el.textContent = '已添加 ' + points.length + ' 个顶点，右键完成面';
        }

        // 右键：确立面
        function onConfirm(e) {
            L.DomEvent.preventDefault(e);
            cleanup();
            if (typeof App !== 'undefined') App.clearActiveTool();
            if (points.length >= 3) {
                var closed = points.concat([points[0]]);
                var wkt = 'POLYGON((' + closed.map(function(p) { return p[1] + ' ' + p[0]; }).join(',') + '))';
                self.showAreaForm(wkt);
            } else {
                App.notify('至少需要 3 个顶点才能构成面', 'warning');
            }
        }

        // 清理
        function cleanup() {
            MapModule.map.off('click', onClick);
            MapModule.map.off('contextmenu', onConfirm);
            MapModule.map.off('dblclick', onConfirm);
            tempLayer.remove();
            self.editMode = null;
            self._drawCleanup = null;
            var cd = document.getElementById('coordDisplay');
            if (cd) cd.textContent = '经度: --  纬度: --';
        }

        // 注册清理函数，供 cancelEdit 调用
        this._drawCleanup = cleanup;

        MapModule.map.on('click', onClick);
        MapModule.map.on('contextmenu', onConfirm);
        MapModule.map.on('dblclick', onConfirm);
        App.notify('🖱️ 左键添加顶点 → 右键确立面（Esc 取消）', 'info');
    },

    // 显示地质点属性表单
    async showPointForm(lat, lng, existingPoint = null, gpsData = null) {
        const content = document.getElementById('modalContent');
        const isEdit = !!existingPoint;
        const p = existingPoint || {};
        if (gpsData && !isEdit) {
            p.elevation = gpsData.elevation;
            p.accuracy = gpsData.accuracy;
        }

        let nextNum = '';
        if (!isEdit && MapModule.currentProject) {
            try {
                const res = await api.points.nextNumber(MapModule.currentProject, 'D');
                nextNum = res.next_number;
            } catch(e) { nextNum = 'D0001'; }
        }

        const config = await api.config.get().catch(() => ({}));
        const pointTypes = config.point_types || ['地质观察点','构造测量点','样品点','照片点','地貌点','水文点','工程地质点'];
        const rockTypes = config.rock_types || ['沉积岩','岩浆岩','变质岩'];
        const ages = config.stratigraphic_ages || [];

        content.innerHTML = `
            <span class="close-btn" onclick="App.closeModal()">✕</span>
            <h2>${isEdit ? '编辑地质点' : '新增地质点'}</h2>
            <form id="pointForm" class="attr-form" onsubmit="return false;">
                <div class="attr-row">
                    <label>点编号 *</label>
                    <input type="text" name="point_number" value="${isEdit ? p.point_number : nextNum}" required>
                </div>
                <div class="attr-row">
                    <label>点类型 *</label>
                    <select name="point_type" required>
                        ${pointTypes.map(t => `<option value="${t}" ${p.point_type === t ? 'selected' : ''}>${t}</option>`).join('')}
                    </select>
                </div>
                <div class="attr-row">
                    <label>纬度</label>
                    <input type="number" step="0.000001" name="latitude" value="${isEdit ? p.latitude : lat.toFixed(6)}" required>
                </div>
                <div class="attr-row">
                    <label>经度</label>
                    <input type="number" step="0.000001" name="longitude" value="${isEdit ? p.longitude : lng.toFixed(6)}" required>
                </div>
                <div class="attr-row">
                    <label>高程 (米)</label>
                    <input type="number" step="0.1" name="elevation" value="${p.elevation || ''}">
                </div>
                <div class="attr-row">
                    <label>定位精度 (米)</label>
                    <input type="number" step="0.1" name="accuracy" value="${p.accuracy || ''}">
                </div>
                <div class="attr-row">
                    <label>定位方式</label>
                    <select name="location_method">
                        <option value="GPS">GPS</option>
                        <option value="手动">手动</option>
                        <option value="地图选点">地图选点</option>
                    </select>
                </div>
                <div class="attr-row">
                    <label>岩石类型</label>
                    <select name="rock_type">
                        <option value="">-- 选择 --</option>
                        ${rockTypes.map(t => `<option value="${t}" ${p.rock_type === t ? 'selected' : ''}>${t}</option>`).join('')}
                    </select>
                </div>
                <div class="attr-row">
                    <label>地层时代</label>
                    <select name="stratum_age">
                        <option value="">-- 选择 --</option>
                        ${ages.map(a => `<option value="${a}" ${p.stratum_age === a ? 'selected' : ''}>${a}</option>`).join('')}
                    </select>
                </div>
                <div class="attr-row">
                    <label>地层名称</label>
                    <input type="text" name="stratum_name" value="${p.stratum_name || ''}">
                </div>
                <div class="attr-row">
                    <label>构造类型</label>
                    <select name="occurrence_type">
                        <option value="">-- 选择 --</option>
                        <option value="层理" ${p.occurrence_type === '层理' ? 'selected' : ''}>层理</option>
                        <option value="节理" ${p.occurrence_type === '节理' ? 'selected' : ''}>节理</option>
                        <option value="断层" ${p.occurrence_type === '断层' ? 'selected' : ''}>断层</option>
                        <option value="褶皱" ${p.occurrence_type === '褶皱' ? 'selected' : ''}>褶皱</option>
                    </select>
                </div>
                <div class="attr-row" style="flex-direction:row; gap:8px;">
                    <div style="flex:1"><label>走向(°)</label><input type="number" step="0.1" name="strike" value="${p.strike || ''}"></div>
                    <div style="flex:1"><label>倾向(°)</label><input type="number" step="0.1" name="dip_direction" value="${p.dip_direction || ''}"></div>
                    <div style="flex:1"><label>倾角(°)</label><input type="number" step="0.1" name="dip" value="${p.dip || ''}"></div>
                </div>
                <div class="attr-row">
                    <label>样品编号</label>
                    <input type="text" name="sample_number" value="${p.sample_number || ''}">
                </div>
                <div class="attr-row">
                    <label>样品类型</label>
                    <select name="sample_type">
                        <option value="">-- 选择 --</option>
                        <option value="岩石样">岩石样</option>
                        <option value="土样">土样</option>
                        <option value="水样">水样</option>
                        <option value="矿样">矿样</option>
                        <option value="化石样">化石样</option>
                    </select>
                </div>
                <div class="attr-row">
                    <label>地图符号</label>
                    <select name="symbol" id="symbolSelect">
                        <option value="">-- 自动（按类型匹配） --</option>
                        ${SymbolLib.symbols.length > 0 ? (function() {
                            var opts = '', currentCat = '';
                            SymbolLib.symbols.forEach(function(s) {
                                var cat = s.category || s.symbol_type || '其他';
                                if (cat !== currentCat) {
                                    if (currentCat) opts += '</optgroup>';
                                    opts += '<optgroup label="' + cat + '">';
                                    currentCat = cat;
                                }
                                var sel = (p.symbol === s.name) ? ' selected' : '';
                                opts += '<option value="' + s.name + '"' + sel + '>' + s.name + '</option>';
                            });
                            if (currentCat) opts += '</optgroup>';
                            return opts;
                        })() : '<option value="">-- 符号库未加载 --</option>'}
                    </select>
                    <small style="color:var(--fill-tertiary);font-size:10px;margin-top:2px">默认: <span id="defaultSymbolHint">${SymbolLib.pointTypeSymbols[p.point_type||''] || (SymbolLib.symbols.some(s=>s.name===p.point_type)?p.point_type:'无匹配')}</span></small>
                </div>
                <div class="attr-row">
                    <label>地质描述</label>
                    <textarea name="description" rows="3">${p.description || ''}</textarea>
                </div>
                <div class="btn-group">
                    <button type="button" class="btn-primary" onclick="Editor.savePoint(${isEdit ? p.id : 'null'})">
                        ${isEdit ? '💾 保存修改' : '✅ 创建地质点'}
                    </button>
                    <button type="button" class="btn-secondary" onclick="App.closeModal()">取消</button>
                </div>
            </form>
        `;

        document.getElementById('modalOverlay').style.display = 'flex';
    },

    // 保存地质点
    async savePoint(pointId) {
        const form = document.getElementById('pointForm');
        const formData = new FormData(form);
        const data = Object.fromEntries(formData.entries());

        // 类型转换
        data.latitude = parseFloat(data.latitude);
        data.longitude = parseFloat(data.longitude);
        if (data.elevation) data.elevation = parseFloat(data.elevation);
        if (data.accuracy) data.accuracy = parseFloat(data.accuracy);
        if (data.strike) data.strike = parseFloat(data.strike);
        if (data.dip) data.dip = parseFloat(data.dip);
        if (data.dip_direction) data.dip_direction = parseFloat(data.dip_direction);

        try {
            if (pointId) {
                await api.points.update(pointId, data);
                App.notify('地质点更新成功', 'success');
            } else {
                data.project_id = MapModule.currentProject;
                await api.points.create(data);
                App.notify('地质点创建成功', 'success');
            }
            App.closeModal();
            if (MapModule.currentProject) {
                await MapModule.loadProjectData(MapModule.currentProject);
            }
            App.updateStatusBar();
            App.updateDataPanel();
        } catch (e) {
            App.notify('保存失败: ' + e.message, 'error');
        }
    },

    // 显示线要素表单
    showLineForm(geomWkt, type = 'boundary') {
        const content = document.getElementById('modalContent');
        const title = type === 'fault' ? '新建断层' : '新建地质界线';

        content.innerHTML = `
            <span class="close-btn" onclick="App.closeModal()">✕</span>
            <h2>${title}</h2>
            <form id="lineForm" class="attr-form" onsubmit="return false;">
                <div class="attr-row">
                    <label>名称 *</label>
                    <input type="text" name="name" required>
                </div>
                ${type === 'fault' ? `
                <div class="attr-row">
                    <label>断层类型</label>
                    <select name="fault_type">
                        <option value="正断层">正断层</option>
                        <option value="逆断层">逆断层</option>
                        <option value="平移断层">平移断层</option>
                        <option value="推覆构造">推覆构造</option>
                    </select>
                </div>
                <div class="attr-row" style="flex-direction:row; gap:8px;">
                    <div style="flex:1"><label>倾向(°)</label><input type="number" name="dip_direction" step="0.1"></div>
                    <div style="flex:1"><label>倾角(°)</label><input type="number" name="dip" step="0.1"></div>
                    <div style="flex:1"><label>断距(m)</label><input type="number" name="throw" step="0.1"></div>
                </div>
                ` : `
                <div class="attr-row">
                    <label>界线类型</label>
                    <select name="boundary_type">
                        <option value="整合接触">整合接触</option>
                        <option value="不整合接触">不整合接触</option>
                        <option value="侵入接触">侵入接触</option>
                        <option value="断层接触">断层接触</option>
                    </select>
                </div>`}
                <div class="attr-row">
                    <label>描述</label>
                    <textarea name="description" rows="2"></textarea>
                </div>
                <input type="hidden" name="geom_wkt" value="${geomWkt}">
                <input type="hidden" name="project_id" value="${MapModule.currentProject}">
                <div class="btn-group">
                    <button type="button" class="btn-primary" onclick="Editor.saveLine('${type}')">💾 保存</button>
                    <button type="button" class="btn-secondary" onclick="App.closeModal()">取消</button>
                </div>
            </form>
        `;
        document.getElementById('modalOverlay').style.display = 'flex';
    },

    // 保存线要素
    async saveLine(type) {
        const form = document.getElementById('lineForm');
        const formData = new FormData(form);
        const data = Object.fromEntries(formData.entries());

        try {
            if (type === 'fault') {
                await api.faults.create(data);
            } else {
                await api.boundaries.create(data);
            }
            App.notify('保存成功', 'success');
            App.closeModal();
            // 自动勾选对应图层使其可见
            var layerKey = type === 'fault' ? 'faults' : 'boundaries';
            var cb = document.getElementById('layer' + layerKey.charAt(0).toUpperCase() + layerKey.slice(1));
            if (cb && !cb.checked) { cb.checked = true; MapModule.toggleLayer(layerKey, true); }
            if (MapModule.currentProject) {
                await MapModule.loadProjectData(MapModule.currentProject);
            }
            App.updateStatusBar();
            App.updateDataPanel();
        } catch (e) {
            App.notify('保存失败: ' + e.message, 'error');
        }
    },

    // 显示面要素表单
    showAreaForm(geomWkt) {
        const content = document.getElementById('modalContent');
        content.innerHTML = `
            <span class="close-btn" onclick="App.closeModal()">✕</span>
            <h2>新建地层面</h2>
            <form id="areaForm" class="attr-form" onsubmit="return false;">
                <div class="attr-row">
                    <label>名称 *</label>
                    <input type="text" name="name" required>
                </div>
                <div class="attr-row">
                    <label>面类型</label>
                    <select name="area_type">
                        <option value="地层单元">地层单元</option>
                        <option value="岩体单元">岩体单元</option>
                        <option value="构造单元">构造单元</option>
                    </select>
                </div>
                <div class="attr-row">
                    <label>岩石类型</label>
                    <select name="rock_type">
                        <option value="">-- 选择 --</option>
                        <option value="沉积岩">沉积岩</option>
                        <option value="岩浆岩">岩浆岩</option>
                        <option value="变质岩">变质岩</option>
                    </select>
                </div>
                <div class="attr-row">
                    <label>地层时代</label>
                    <input type="text" name="stratum_age">
                </div>
                <div class="attr-row">
                    <label>填充颜色</label>
                    <input type="color" name="fill_color" value="#ffd700">
                </div>
                <div class="attr-row">
                    <label>填充图案</label>
                    <select name="fill_pattern">
                        <option value="">无</option>
                        <option value="dots">点状</option>
                        <option value="lines">线状</option>
                        <option value="brick">砖形</option>
                        <option value="cross">十字</option>
                    </select>
                </div>
                <div class="attr-row">
                    <label>描述</label>
                    <textarea name="description" rows="2"></textarea>
                </div>
                <input type="hidden" name="geom_wkt" value="${geomWkt}">
                <input type="hidden" name="project_id" value="${MapModule.currentProject}">
                <div class="btn-group">
                    <button type="button" class="btn-primary" onclick="Editor.saveArea()">💾 保存</button>
                    <button type="button" class="btn-secondary" onclick="App.closeModal()">取消</button>
                </div>
            </form>
        `;
        document.getElementById('modalOverlay').style.display = 'flex';
    },

    // 保存面要素
    async saveArea() {
        const form = document.getElementById('areaForm');
        const formData = new FormData(form);
        const data = Object.fromEntries(formData.entries());

        try {
            await api.areas.create(data);
            App.notify('地层面创建成功', 'success');
            App.closeModal();
            // 自动勾选地层面图层使其可见
            var cb = document.getElementById('layerAreas');
            if (cb && !cb.checked) { cb.checked = true; MapModule.toggleLayer('areas', true); }
            if (MapModule.currentProject) {
                await MapModule.loadProjectData(MapModule.currentProject);
            }
            App.updateStatusBar();
            App.updateDataPanel();
        } catch (e) {
            App.notify('保存失败: ' + e.message, 'error');
        }
    },

    // 删除要素
    async deleteFeature(type, id) {
        if (!confirm('确定要删除此要素吗？此操作不可撤销。')) return;

        try {
            switch(type) {
                case 'point': await api.points.delete(id); break;
                case 'route': await api.routes.delete(id); break;
                case 'boundary': await api.boundaries.delete(id); break;
                case 'fault': await api.faults.delete(id); break;
                case 'area': await api.areas.delete(id); break;
            }
            App.notify('删除成功', 'success');
            App.closeModal();
            if (MapModule.currentProject) {
                await MapModule.loadProjectData(MapModule.currentProject);
            }
            App.updateStatusBar();
            App.updateDataPanel();
        } catch (e) {
            App.notify('删除失败: ' + e.message, 'error');
        }
    },

    // 编辑现有地质点
    async editPoint(pointId) {
        try {
            const point = await api.points.get(pointId);
            this.showPointForm(point.latitude, point.longitude, point);
        } catch (e) {
            App.notify('获取点信息失败: ' + e.message, 'error');
        }
    },

    // 显示点详情在右侧面板
    async showPointDetail(pointId) {
        try {
            const point = await api.points.get(pointId);
            const panel = document.getElementById('attributeContent');

            panel.innerHTML = `
                <div class="attr-form">
                    <h4>📍 ${point.point_number}</h4>
                    <div class="attr-row"><label>类型</label><span>${point.point_type}</span></div>
                    <div class="attr-row"><label>坐标</label><span>${point.latitude?.toFixed(6)}, ${point.longitude?.toFixed(6)}</span></div>
                    <div class="attr-row"><label>高程</label><span>${point.elevation ? point.elevation + 'm' : '--'}</span></div>
                    <div class="attr-row"><label>精度</label><span>${point.accuracy ? point.accuracy + 'm' : '--'}</span></div>
                    <div class="attr-row"><label>岩石</label><span>${point.rock_type || '--'}</span></div>
                    <div class="attr-row"><label>地层</label><span>${point.stratum_age || '--'} ${point.stratum_name || ''}</span></div>
                    <div class="attr-row"><label>构造</label><span>${point.occurrence_type || '--'}</span></div>
                    ${point.strike ? `<div class="attr-row"><label>产状</label><span>走向${point.strike}° 倾向${point.dip_direction}° 倾角${point.dip}°</span></div>` : ''}
                    <div class="attr-row"><label>样品</label><span>${point.sample_number || '--'}</span></div>
                    <div class="attr-row"><label>描述</label><span>${point.description || '--'}</span></div>
                    <div class="attr-row"><label>审核</label><span>${point.is_checked ? '✅ 已审核' : '⏳ 未审核'}</span></div>
                    ${point.photos ? `<div class="attr-row"><label>照片 (${point.photos.length}张)</label></div>` : ''}
                    <div class="btn-group">
                        <button class="btn-primary" onclick="Editor.editPoint(${point.id})">✏️ 编辑</button>
                        <button class="btn-secondary" onclick="api.points.check(${point.id}, ${!point.is_checked}).then(() => { Editor.showPointDetail(${point.id}); App.updateStatusBar(); })">
                            ${point.is_checked ? '↩️ 取消审核' : '✅ 审核通过'}
                        </button>
                        <button class="btn-danger" onclick="Editor.deleteFeature('point', ${point.id})">🗑️</button>
                    </div>
                </div>
            `;
        } catch (e) {
            document.getElementById('attributeContent').innerHTML = `<p class="placeholder">加载失败: ${e.message}</p>`;
        }
    },

    // ============================================================
    // 路线编辑
    // ============================================================

    editRoute: async function(routeId) {
        try {
            const route = await api.routes.get(routeId);
            this.showRouteForm(route);
        } catch(e) {
            App.notify('获取路线信息失败: ' + e.message, 'error');
        }
    },

    showRouteForm: function(existingRoute) {
        const content = document.getElementById('modalContent');
        const isEdit = !!existingRoute;
        const r = existingRoute || {};

        content.innerHTML = `
            <span class="close-btn" onclick="App.closeModal()">✕</span>
            <h2>${isEdit ? '编辑路线' : '新建路线'}</h2>
            <form id="routeForm" class="attr-form" onsubmit="return false;">
                <div class="attr-row">
                    <label>路线名称 *</label>
                    <input type="text" name="name" value="${r.name || ''}" required>
                </div>
                <div class="attr-row">
                    <label>路线日期</label>
                    <input type="date" name="route_date" value="${r.route_date || ''}">
                </div>
                <div class="attr-row">
                    <label>调查人</label>
                    <input type="text" name="surveyor" value="${r.surveyor || ''}">
                </div>
                <div class="attr-row">
                    <label>天气</label>
                    <select name="weather">
                        <option value="">-- 选择 --</option>
                        <option value="晴" ${r.weather==='晴'?'selected':''}>晴</option>
                        <option value="多云" ${r.weather==='多云'?'selected':''}>多云</option>
                        <option value="阴" ${r.weather==='阴'?'selected':''}>阴</option>
                        <option value="雨" ${r.weather==='雨'?'selected':''}>雨</option>
                        <option value="雪" ${r.weather==='雪'?'selected':''}>雪</option>
                    </select>
                </div>
                <div class="attr-row">
                    <label>描述</label>
                    <textarea name="description" rows="3">${r.description || ''}</textarea>
                </div>
                <div class="btn-group">
                    <button type="button" class="btn-primary" onclick="Editor.saveRoute(${isEdit ? r.id : 'null'})">
                        💾 保存修改
                    </button>
                    <button type="button" class="btn-secondary" onclick="App.closeModal()">取消</button>
                    ${isEdit ? `<button type="button" class="btn-primary" style="background:var(--accent)" onclick="App.closeModal(); Editor.startGeometryEdit('route',${r.id})">✏️ 编辑路线几何</button>` : ''}
                </div>
            </form>
        `;
        document.getElementById('modalOverlay').style.display = 'flex';
    },

    saveRoute: async function(routeId) {
        const form = document.getElementById('routeForm');
        const formData = new FormData(form);
        const data = Object.fromEntries(formData.entries());

        try {
            if (routeId) {
                await api.routes.update(routeId, data);
                App.notify('路线更新成功', 'success');
            } else {
                data.project_id = MapModule.currentProject;
                await api.routes.create(data);
                App.notify('路线创建成功', 'success');
            }
            App.closeModal();
            if (MapModule.currentProject) {
                await MapModule.loadProjectData(MapModule.currentProject);
            }
            App.updateStatusBar();
            App.updateDataPanel();
        } catch(e) {
            App.notify('保存失败: ' + e.message, 'error');
        }
    },

    // ============================================================
    // 地质界线编辑
    // ============================================================

    editBoundary: async function(boundaryId) {
        try {
            const boundary = await api.boundaries.get(boundaryId);
            this.showBoundaryForm(boundary);
        } catch(e) {
            App.notify('获取界线信息失败: ' + e.message, 'error');
        }
    },

    showBoundaryForm: function(existingBoundary) {
        const content = document.getElementById('modalContent');
        const isEdit = !!existingBoundary;
        const b = existingBoundary || {};

        content.innerHTML = `
            <span class="close-btn" onclick="App.closeModal()">✕</span>
            <h2>${isEdit ? '编辑地质界线' : '新建地质界线'}</h2>
            <form id="boundaryForm" class="attr-form" onsubmit="return false;">
                <div class="attr-row">
                    <label>名称 *</label>
                    <input type="text" name="name" value="${b.name || ''}" required>
                </div>
                <div class="attr-row">
                    <label>界线类型</label>
                    <select name="boundary_type">
                        <option value="">-- 选择 --</option>
                        <option value="整合接触" ${b.boundary_type==='整合接触'?'selected':''}>整合接触</option>
                        <option value="不整合接触" ${b.boundary_type==='不整合接触'?'selected':''}>不整合接触</option>
                        <option value="侵入接触" ${b.boundary_type==='侵入接触'?'selected':''}>侵入接触</option>
                        <option value="断层接触" ${b.boundary_type==='断层接触'?'selected':''}>断层接触</option>
                    </select>
                </div>
                <div class="attr-row">
                    <label>左侧地层</label>
                    <input type="text" name="left_unit" value="${b.left_unit || ''}">
                </div>
                <div class="attr-row">
                    <label>右侧地层</label>
                    <input type="text" name="right_unit" value="${b.right_unit || ''}">
                </div>
                <div class="attr-row">
                    <label>描述</label>
                    <textarea name="description" rows="3">${b.description || ''}</textarea>
                </div>
                <div class="btn-group">
                    <button type="button" class="btn-primary" onclick="Editor.saveBoundary(${isEdit ? b.id : 'null'})">
                        💾 保存修改
                    </button>
                    <button type="button" class="btn-secondary" onclick="App.closeModal()">取消</button>
                    ${isEdit ? `<button type="button" class="btn-primary" style="background:var(--accent)" onclick="App.closeModal(); Editor.startGeometryEdit('boundary',${b.id})">✏️ 编辑界线几何</button>` : ''}
                </div>
            </form>
        `;
        document.getElementById('modalOverlay').style.display = 'flex';
    },

    saveBoundary: async function(boundaryId) {
        const form = document.getElementById('boundaryForm');
        const formData = new FormData(form);
        const data = Object.fromEntries(formData.entries());

        try {
            if (boundaryId) {
                await api.boundaries.update(boundaryId, data);
                App.notify('地质界线更新成功', 'success');
            } else {
                data.project_id = MapModule.currentProject;
                await api.boundaries.create(data);
                App.notify('地质界线创建成功', 'success');
            }
            App.closeModal();
            if (MapModule.currentProject) {
                await MapModule.loadProjectData(MapModule.currentProject);
            }
            App.updateStatusBar();
            App.updateDataPanel();
        } catch(e) {
            App.notify('保存失败: ' + e.message, 'error');
        }
    },

    // ============================================================
    // 断层编辑
    // ============================================================

    editFault: async function(faultId) {
        try {
            const fault = await api.faults.get(faultId);
            this.showFaultForm(fault);
        } catch(e) {
            App.notify('获取断层信息失败: ' + e.message, 'error');
        }
    },

    showFaultForm: function(existingFault) {
        const content = document.getElementById('modalContent');
        const isEdit = !!existingFault;
        const f = existingFault || {};

        content.innerHTML = `
            <span class="close-btn" onclick="App.closeModal()">✕</span>
            <h2>${isEdit ? '编辑断层' : '新建断层'}</h2>
            <form id="faultForm" class="attr-form" onsubmit="return false;">
                <div class="attr-row">
                    <label>名称 *</label>
                    <input type="text" name="name" value="${f.name || ''}" required>
                </div>
                <div class="attr-row">
                    <label>断层类型</label>
                    <select name="fault_type">
                        <option value="">-- 选择 --</option>
                        <option value="正断层" ${f.fault_type==='正断层'?'selected':''}>正断层</option>
                        <option value="逆断层" ${f.fault_type==='逆断层'?'selected':''}>逆断层</option>
                        <option value="平移断层" ${f.fault_type==='平移断层'?'selected':''}>平移断层</option>
                        <option value="推覆构造" ${f.fault_type==='推覆构造'?'selected':''}>推覆构造</option>
                    </select>
                </div>
                <div class="attr-row" style="flex-direction:row; gap:8px;">
                    <div style="flex:1"><label>倾向(°)</label><input type="number" name="dip_direction" step="0.1" value="${f.dip_direction || ''}"></div>
                    <div style="flex:1"><label>倾角(°)</label><input type="number" name="dip" step="0.1" value="${f.dip || ''}"></div>
                    <div style="flex:1"><label>断距(m)</label><input type="number" name="throw" step="0.1" value="${f.throw || ''}"></div>
                </div>
                <div class="attr-row">
                    <label>描述</label>
                    <textarea name="description" rows="3">${f.description || ''}</textarea>
                </div>
                <div class="btn-group">
                    <button type="button" class="btn-primary" onclick="Editor.saveFault(${isEdit ? f.id : 'null'})">
                        💾 保存修改
                    </button>
                    <button type="button" class="btn-secondary" onclick="App.closeModal()">取消</button>
                    ${isEdit ? `<button type="button" class="btn-primary" style="background:var(--accent)" onclick="App.closeModal(); Editor.startGeometryEdit('fault',${f.id})">✏️ 编辑断层几何</button>` : ''}
                </div>
            </form>
        `;
        document.getElementById('modalOverlay').style.display = 'flex';
    },

    saveFault: async function(faultId) {
        const form = document.getElementById('faultForm');
        const formData = new FormData(form);
        const data = Object.fromEntries(formData.entries());
        if (data.dip) data.dip = parseFloat(data.dip);
        if (data.dip_direction) data.dip_direction = parseFloat(data.dip_direction);
        if (data.throw) data.throw = parseFloat(data.throw);

        try {
            if (faultId) {
                await api.faults.update(faultId, data);
                App.notify('断层更新成功', 'success');
            } else {
                data.project_id = MapModule.currentProject;
                await api.faults.create(data);
                App.notify('断层创建成功', 'success');
            }
            App.closeModal();
            if (MapModule.currentProject) {
                await MapModule.loadProjectData(MapModule.currentProject);
            }
            App.updateStatusBar();
            App.updateDataPanel();
        } catch(e) {
            App.notify('保存失败: ' + e.message, 'error');
        }
    },

    // ============================================================
    // 地层面编辑
    // ============================================================

    editArea: async function(areaId) {
        try {
            const area = await api.areas.get(areaId);
            this._showAreaEditForm(area);
        } catch(e) {
            App.notify('获取地层面信息失败: ' + e.message, 'error');
        }
    },

    _showAreaEditForm: function(existingArea) {
        const content = document.getElementById('modalContent');
        const isEdit = !!existingArea;
        const a = existingArea || {};

        content.innerHTML = `
            <span class="close-btn" onclick="App.closeModal()">✕</span>
            <h2>${isEdit ? '编辑地层面' : '新建地层面'}</h2>
            <form id="areaForm" class="attr-form" onsubmit="return false;">
                <div class="attr-row">
                    <label>名称 *</label>
                    <input type="text" name="name" value="${a.name || ''}" required>
                </div>
                <div class="attr-row">
                    <label>面类型</label>
                    <select name="area_type">
                        <option value="">-- 选择 --</option>
                        <option value="地层单元" ${a.area_type==='地层单元'?'selected':''}>地层单元</option>
                        <option value="岩体单元" ${a.area_type==='岩体单元'?'selected':''}>岩体单元</option>
                        <option value="构造单元" ${a.area_type==='构造单元'?'selected':''}>构造单元</option>
                    </select>
                </div>
                <div class="attr-row">
                    <label>岩石类型</label>
                    <select name="rock_type">
                        <option value="">-- 选择 --</option>
                        <option value="沉积岩" ${a.rock_type==='沉积岩'?'selected':''}>沉积岩</option>
                        <option value="岩浆岩" ${a.rock_type==='岩浆岩'?'selected':''}>岩浆岩</option>
                        <option value="变质岩" ${a.rock_type==='变质岩'?'selected':''}>变质岩</option>
                    </select>
                </div>
                <div class="attr-row">
                    <label>地层时代</label>
                    <input type="text" name="stratum_age" value="${a.stratum_age || ''}">
                </div>
                <div class="attr-row">
                    <label>填充颜色</label>
                    <input type="color" name="fill_color" value="${a.fill_color || '#ffd700'}">
                </div>
                <div class="attr-row">
                    <label>填充图案</label>
                    <select name="fill_pattern">
                        <option value="">无</option>
                        <option value="dots" ${a.fill_pattern==='dots'?'selected':''}>点状</option>
                        <option value="lines" ${a.fill_pattern==='lines'?'selected':''}>线状</option>
                        <option value="brick" ${a.fill_pattern==='brick'?'selected':''}>砖形</option>
                        <option value="cross" ${a.fill_pattern==='cross'?'selected':''}>十字</option>
                    </select>
                </div>
                <div class="attr-row">
                    <label>描述</label>
                    <textarea name="description" rows="3">${a.description || ''}</textarea>
                </div>
                <input type="hidden" name="geom_wkt" value="${a.geom_wkt || ''}">
                <input type="hidden" name="project_id" value="${MapModule.currentProject}">
                <div class="btn-group">
                    <button type="button" class="btn-primary" onclick="Editor.saveArea(${isEdit ? a.id : 'null'})">
                        💾 保存修改
                    </button>
                    <button type="button" class="btn-secondary" onclick="App.closeModal()">取消</button>
                    ${isEdit ? `<button type="button" class="btn-primary" style="background:var(--accent)" onclick="App.closeModal(); Editor.startGeometryEdit('area',${a.id})">✏️ 编辑面几何</button>` : ''}
                </div>
            </form>
        `;
        document.getElementById('modalOverlay').style.display = 'flex';
    },

    saveArea: async function(areaId) {
        const form = document.getElementById('areaForm');
        const formData = new FormData(form);
        const data = Object.fromEntries(formData.entries());

        try {
            if (areaId) {
                await api.areas.update(areaId, data);
                App.notify('地层面更新成功', 'success');
            } else {
                data.project_id = MapModule.currentProject;
                await api.areas.create(data);
                App.notify('地层面创建成功', 'success');
            }
            App.closeModal();
            if (MapModule.currentProject) {
                await MapModule.loadProjectData(MapModule.currentProject);
            }
            App.updateStatusBar();
            App.updateDataPanel();
        } catch(e) {
            App.notify('保存失败: ' + e.message, 'error');
        }
    },

    // ============================================================
    // 几何编辑（Leaflet.draw 顶点拖拽）
    // ============================================================
    _geomEdit: null,  // { featureType, featureId, tempGroup, originalLayer, drawHandler }

    startGeometryEdit: function(featureType, featureId) {
        // 互斥：先清理所有活跃编辑/绘制状态
        this.cancelEdit();
        this.endGeometryEdit();
        if (MapModule.measureActive) MapModule.clearMeasure();
        App.clearActiveTool();

        // 找到对应的 leaflet layer
        var layerName = this._layerNameForType(featureType);
        var layerGroup = MapModule.layers[layerName];
        if (!layerGroup) { App.notify('找不到图层的要素组', 'error'); return; }

        var self = this;
        var foundLayer = null;
        var idField = this._idFieldForType(featureType);

        layerGroup.eachLayer(function(f) {
            if (f[idField] === featureId) {
                foundLayer = f;
            }
        });

        if (!foundLayer) {
            App.notify('在地图上找不到该要素', 'error');
            return;
        }

        // 克隆 layer 加入临时 FeatureGroup（保留原始 layer 在图层中不动）
        var tempGroup = L.featureGroup().addTo(MapModule.map);
        var clone;
        if (foundLayer.getLatLngs) {
            var latlngs = foundLayer.getLatLngs();
            if (foundLayer instanceof L.Polygon) {
                clone = L.polygon(latlngs, {
                    color: '#3388ff', weight: 3, fillColor: '#3388ff',
                    fillOpacity: 0.15, dashArray: null
                });
            } else {
                clone = L.polyline(latlngs, {
                    color: '#3388ff', weight: 4, dashArray: null
                });
            }
            tempGroup.addLayer(clone);
        } else {
            App.notify('该要素不支持几何编辑', 'warning');
            return;
        }

        // 启用 Leaflet.draw 编辑模式
        var drawHandler = null;
        try {
            if (L.EditToolbar && L.EditToolbar.Edit) {
                drawHandler = new L.EditToolbar.Edit(MapModule.map, { featureGroup: tempGroup });
                drawHandler.enable();
            }
        } catch(e) {
            App.notify('启动编辑模式失败: ' + e.message, 'error');
            tempGroup.remove();
            return;
        }

        this._geomEdit = {
            featureType: featureType,
            featureId: featureId,
            tempGroup: tempGroup,
            originalLayer: foundLayer,
            drawHandler: drawHandler,
            clone: clone
        };

        // 原始要素变半透明，表示"正在编辑中"
        foundLayer.setStyle({ opacity: 0.3, fillOpacity: 0.1 });

        // 显示保存/取消浮动工具条
        this._showGeomEditToolbar(featureType, featureId);

        App.notify('✏️ 拖拽顶点编辑几何 → 完成后点击「💾 保存几何」', 'info');
    },

    endGeometryEdit: function() {
        var ge = this._geomEdit;
        if (!ge) return;

        // 关闭 draw 编辑模式
        if (ge.drawHandler) {
            try { ge.drawHandler.disable(); } catch(e) {}
        }

        // 恢复原始 layer 样式
        if (ge.originalLayer) {
            try {
                ge.originalLayer.setStyle({ opacity: ge.featureType === 'area' ? 0.9 : 0.75, fillOpacity: 0.85 });
            } catch(e) {}
        }

        // 清理
        if (ge.tempGroup) { ge.tempGroup.remove(); }
        this._geomEdit = null;
        this._removeGeomEditToolbar();
    },

    _saveGeometryEdit: async function() {
        var ge = this._geomEdit;
        if (!ge || !ge.clone) return;

        // ① 关闭编辑模式
        if (ge.drawHandler) {
            try { ge.drawHandler.disable(); } catch(e) {}
        }

        // ② 提取坐标 → WKT
        var latlngs = ge.clone.getLatLngs();
        var geomType = (ge.clone instanceof L.Polygon) ? 'POLYGON' : 'LINESTRING';
        var wkt = this._latlngsToWkt(latlngs, geomType);

        // ③ 清理临时层
        if (ge.tempGroup) { ge.tempGroup.remove(); }

        // 恢复原始 layer
        if (ge.originalLayer) {
            try {
                ge.originalLayer.setStyle({ opacity: ge.featureType === 'area' ? 0.9 : 0.75, fillOpacity: 0.85 });
            } catch(e) {}
        }

        this._geomEdit = null;
        this._removeGeomEditToolbar();

        // ④ 调用 API 持久化
        try {
            var apiMap = {
                route: api.routes,
                boundary: api.boundaries,
                fault: api.faults,
                area: api.areas
            };
            var apiModule = apiMap[ge.featureType];
            if (!apiModule) throw new Error('不支持的要素类型');

            // 路由用 route_geom，其他用 geom_wkt
            var updateData = {};
            if (ge.featureType === 'route') {
                updateData.route_geom = wkt;
            } else {
                updateData.geom_wkt = wkt;
            }
            await apiModule.update(ge.featureId, updateData);

            // ⑤ 刷新图层（此时数据已持久化）
            if (MapModule.currentProject) {
                await MapModule.loadProjectData(MapModule.currentProject);
            }
            App.updateDataPanel();
            App.notify('几何保存成功', 'success');
        } catch(e) {
            App.notify('几何保存失败: ' + e.message, 'error');
        }
    },

    _cancelGeometryEdit: function() {
        this.endGeometryEdit();
        App.notify('几何编辑已取消', 'info');
    },

    _layerNameForType: function(type) {
        var map = { route: 'routes', boundary: 'boundaries', fault: 'faults', area: 'areas', point: 'points' };
        return map[type] || type + 's';
    },

    _idFieldForType: function(type) {
        var map = { route: 'routeId', boundary: 'boundaryId', fault: 'faultId', area: 'areaId', point: 'geoPointId' };
        return map[type] || (type + 'Id');
    },

    _latlngsToWkt: function(latlngs, geomType) {
        // 确保拿到的是扁平坐标数组
        var coords = [];
        var flat = Array.isArray(latlngs[0]) && Array.isArray(latlngs[0][0]) ? latlngs[0] : latlngs;

        flat.forEach(function(ll) {
            if (ll && ll.lng !== undefined && ll.lat !== undefined) {
                coords.push(ll.lng + ' ' + ll.lat);
            } else if (Array.isArray(ll) && ll.length >= 2) {
                coords.push(ll[1] + ' ' + ll[0]); // [lat, lng] → "lng lat"
            }
        });

        if (coords.length < 2) return '';

        if (geomType === 'POLYGON') {
            // 检测是否已闭合：首点和末点是否相同
            if (coords[0] !== coords[coords.length - 1]) {
                coords.push(coords[0]); // 闭合
            }
            return 'POLYGON((' + coords.join(',') + '))';
        }

        return 'LINESTRING(' + coords.join(',') + ')';
    },

    _showGeomEditToolbar: function(featureType, featureId) {
        this._removeGeomEditToolbar();
        var bar = document.createElement('div');
        bar.id = 'geomEditToolbar';
        bar.innerHTML = `
            <span style="font-size:12px;color:var(--fill-tertiary);margin-right:8px">✏️ 编辑几何中</span>
            <button class="btn-primary" style="font-size:12px;padding:4px 10px;margin-right:4px" onclick="Editor._saveGeometryEdit()">💾 保存几何</button>
            <button class="btn-secondary" style="font-size:12px;padding:4px 10px" onclick="Editor._cancelGeometryEdit()">✕ 取消</button>
        `;
        bar.style.cssText = 'position:fixed;bottom:20px;left:50%;transform:translateX(-50%);z-index:10000;'
            + 'background:var(--bg-secondary);border:1px solid var(--accent);border-radius:8px;'
            + 'padding:8px 16px;display:flex;align-items:center;box-shadow:0 4px 20px rgba(0,0,0,0.3);';
        document.body.appendChild(bar);
    },

    _removeGeomEditToolbar: function() {
        var bar = document.getElementById('geomEditToolbar');
        if (bar) bar.remove();
    },
};
