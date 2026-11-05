/**
 * 专业出图 — 截图式布局引擎（无 Leaflet 依赖）
 */
const PrintPanel = {
    SCREEN_SCALE: 3.0,
    ZOOM_MIN: 0.15, ZOOM_MAX: 4.0,

    paper: { width: 420, height: 297 },
    dpi: 300,
    elements: [],
    selectedId: null,
    canvasZoom: 1.0,
    _mapSnapshot: null,
    _loadedData: null,

    /* ================================================================
       INIT
       ================================================================ */
    async init() {
        // 加载截图
        this._mapSnapshot = sessionStorage.getItem('mapSnapshot');
        // 预加载地图截图获取像素尺寸（用于比例尺计算）
        this._mapSnapshotSize = null;
        if (this._mapSnapshot) {
            var img = new Image();
            var self = this;
            img.onload = function() {
                self._mapSnapshotSize = { width: img.width, height: img.height };
                // 尺寸加载后，重绘比例尺元素
                self.elements.forEach(function(el) {
                    if (el.type === 'scalebar') self._updateElementDOM(el);
                });
            };
            img.src = this._mapSnapshot;
        }
        // 加载项目数据供图例
        var rawData = sessionStorage.getItem('printProjectData');
        if (rawData) { try { this._loadedData = JSON.parse(rawData); } catch(e) {} }
        // 加载地图状态
        var raw = sessionStorage.getItem('printLayoutState');
        if (raw) {
            try { this._mapState = JSON.parse(raw); this.projectId = this._mapState.projectId; } catch(e) {}
        }
        if (!this.projectId) {
            this.notify('未找到项目信息，请从桌面端重新打开出图页面', 'error');
            return;
        }

        this.canvas = document.getElementById('printPanelLayoutCanvas');
        this.canvasArea = document.getElementById('printPanelCanvasArea');

        var saved = localStorage.getItem('print-layout-' + this.projectId);
        if (saved) {
            try {
                var data = JSON.parse(saved);
                if (confirm('检测到上次保存的布局，是否恢复？\n（取消将使用默认 A3 横模板）')) {
                    this.paper = data.paper;
                    this.dpi = data.dpi || 300;
                    this.elements = data.elements || [];
                    this.selectedId = null;
                    this._rebuildAll();
                    this.updatePaperUI();
                    this.zoomFit();
                    return;
                }
            } catch(e) {}
        }
        this.setDefaultLayout();
    },

    setDefaultLayout() {
        this.elements = [
            { type: 'title',       id: this._uid(), x: 12,  y: 4,   w: 396, h: 18,  text: '地质图', fontSize: 18, align: 'center' },
            { type: 'map',         id: this._uid(), x: 12,  y: 26,  w: 300, h: 242 },
            { type: 'grid',        id: this._uid(), x: 12,  y: 26,  w: 300, h: 242, interval: 0.02, lineWidth: 0.3, color: '#444' },
            { type: 'north-arrow', id: this._uid(), x: 288, y: 30,  w: 20,  h: 20,  style: 'arrow' },
            { type: 'scalebar',    id: this._uid(), x: 16,  y: 262, w: 110, h: 18 },
            { type: 'legend',      id: this._uid(), x: 320, y: 26,  w: 88,  h: 242 },
            { type: 'title',       id: this._uid(), x: 12,  y: 276, w: 200, h: 12,  text: '数据来源：野外地质调查', fontSize: 8,  align: 'left' },
            { type: 'title',       id: this._uid(), x: 280, y: 276, w: 128, h: 12,  text: '制图人：        制图日期：', fontSize: 8,  align: 'right' },
        ];
        this.selectedId = null;
        this.updatePaperUI();
        this._rebuildAll();
        this.zoomFit();
    },

    _uid() { return 'el_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7); },

    /* ================================================================
       RENDER
       ================================================================ */
    _rebuildAll() {
        var s = this.SCREEN_SCALE;
        this.canvas.style.width  = Math.round(this.paper.width  * s) + 'px';
        this.canvas.style.height = Math.round(this.paper.height * s) + 'px';
        this.canvas.style.transform = 'scale(' + this.canvasZoom + ')';
        this.canvas.innerHTML = '';
        var self = this;
        this.elements.forEach(function(el) { self.canvas.appendChild(self._buildElementDOM(el)); });
        document.getElementById('printPanelZoomIndicator').textContent = Math.round(this.canvasZoom * 100) + '%';
    },

    _updateZoom() {
        this.canvas.style.transform = 'scale(' + this.canvasZoom + ')';
        document.getElementById('printPanelZoomIndicator').textContent = Math.round(this.canvasZoom * 100) + '%';
    },

    _updateElementDOM(el) {
        var div = document.querySelector('.layout-element[data-id="' + el.id + '"]');
        if (!div) return;
        var s = this.SCREEN_SCALE;
        div.style.left   = Math.round(el.x * s) + 'px';
        div.style.top    = Math.round(el.y * s) + 'px';
        div.style.width  = Math.round(el.w * s) + 'px';
        div.style.height = Math.round(el.h * s) + 'px';
        this._refreshElementContent(div, el);
    },

    _buildElementDOM(el) {
        var s = this.SCREEN_SCALE;
        var div = document.createElement('div');
        div.className = 'layout-element ' + el.type + '-element';
        div.dataset.id = el.id;
        div.style.left   = Math.round(el.x * s) + 'px';
        div.style.top    = Math.round(el.y * s) + 'px';
        div.style.width  = Math.round(el.w * s) + 'px';
        div.style.height = Math.round(el.h * s) + 'px';
        if (el.id === this.selectedId) div.classList.add('selected');
        this._refreshElementContent(div, el);
        ['nw','n','ne','e','se','s','sw','w'].forEach(function(c) {
            var h = document.createElement('div'); h.className = 'resize-handle ' + c; div.appendChild(h);
        });
        this._bindElementEvents(div, el);
        return div;
    },

    _refreshElementContent(div, el) {
        switch(el.type) {
            case 'map':         this._renderMap(div, el); break;
            case 'north-arrow': this._renderNorthArrow(div, el); break;
            case 'scalebar':    this._renderScaleBar(div, el); break;
            case 'legend':      this._renderLegend(div, el); break;
            case 'grid':        this._renderGrid(div, el); break;
            case 'title':       this._renderTitle(div, el); break;
        }
    },

    /* ================================================================
       ELEMENT RENDERERS
       ================================================================ */
    _renderMap(div, el) {
        // 每次渲染时重新读取（兜底异步写入延迟）
        var snap = sessionStorage.getItem('mapSnapshot');
        if (snap) {
            this._mapSnapshot = snap;
            div.innerHTML = '<img src="' + snap + '" style="width:100%;height:100%;object-fit:cover;display:block" draggable="false">';
            div.style.background = '';
        } else if (this._mapSnapshot) {
            div.innerHTML = '<img src="' + this._mapSnapshot + '" style="width:100%;height:100%;object-fit:cover;display:block" draggable="false">';
            div.style.background = '';
        } else {
            div.style.background = '#e8e8e8';
            div.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;height:100%;color:#999;font-size:12px;text-align:center">无地图截图<br><small>请从桌面端重新打开出图页面</small></div>';
        }
    },

    _renderNorthArrow(div, el) {
        var style = el.style || 'arrow', svg;
        if (style === 'rose') {
            svg = '<svg viewBox="-20 -20 40 40" width="100%" height="100%"><polygon points="0,-18 4,-4 18,0 4,4 0,18 -4,4 -18,0 -4,-4" fill="#222"/><polygon points="0,-18 4,-4 0,0 -4,-4" fill="#888"/><text x="0" y="20" text-anchor="middle" font-size="8" fill="#222" font-weight="bold">N</text></svg>';
        } else if (style === 'compass') {
            svg = '<svg viewBox="-20 -20 40 40" width="100%" height="100%"><circle cx="0" cy="0" r="18" fill="none" stroke="#222" stroke-width="1"/><polygon points="0,-16 3,-3 16,0 3,3 0,16 -3,3 -16,0 -3,-3" fill="#222"/><polygon points="0,-16 3,-3 0,0 -3,-3" fill="#fff"/><text x="0" y="18" text-anchor="middle" font-size="7" fill="#222" font-weight="bold">N</text></svg>';
        } else {
            svg = '<svg viewBox="-16 -16 32 32" width="100%" height="100%"><polygon points="0,-14 5,10 0,5 -5,10" fill="#222"/><text x="0" y="16" text-anchor="middle" font-size="8" fill="#222" font-weight="bold">N</text></svg>';
        }
        div.innerHTML = svg;
    },

    _formatDMS: function(val, type) {
        var abs = Math.abs(val);
        var d = Math.floor(abs);
        var m = Math.floor((abs - d) * 60);
        var sec = ((abs - d) * 60 - m) * 60;
        var dir = type === 'lng' ? (val >= 0 ? 'E' : 'W') : (val >= 0 ? 'N' : 'S');
        return d + '°' + m + '\'' + sec.toFixed(0) + '"' + dir;
    },

    // 坐标网格渲染 (经纬网)
    _renderGrid(div, el) {
        var s = this.SCREEN_SCALE;
        var wPx = Math.round(el.w * s), hPx = Math.round(el.h * s);
        if (wPx < 40 || hPx < 40) { div.innerHTML = ''; return; }

        var mapEl = this.elements.find(function(e) { return e.type === 'map'; });
        if (!mapEl || !this._mapState) { div.innerHTML = ''; return; }

        var center = this._mapState.center || [35, 105];
        var zoom = this._mapState.zoom || 13;

        // 使用 Leaflet 的分辨率计算
        var metersPerPixel = 156543.03 * Math.cos(center[0] * Math.PI / 180) / Math.pow(2, zoom);
        var lngPerPixel = 360 / (256 * Math.pow(2, zoom));
        var latPerPixel = metersPerPixel / 111320;  // 1度纬度约111320米

        var mapWPx = Math.round(mapEl.w * s);
        var mapHPx = Math.round(mapEl.h * s);
        var west  = center[1] - (mapWPx / 2) * lngPerPixel;
        var east  = center[1] + (mapWPx / 2) * lngPerPixel;
        var north = center[0] + (mapHPx / 2) * latPerPixel;
        var south = center[0] - (mapHPx / 2) * latPerPixel;

        var interval = el.interval || 0.02; // 默认 ~2km 网格间距（度）
        var color = el.color || '#444';
        var lw = el.lineWidth || 0.3;

        var canvas = document.createElement('canvas');
        canvas.width = wPx; canvas.height = hPx;
        canvas.style.width = wPx + 'px'; canvas.style.height = hPx + 'px';
        canvas.style.pointerEvents = 'none';
        var ctx = canvas.getContext('2d');
        ctx.strokeStyle = color;
        ctx.lineWidth = lw;
        ctx.fillStyle = color;
        var fs = Math.max(8, Math.min(11, Math.round(hPx / 30)));
        ctx.font = fs + 'px monospace';

        // 考虑 grid 与 map 的位置差异
        var offsetX = (el.x - mapEl.x) * s;
        var offsetY = (el.y - mapEl.y) * s;

        // 垂直线 (经度)
        var lngStart = Math.ceil(west / interval) * interval;
        for (var lng = lngStart; lng <= east; lng += interval) {
            var x = Math.round((lng - west) / lngPerPixel + offsetX);
            if (x >= 0 && x <= wPx) {
                ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, hPx); ctx.stroke();
                ctx.textAlign = 'center';
                ctx.fillText(this._formatDMS(lng, 'lng'), x, fs + 2);
            }
        }

        // 水平线 (纬度)
        var latStart = Math.ceil(south / interval) * interval;
        for (var lat = latStart; lat <= north; lat += interval) {
            var y = Math.round((north - lat) / latPerPixel + offsetY);
            if (y >= 0 && y <= hPx) {
                ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(wPx, y); ctx.stroke();
                ctx.textAlign = 'left';
                if (y > fs) {
                    ctx.fillText(this._formatDMS(lat, 'lat'), 2, y - 2);
                }
            }
        }

        div.innerHTML = '';
        div.appendChild(canvas);
    },

    _renderScaleBar(div, el) {
        var s = this.SCREEN_SCALE;
        var wPx = Math.round(el.w * s), hPx = Math.round(el.h * s);
        if (wPx < 30 || hPx < 10) { div.innerHTML = ''; return; }

        // 计算实际比例尺：基于地图截图像素尺寸和地理范围
        var scaleDenom = this._calculateMapScale(el);
        // 保持用户手动设置的比例尺优先
        if (el.scale && el.scale > 0) {
            scaleDenom = el.scale;
        }
        
        // 限制比例尺范围，避免显示不合理的数值（如1:1000万）
        if (scaleDenom > 5000000) scaleDenom = 5000000;
        if (scaleDenom < 1000) scaleDenom = 1000;
        
        // 线段比例尺：比例尺元素宽度对应的地面实际距离
        var mapWidthMm = el.w; // 比例尺元素宽度（mm）
        var groundDistMm = mapWidthMm * scaleDenom; // 对应的地面距离（mm）
        var groundDistM = groundDistMm / 1000; // 转换为米
        
        // 计算好看的数值间距（让刻度落在合理的数值上）
        var nice = this._niceNumber(groundDistM);
        // 如果地面距离太大（>1000km），按比例缩小 bar 的显示
        if (nice > 1000000) {
            nice = this._niceNumber(groundDistM / 10);
        }
        var barRatio = nice / groundDistM;
        var barPx = Math.round(Math.min(barRatio * wPx, wPx * 0.85));
        if (barPx < 30) { barPx = Math.min(50, wPx); nice = this._niceNumber(groundDistM * (barPx / wPx)); }
        var segs = 4, segW = barPx / segs;

        var canvas = document.createElement('canvas');
        canvas.width = wPx; canvas.height = hPx;
        canvas.style.width = wPx + 'px'; canvas.style.height = hPx + 'px';
        var ctx = canvas.getContext('2d');
        for (var i = 0; i < segs; i++) {
            ctx.fillStyle = i % 2 === 0 ? '#000' : '#fff';
            ctx.fillRect(i * segW, 1, segW, hPx * 0.5);
        }
        ctx.strokeStyle = '#000'; ctx.lineWidth = 0.5;
        ctx.strokeRect(0, 0, barPx, hPx * 0.5);

        var fs = Math.max(8, Math.round(hPx * 0.35));
        ctx.fillStyle = '#000'; ctx.font = fs + 'px sans-serif';
        ctx.textAlign = 'left';
        ctx.fillText('0', 2, hPx - 2);
        ctx.textAlign = 'right';
        ctx.fillText(this._formatDist(nice), barPx - 2, hPx - 2);
        
        // 数字比例尺 — 换行显示避免截断
        var scaleText = '1:' + this._formatScaleNum(scaleDenom);
        ctx.textAlign = 'left';
        ctx.fillText(scaleText, 0, hPx * 0.45);
        div.innerHTML = '';
        div.appendChild(canvas);
    },

    /* 基于地图状态计算实际比例尺分母 */
    _calculateMapScale: function(mapEl) {
        if (!this._mapState) return 50000;
        
        var center = this._mapState.center || [35, 105];
        var zoom = this._mapState.zoom || 13;
        var mapPixelSize = this._mapState.mapPixelSize || { width: 800, height: 600 };
        var mapBounds = this._mapState.mapBounds;
        
        // 方法1：如果有地理范围，直接计算比例尺
        if (mapBounds) {
            var west = mapBounds.west, east = mapBounds.east;
            var geoWidthDeg = east - west;
            if (geoWidthDeg > 0) {
                // 经度差转换为米（赤道处约 111320 米/度，约筹处约 111320 * cos(lat) 米/度）
                var lat = center[0] || 35;
                var metersPerDeg = 111320 * Math.cos(lat * Math.PI / 180);
                var geoWidthM = geoWidthDeg * metersPerDeg;
                var mapWidthPx = mapPixelSize.width || 800;
                // 地图元素在打印上的宽度（mm）
                var printMapWidthMm = mapEl ? mapEl.w : 340;
                // 比例尺 = 实际地面宽度 / 打印地图宽度
                // scaleDenom = (geoWidthM * 1000 mm/m) / printMapWidthMm
                var scaleDenom = (geoWidthM * 1000) / printMapWidthMm;
                if (scaleDenom > 100 && scaleDenom < 100000000) {
                    return scaleDenom;
                }
            }
        }
        
        // 方法2：基于 Leaflet zoom 级别估算
        // Web Mercator 分辨率：赤道处 156543.03 米/像素，等级 z 下为 156543.03 / 2^z
        var lat = center[0] || 35;
        var metersPerPixel = 156543.03 * Math.cos(lat * Math.PI / 180) / Math.pow(2, zoom);
        var mapWidthPx = this._mapSnapshotSize ? this._mapSnapshotSize.width : (mapPixelSize.width || 800);
        var geoWidthM = mapWidthPx * metersPerPixel;
        var printMapWidthMm = mapEl ? mapEl.w : 340;
        var scaleDenom = (geoWidthM * 1000) / printMapWidthMm;
        
        if (scaleDenom > 100 && scaleDenom < 100000000) {
            return scaleDenom;
        }
        return 50000; // 回退默认值
    },

    setMapScale: function(val) {
        if (val === 'auto') {
            // 自动模式：清除所有比例尺元素的手动设置，让其从地图状态自动计算
            this.elements.forEach(function(el) {
                if (el.type === 'scalebar') {
                    delete el.scale;
                }
            });
            this.notify('已切换为自动比例尺', 'info');
        } else {
            var scaleNum = parseInt(val, 10);
            if (scaleNum > 0) {
                this.elements.forEach(function(el) {
                    if (el.type === 'scalebar') {
                        el.scale = scaleNum;
                    }
                });
                this._rebuildAll();
                this.notify('比例尺已设置为 1:' + this._formatScaleNum(scaleNum), 'success');
            }
        }
    },

    toggleGraticule: function() {
        var show = document.getElementById('printPanelShowGraticule').checked;
        this.elements.forEach(function(el) {
            if (el.type === 'grid') {
                el._hidden = !show;
            }
        });
        this._rebuildAll();
    },

    setGraticuleInterval: function(val) {
        var interval = parseFloat(val);
        this.elements.forEach(function(el) {
            if (el.type === 'grid') {
                el.interval = interval;
            }
        });
        this._rebuildAll();
    },

    _renderLegend(div, el) {
        var hPx = Math.round(el.h * this.SCREEN_SCALE);
        // 更紧凑的字号 + 行距
        var titleFs = Math.max(10, Math.round(hPx / 20)) + 'px';
        var itemFs = Math.max(9, Math.round(hPx / 24)) + 'px';
        var lh = (parseInt(itemFs) + 2) + 'px';  // 行距
        var html = '<div style="font-weight:bold;margin-bottom:2px;font-size:' + titleFs + '">图例</div>';

        var ll = el.legendLayers || { points: true, routes: true, boundaries: true, faults: true, areas: true, photos: true };
        var data = this._loadedData;
        var totalItems = 0;
        var show = function(key) { return ll[key] !== false; };

        function groupByName(items, type, nameFn) {
            var groups = {};
            items.forEach(function(item, idx) {
                var name = nameFn(item, idx);
                if (!groups[name]) groups[name] = { color: null, extra: '' };
                if (!groups[name].color) groups[name].color = item.fill_color || PrintPanel._paletteColor(Object.keys(groups).length - 1, type);
                if (item.fault_type) groups[name].extra = item.fault_type;
                if (item.boundary_type) groups[name].extra = item.boundary_type;
            });
            return groups;
        }

        var itemStyle = 'line-height:' + lh + ';font-size:' + itemFs + ';display:flex;align-items:center;margin:0';

        // ── 点要素 ──
        if (show('points') && data && data.points && data.points.length > 0) {
            var typeGroups = {};
            data.points.forEach(function(p) { var t = p.point_type || '地质观察点'; if (!typeGroups[t]) typeGroups[t] = 0; typeGroups[t]++; });
            Object.keys(typeGroups).sort().forEach(function(t) {
                var hash = 0; for (var i = 0; i < t.length; i++) hash = t.charCodeAt(i) + ((hash << 5) - hash);
                var color = 'hsl(' + (Math.abs(hash) % 360) + ', 60%, 42%)';
                html += '<div style="' + itemStyle + '"><span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:' + color + ';margin-right:4px;flex-shrink:0"></span><span>' + t + '</span></div>';
                totalItems++;
            });
        }
        // ── 面要素 ──
        if (show('areas') && data && data.areas && data.areas.length > 0) {
            if (totalItems > 0) html += '<div style="border-top:0.5px solid #ddd;margin:1px 0"></div>';
            var ag = groupByName(data.areas, 'area', function(a) { return a.name || '未命名面'; });
            Object.keys(ag).sort().forEach(function(name) {
                html += '<div style="' + itemStyle + '"><span style="display:inline-block;width:10px;height:8px;background:' + ag[name].color + ';margin-right:4px;border:1px solid rgba(0,0,0,0.4);flex-shrink:0"></span><span>' + name + '</span></div>';
                totalItems++;
            });
        }
        // ── 断层 ──
        if (show('faults') && data && data.faults && data.faults.length > 0) {
            if (totalItems > 0) html += '<div style="border-top:0.5px solid #ddd;margin:1px 0"></div>';
            var fg = groupByName(data.faults, 'fault', function(f) { return f.name || '未命名断层'; });
            Object.keys(fg).sort().forEach(function(name) {
                var extra = fg[name].extra ? ' (' + fg[name].extra + ')' : '';
                html += '<div style="' + itemStyle + '"><span style="display:inline-block;width:14px;height:2px;background:' + fg[name].color + ';margin-right:4px;flex-shrink:0"></span><span>' + name + extra + '</span></div>';
                totalItems++;
            });
        }
        // ── 地质界线 ──
        if (show('boundaries') && data && data.boundaries && data.boundaries.length > 0) {
            if (totalItems > 0) html += '<div style="border-top:0.5px solid #ddd;margin:1px 0"></div>';
            var bg = groupByName(data.boundaries, 'boundary', function(b) { return b.name || '未命名界线'; });
            Object.keys(bg).sort().forEach(function(name) {
                var extra = bg[name].extra ? ' (' + bg[name].extra + ')' : '';
                html += '<div style="' + itemStyle + '"><span style="display:inline-block;width:14px;height:0;border-top:2px dashed ' + bg[name].color + ';margin-right:4px;flex-shrink:0"></span><span>' + name + extra + '</span></div>';
                totalItems++;
            });
        }
        // ── 路线 ──
        if (show('routes') && data && data.routes && data.routes.length > 0) {
            if (totalItems > 0) html += '<div style="border-top:0.5px solid #ddd;margin:1px 0"></div>';
            var rg = groupByName(data.routes, 'route', function(r) { return r.name || '未命名路线'; });
            Object.keys(rg).sort().forEach(function(name) {
                html += '<div style="' + itemStyle + '"><span style="display:inline-block;width:14px;height:2px;background:' + rg[name].color + ';margin-right:4px;flex-shrink:0"></span><span>' + name + '</span></div>';
                totalItems++;
            });
        }
        if (totalItems === 0) html += '<div style="color:#999;font-size:' + itemFs + ';padding:4px 0">等待数据加载...</div>';
        div.innerHTML = html;
    },

    _renderTitle(div, el) {
        div.contentEditable = 'true';
        div.textContent = el.text || '标题';
        var fontSizePx = Math.round((el.fontSize || 18) * 1.333 * (this.SCREEN_SCALE / 3.0));
        div.style.fontSize = fontSizePx + 'px';
        div.style.textAlign = el.align || 'center';
        div.style.fontWeight = (el.fontSize && el.fontSize < 12) ? 'normal' : 'bold';
        div.style.color = '#000';
        div.style.display = 'flex'; div.style.alignItems = 'center';
        div.style.justifyContent = el.align === 'left' ? 'flex-start' : el.align === 'right' ? 'flex-end' : 'center';
        div.style.padding = '1px 4px'; div.style.whiteSpace = 'nowrap'; div.style.overflow = 'hidden';
    },

    /* ================================================================
       INTERACTION
       ================================================================ */
    _bindElementEvents(div, el) {
        var self = this;
        var startX, startY, startElX, startElY, startW, startH, dragging = false, resizing = false, resizeDir = null;

        div.addEventListener('mousedown', function(e) {
            if (e.target.classList.contains('resize-handle')) {
                resizing = true; resizeDir = e.target.classList[1];
                startX = e.clientX; startY = e.clientY;
                startElX = el.x; startElY = el.y; startW = el.w; startH = el.h;
                e.preventDefault(); e.stopPropagation(); return;
            }
            if (e.target.closest('.resize-handle')) return;
            dragging = true;
            startX = e.clientX; startY = e.clientY;
            startElX = el.x; startElY = el.y;
            self.selectElement(el.id);
            e.preventDefault();
        });

        document.addEventListener('mousemove', function(e) {
            if (!dragging && !resizing) return;
            var dx = (e.clientX - startX) / (self.SCREEN_SCALE * self.canvasZoom);
            var dy = (e.clientY - startY) / (self.SCREEN_SCALE * self.canvasZoom);
            if (resizing) {
                if (resizeDir.indexOf('e') >= 0) el.w = Math.round(Math.max(10, startW + dx) * 10) / 10;
                if (resizeDir.indexOf('w') >= 0) { el.x = Math.round((startElX + dx) * 10) / 10; el.w = Math.round(Math.max(10, startW - dx) * 10) / 10; }
                if (resizeDir.indexOf('s') >= 0) el.h = Math.round(Math.max(8, startH + dy) * 10) / 10;
                if (resizeDir.indexOf('n') >= 0) { el.y = Math.round((startElY + dy) * 10) / 10; el.h = Math.round(Math.max(8, startH - dy) * 10) / 10; }
            } else {
                el.x = Math.round(Math.max(0, startElX + dx) * 10) / 10;
                el.y = Math.round(Math.max(0, startElY + dy) * 10) / 10;
            }
            self._updateElementDOM(el);
            if (self.selectedId === el.id) self.showProperties(el);
        });

        document.addEventListener('mouseup', function() {
            if (dragging || resizing) { dragging = false; resizing = false; if (self.selectedId === el.id) self.showProperties(el); }
        });

        div.addEventListener('click', function(e) { self.selectElement(el.id); e.stopPropagation(); });
        if (el.type === 'title') div.addEventListener('blur', function() { el.text = div.textContent; });
    },

    /* ================================================================
       SELECTION & PROPERTIES
       ================================================================ */
    selectElement(id) {
        this.selectedId = id;
        this.canvas.querySelectorAll('.layout-element').forEach(function(d) { d.classList.toggle('selected', d.dataset.id === id); });
        var el = this._findElement(id);
        if (el) this.showProperties(el);
    },

    showProperties(el) {
        var panel = document.getElementById('printPanelPropPanel');
        if (!panel) return;
        var labels = { map: '🗺️ 主地图', 'north-arrow': '🧭 指北针', scalebar: '📏 比例尺', legend: '📋 图例', title: '✏️ 标题', grid: '🌐 经纬网' };
        var html = '<div class="prop-row"><label>类型</label><span style="color:#aaa">' + (labels[el.type] || el.type) + '</span></div>';
        html += this._propInput(el, 'x', 'X mm', 'number', 0.1);
        html += this._propInput(el, 'y', 'Y mm', 'number', 0.1);
        html += this._propInput(el, 'w', '宽 mm', 'number', 0.1);
        html += this._propInput(el, 'h', '高 mm', 'number', 0.1);

        if (el.type === 'title') {
            html += this._propInput(el, 'text', '文本', 'text');
            html += this._propInput(el, 'fontSize', '字号 pt', 'number');
            html += '<div class="prop-row"><label>对齐</label><select onchange="PrintPanel._updateProp(\'' + el.id + '\',\'align\',this.value)"><option value="left" ' + (el.align==='left'?'selected':'') + '>左</option><option value="center" ' + (el.align==='center'?'selected':'') + '>中</option><option value="right" ' + (el.align==='right'?'selected':'') + '>右</option></select></div>';
        }
        if (el.type === 'north-arrow') {
            html += '<div class="prop-row"><label>样式</label><select onchange="PrintPanel._updateProp(\'' + el.id + '\',\'style\',this.value)"><option value="arrow" ' + ((el.style||'arrow')==='arrow'?'selected':'') + '>箭头</option><option value="rose" ' + (el.style==='rose'?'selected':'') + '>风玫瑰</option><option value="compass" ' + (el.style==='compass'?'selected':'') + '>罗盘</option></select></div>';
        }
        if (el.type === 'scalebar') {
            html += this._propInput(el, 'scale', '比例尺分母', 'number', 1000);
            html += '<div style="font-size:10px;color:#888;margin:2px 0">默认 1:50000，可手动输入</div>';
        }
        if (el.type === 'grid') {
            html += this._propInput(el, 'interval', '间隔(°)', 'number', 0.001);
            html += this._propInput(el, 'lineWidth', '线宽', 'number', 0.1);
            html += '<div class="prop-row"><label>颜色</label><input type="color" value="' + (el.color || '#444') + '" onchange="PrintPanel._updateProp(\'' + el.id + '\',\'color\',this.value)"></div>';
        }

        if (el.type === 'legend') {
            if (!el.legendLayers) el.legendLayers = { points: true, routes: true, boundaries: true, faults: true, areas: true, photos: true };
            html += '<div style="border-top:0.5px solid #444;margin-top:6px;padding-top:6px"><div style="font-size:10px;color:#888;margin-bottom:4px">☑ 显示图层</div>';
            [{key:'points',label:'📍 地质点'},{key:'routes',label:'🔵 野外路线'},{key:'boundaries',label:'🟤 地质界线'},{key:'faults',label:'🔴 断层'},{key:'areas',label:'🟡 地层面'},{key:'photos',label:'📷 照片点'}].forEach(function(l) {
                html += '<div class="prop-row" style="font-size:11px"><label></label><label style="width:auto;text-align:left;display:flex;align-items:center;gap:4px;color:#ccc"><input type="checkbox" ' + (el.legendLayers[l.key]?'checked':'') + ' onchange="PrintPanel._toggleLegendLayer(\'' + el.id + '\',\'' + l.key + '\',this.checked)" style="accent-color:var(--accent)">' + l.label + '</label></div>';
            });
            html += '</div>';
        }

        html += '<div style="margin-top:12px;border-top:0.5px solid #444;padding-top:8px"><button onclick="PrintPanel.deleteElement(\'' + el.id + '\')" style="width:100%;background:#d4380d;border:none;color:#fff;padding:6px;border-radius:4px;cursor:pointer;font-size:12px">🗑️ 删除元素</button></div>';
        panel.innerHTML = html;
    },

    _propInput(el, prop, label, type, step) {
        var val = el[prop] != null ? el[prop] : '';
        return '<div class="prop-row"><label>' + label + '</label><input type="' + type + '" value="' + val + '"' + (step ? ' step="' + step + '"' : '') + ' onchange="PrintPanel._updateProp(\'' + el.id + '\',\'' + prop + '\',this.' + (type === 'number' ? 'valueAsNumber' : 'value') + ')"></div>';
    },

    _updateProp(id, prop, value) {
        var el = this._findElement(id);
        if (!el) return;
        if (prop === 'fontSize') value = Math.max(6, Math.min(200, value || 18));
        if (prop === 'scale') value = Math.max(500, Math.min(5000000, value || 50000));
        el[prop] = value;
        this._updateElementDOM(el);
    },

    _toggleLegendLayer(elId, layerKey, checked) {
        var el = this._findElement(elId);
        if (!el) return;
        if (!el.legendLayers) el.legendLayers = { points: true, routes: true, boundaries: true, faults: true, areas: true, photos: true };
        el.legendLayers[layerKey] = checked;
        this._updateElementDOM(el);
    },

    deleteElement(id) {
        if (!confirm('删除此布局元素？')) return;
        this.elements = this.elements.filter(function(e) { return e.id !== id; });
        if (this.selectedId === id) { this.selectedId = null; document.getElementById('printPanelPropPanel').innerHTML = '<div class="prop-empty">点击画布上的元素<br>查看和编辑属性</div>'; }
        this._rebuildAll();
    },

    /* ================================================================
       ADD ELEMENT
       ================================================================ */
    addElement(type) {
        var defaults = {
            map:          { x: 15, y: 28, w: 300, h: 240 },
            'north-arrow': { x: 290, y: 32, w: 20, h: 20, style: 'arrow' },
            scalebar:     { x: 18, y: 262, w: 110, h: 18 },
            legend:       { x: 322, y: 28, w: 80, h: 240 },
            title:        { x: 15, y: 5, w: 390, h: 20, text: '新标题', fontSize: 16, align: 'center' },
            grid:         { x: 15, y: 28, w: 300, h: 240, interval: 0.02, lineWidth: 0.3, color: '#444' },
        };
        var el = Object.assign({ type: type, id: this._uid() }, defaults[type] || { x: 50, y: 50, w: 200, h: 100 });
        this.elements.push(el);
        this._rebuildAll();
        this.selectElement(el.id);
        this.notify('已添加 ' + ({map:'主地图','north-arrow':'指北针',scalebar:'比例尺',legend:'图例',title:'标题',grid:'经纬网'})[type], 'success');
    },

    /* ================================================================
       PAPER & ZOOM
       ================================================================ */
    setPaperPreset(val) {
        var presets = { A4_L: [297, 210], A3_L: [420, 297] };
        if (presets[val]) {
            var oldW = this.paper.width, newW = presets[val][0], sx = newW / oldW;
            var oldH = this.paper.height, newH = presets[val][1], sy = newH / oldH;
            if (this.elements.length > 0 && (sx !== 1 || sy !== 1)) {
                this.elements.forEach(function(el) { el.x = Math.round(el.x * sx * 10) / 10; el.y = Math.round(el.y * sy * 10) / 10; el.w = Math.round(el.w * sx * 10) / 10; el.h = Math.round(el.h * sy * 10) / 10; });
            }
            this.paper.width = newW; this.paper.height = newH;
            document.getElementById('printPanelPaperW').value = this.paper.width;
            document.getElementById('printPanelPaperH').value = this.paper.height;
            document.getElementById('printPanelPaperPreset').value = val;
        }
        this._rebuildAll(); this.zoomFit();
    },

    setPaperCustom() {
        var w = parseInt(document.getElementById('printPanelPaperW').value) || 420;
        var h = parseInt(document.getElementById('printPanelPaperH').value) || 297;
        this.paper.width = w; this.paper.height = h;
        document.getElementById('printPanelPaperPreset').value = 'CUSTOM';
        this._rebuildAll(); this.zoomFit();
    },

    setDpi(val) { this.dpi = parseInt(val); },
    updatePaperUI() { document.getElementById('printPanelPaperW').value = this.paper.width; document.getElementById('printPanelPaperH').value = this.paper.height; },

    zoomIn()  { this.canvasZoom = Math.min(this.ZOOM_MAX, this.canvasZoom * 1.25); this._updateZoom(); },
    zoomOut() { this.canvasZoom = Math.max(this.ZOOM_MIN, this.canvasZoom / 1.25); this._updateZoom(); },
    zoomFit() {
        var pw = this.paper.width * this.SCREEN_SCALE, ph = this.paper.height * this.SCREEN_SCALE;
        this.canvasZoom = Math.min((this.canvasArea.clientWidth - 48) / pw, (this.canvasArea.clientHeight - 48) / ph, 2.0);
        this._updateZoom();
    },

    /* ================================================================
       SAVE / LOAD
       ================================================================ */
    saveLayout() {
        if (!this.projectId) return;
        localStorage.setItem('print-layout-' + this.projectId, JSON.stringify({ paper: this.paper, dpi: this.dpi, elements: this.elements }));
        this.notify('布局已保存', 'success');
    },

    loadLayout() {
        if (!this.projectId) return;
        var saved = localStorage.getItem('print-layout-' + this.projectId);
        if (!saved) { this.notify('未找到保存的布局', 'info'); return; }
        var data = JSON.parse(saved);
        this.paper = data.paper; this.dpi = data.dpi || 300; this.elements = data.elements || [];
        this.selectedId = null; this.updatePaperUI(); this._rebuildAll(); this.zoomFit();
        this.notify('布局已加载', 'success');
    },

    newLayout() {
        if (!confirm('新建布局将清除当前所有元素，确定？')) return;
        this.elements = []; this.selectedId = null; this.paper = { width: 420, height: 297 };
        this.setDefaultLayout();
    },

    /* ================================================================
       EXPORT
       ================================================================ */
    _showExportOverlay(t) { document.getElementById('printPanelExportOverlay').style.display = 'flex'; document.getElementById('printPanelExportText').textContent = t; },
    _hideExportOverlay() { document.getElementById('printPanelExportOverlay').style.display = 'none'; },

    async exportPdf() {
        this._showExportOverlay('正在渲染 ' + this.dpi + 'DPI...');
        await this._sleep(100);
        try {
            var canvas = await this._captureCanvas();
            this._showExportOverlay('正在打包 PDF...');
            await this._sleep(50);
            await this._ensureJsPdf();
            var pdf = new jspdf.jsPDF({ orientation: this.paper.width > this.paper.height ? 'landscape' : 'portrait', unit: 'mm', format: [this.paper.width, this.paper.height] });
            pdf.addImage(canvas.toDataURL('image/png'), 'PNG', 0, 0, this.paper.width, this.paper.height);
            pdf.save('地质图_' + new Date().toISOString().slice(0,10) + '.pdf');
            this._hideExportOverlay(); this.notify('PDF 导出完成', 'success');
        } catch(e) { this._hideExportOverlay(); this.notify('导出失败: ' + (e.message || '未知错误'), 'error'); }
    },

    async exportPng() {
        this._showExportOverlay('正在渲染...');
        await this._sleep(100);
        try {
            var canvas = await this._captureCanvas();
            canvas.toBlob(function(blob) { var a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = '地质图_' + new Date().toISOString().slice(0,10) + '.png'; a.click(); });
            this._hideExportOverlay(); this.notify('PNG 导出完成', 'success');
        } catch(e) { this._hideExportOverlay(); this.notify('导出失败', 'error'); }
    },

    async exportSvg() {
        this._showExportOverlay('正在渲染...');
        await this._sleep(100);
        try {
            var canvas = await this._captureCanvas();
            var svg = '<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="' + this.paper.width + 'mm" height="' + this.paper.height + 'mm" viewBox="0 0 ' + canvas.width + ' ' + canvas.height + '"><image width="100%" height="100%" xlink:href="' + canvas.toDataURL('image/png') + '"/></svg>';
            var blob = new Blob([svg], { type: 'image/svg+xml' });
            var a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = '地质图_' + new Date().toISOString().slice(0,10) + '.svg'; a.click();
            this._hideExportOverlay(); this.notify('SVG 导出完成', 'info');
        } catch(e) { this._hideExportOverlay(); this.notify('导出失败', 'error'); }
    },

    async _captureCanvas() {
        var oldZoom = this.canvasZoom;
        this.canvasZoom = 1.0; this._updateZoom();
        await this._sleep(300);
        var html2canvas = await this._ensureHtml2canvas();
        var rawCanvas = await html2canvas(this.canvas, { useCORS: true, allowTaint: true, scale: 1, backgroundColor: '#ffffff' });
        var scaleFactor = (this.dpi / 25.4) / this.SCREEN_SCALE;
        var finalCanvas = document.createElement('canvas');
        finalCanvas.width = Math.round(rawCanvas.width * scaleFactor);
        finalCanvas.height = Math.round(rawCanvas.height * scaleFactor);
        var ctx = finalCanvas.getContext('2d');
        ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(rawCanvas, 0, 0, finalCanvas.width, finalCanvas.height);
        this.canvasZoom = oldZoom; this._updateZoom();
        return finalCanvas;
    },

    /* ================================================================
       HELPERS
       ================================================================ */
    _findElement(id) { return this.elements.find(function(e) { return e.id === id; }); },

    _paletteColor: function(idx, type) {
        var palettes = {
            area:     ['#fff2cc','#d9ead3','#cfe2f3','#fce5cd','#ead1dc','#d0e0e3','#e6d5c3','#c9daf8','#f4cccc','#d9d2e9','#b6d7a8','#a2c4c9','#ffe599','#b4a7d6','#f9cb9c','#a4c2f4'],
            fault:    ['#e60000','#cc0000','#ff3333','#b30000','#ff6666','#990000','#ff1a1a','#d90000','#e63946','#c1121f'],
            boundary: ['#8b4513','#a0522d','#6b3410','#cd853f','#d2691e','#b8860b','#8b6914','#a0722d','#7b3f1a','#9c5221'],
            route:    ['#1a73e8','#0d47a1','#1565c0','#1976d2','#2196f3','#42a5f5','#64b5f6','#0b5ed7','#084298','#0a58ca'],
        };
        return (palettes[type] || palettes['area'])[idx % (palettes[type] || palettes['area']).length];
    },

    _niceNumber(val) {
        if (val <= 0) return 100;
        var exp = Math.pow(10, Math.floor(Math.log10(val))), mant = val / exp;
        if (mant <= 2) mant = 2; else if (mant <= 5) mant = 5; else mant = 10;
        return mant * exp;
    },

    _formatDist(m) { return m >= 1000 ? (m/1000).toFixed(1).replace(/\.0$/,'') + ' km' : Math.round(m) + ' m'; },
    _formatScaleNum(n) { return Math.round(n).toLocaleString(); },
    _sleep(ms) { return new Promise(function(r) { setTimeout(r, ms); }); },

    _ensureHtml2canvas() {
        if (window.html2canvas) return window.html2canvas;
        return new Promise(function(resolve, reject) {
            var s = document.createElement('script'); s.src = 'https://cdn.jsdelivr.net/npm/html2canvas@1.4.1/dist/html2canvas.min.js';
            s.onload = function() { resolve(window.html2canvas); }; s.onerror = reject; document.head.appendChild(s);
        });
    },

    _ensureJsPdf() {
        if (window.jspdf) return Promise.resolve(window.jspdf);
        return new Promise(function(resolve, reject) {
            var s = document.createElement('script'); s.src = 'https://cdn.jsdelivr.net/npm/jspdf@2.5.1/dist/jspdf.umd.min.js';
            s.onload = function() { resolve(window.jspdf); }; s.onerror = reject; document.head.appendChild(s);
        });
    },

    notify(message, type) {
        var el = document.createElement('div'); el.className = 'notification ' + (type || 'info'); el.textContent = message;
        document.body.appendChild(el); setTimeout(function() { el.remove(); }, 3000);
    },

    /* ===== 模态框控制 ===== */
    open: function() {
        var overlay = document.getElementById('printPanelOverlay');
        if (!overlay) return;
        overlay.style.display = 'flex';
        document.body.style.overflow = 'hidden';
        this.init();
    },

    close: function() {
        var overlay = document.getElementById('printPanelOverlay');
        if (overlay) overlay.style.display = 'none';
        document.body.style.overflow = '';
    },
};

// ESC 关闭
document.addEventListener('keydown', function(e) {
    if (e.key === 'Escape') PrintPanel.close();
});
