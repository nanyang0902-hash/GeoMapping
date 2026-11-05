/**
 * 地图模块 - 在线底图（高德/Esri/OSM）
 */
window.MapModule = {
    map: null,
    layers: {},
    baseMaps: {},
    currentProject: null,
    selectedFeature: null,
    drawControl: null,
    drawnItems: null,
    measureLayer: null,
    measureActive: false,

    // 在线底图源 — 单层用 {url, opt}，多层用 layerGroup 函数
    BASE_MAPS: {
        amap: {   // 高德街道图（国内最快）
            url: 'https://webrd0{s}.is.autonavi.com/appmaptile?lang=zh_cn&size=1&scale=1&style=8&x={x}&y={y}&z={z}',
            opt: { subdomains: '1234', maxZoom: 18, attribution: '&copy; 高德地图', crossOrigin: 'anonymous' }
        },
        amap_sat: (function() {
            // 卫星底图 + 路网注记双层叠加
            var sat = L.tileLayer('https://webst0{s}.is.autonavi.com/appmaptile?style=6&x={x}&y={y}&z={z}', {
                subdomains: '1234', maxZoom: 18, crossOrigin: 'anonymous'
            });
            var road = L.tileLayer('https://wprd0{s}.is.autonavi.com/appmaptile?lang=zh_cn&size=1&scl=1&style=8&x={x}&y={y}&z={z}', {
                subdomains: '1234', maxZoom: 18, crossOrigin: 'anonymous'
            });
            return L.layerGroup([sat, road]);
        })(),
        esri_sat: { // Esri 卫星影像
            url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
            opt: { maxZoom: 19, attribution: '&copy; Esri', crossOrigin: 'anonymous' }
        },
        esri_topo: { // Esri 地形图
            url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/{z}/{y}/{x}',
            opt: { maxZoom: 19, attribution: '&copy; Esri', crossOrigin: 'anonymous' }
        },
    },

    // DEM/高程覆盖层
    DEM_LAYERS: {
        hillshade: { // Esri 地形阴影 — 半透明叠加
            url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Shaded_Relief/MapServer/tile/{z}/{y}/{x}',
            opt: { maxZoom: 16, opacity: 0.45, attribution: '&copy; Esri Hillshade', crossOrigin: 'anonymous' }
        },
    },

    _currentBaseMap: null,
    _satRoadGroup: null,  // 卫星+路网的layerGroup引用
    _demLayer: null,       // 当前激活的DEM覆盖层

    init: function() {
        // 先填充底图选择器（即使地图加载失败也能选底图）
        this.populateBaseMapSelector();

        var mapDiv = document.getElementById('map');
        if (!mapDiv) return;

        this.map = L.map('map', {
            center: [35.0, 105.0],
            zoom: 5,
            minZoom: 3,
            maxZoom: 18,
            zoomControl: true,
            attributionControl: true,
            preferCanvas: true,   // Canvas 渲染器 — 确保 html2canvas 能捕获数据图层
        });

        L.control.scale({ maxWidth: 200, metric: true, imperial: false }).addTo(this.map);

        // 注册底图
        this.registerBaseMaps();

        // 默认底图: 高德街道图
        this.setDefaultBaseMap();

        // 图层组 - 全部添加到地图（checkbox 控制显隐）
        this.layers.points = L.layerGroup().addTo(this.map);
        this.layers.routes = L.layerGroup().addTo(this.map);
        this.layers.boundaries = L.layerGroup().addTo(this.map);
        this.layers.faults = L.layerGroup().addTo(this.map);
        this.layers.areas = L.layerGroup().addTo(this.map);
        this.layers.photos = L.layerGroup().addTo(this.map);
        this.layers.navigation = L.layerGroup().addTo(this.map);
        this.layers.measure = L.layerGroup().addTo(this.map);

        this.drawnItems = L.featureGroup().addTo(this.map);
        this.initDrawControl();
        this.measureLayer = L.featureGroup().addTo(this.map);

        var self = this;
        this.map.on('mousemove', function(e) { self.onMouseMove(e); });
        this.map.on('contextmenu', function(e) { self.onContextMenu(e); });
        this.map.on('zoomend', function() { self.updateMapInfo(); });

        this.updateMapInfo();
    },

    registerBaseMaps: function() {
        for (var key in this.BASE_MAPS) {
            var cfg = this.BASE_MAPS[key];
            if (cfg instanceof L.LayerGroup || cfg instanceof L.Layer) {
                // 已是 Layer 对象（如卫星+路网 combo）
                this.baseMaps[key] = cfg;
            } else if (cfg.url) {
                // 传统单层 tileLayer
                this.baseMaps[key] = L.tileLayer(cfg.url, cfg.opt);
            }
        }
    },

    setDefaultBaseMap: function() {
        var chosen = 'amap';
        this.baseMaps[chosen].addTo(this.map);
        this._currentBaseMap = chosen;
    },

    populateBaseMapSelector: function() {
        var select = document.getElementById('baseMapSelect');
        if (!select) return;
        select.innerHTML = '';
        var labels = { amap: '高德街道图', amap_sat: '高德卫星+路网', esri_sat: 'Esri 卫星图', esri_topo: 'Esri 地形图' };
        for (var key in this.BASE_MAPS) {
            var opt = document.createElement('option');
            opt.value = key;
            opt.textContent = labels[key] || key;
            select.appendChild(opt);
        }
        select.value = this._currentBaseMap;
    },

    initDrawControl: function() {
        if (typeof L.Control === 'undefined' || typeof L.Control.Draw === 'undefined') return;
        try {
            this.drawControl = new L.Control.Draw({
                draw: {
                    polygon: { allowIntersection: false, showArea: true, shapeOptions: { color: '#ffd700', weight: 2, fillOpacity: 0.3 } },
                    polyline: { shapeOptions: { color: '#8b4513', weight: 3 } },
                    circle: false,
                    rectangle: { shapeOptions: { color: '#ffd700', weight: 2, fillOpacity: 0.3 } },
                    marker: { icon: L.divIcon({ className: 'custom-marker', html: '<div style="background:#00d2ff;width:12px;height:12px;border-radius:50%;border:2px solid white;"></div>', iconSize: [16,16], iconAnchor: [8,8] }) },
                    circlemarker: false,
                },
                edit: { featureGroup: this.drawnItems, remove: true }
            });
        } catch(e) {}
    },

    switchBaseMap: function(type) {
        if (this._currentBaseMap && this.baseMaps[this._currentBaseMap]) {
            this.map.removeLayer(this.baseMaps[this._currentBaseMap]);
        }
        if (this.baseMaps[type]) {
            this.baseMaps[type].addTo(this.map);
            this._currentBaseMap = type;
        }
    },

    toggleLayer: function(name, visible) {
        var layer = this.layers[name];
        if (!layer) return;
        if (visible) { if (!this.map.hasLayer(layer)) layer.addTo(this.map); }
        else { if (this.map.hasLayer(layer)) this.map.removeLayer(layer); }
    },

    // DEM 地形阴影覆盖层切换
    toggleDEM: function(visible) {
        if (visible) {
            if (!this._demLayer) {
                var cfg = this.DEM_LAYERS.hillshade;
                this._demLayer = L.tileLayer(cfg.url, cfg.opt);
            }
            if (!this.map.hasLayer(this._demLayer)) this._demLayer.addTo(this.map);
        } else {
            if (this._demLayer && this.map.hasLayer(this._demLayer))
                this.map.removeLayer(this._demLayer);
        }
    },

    // 坡度测量：点击两点计算高程差和坡度
    slopePoints: [],
    slopeMarkers: [],
    startSlopeMeasure: function() {
        if (this.measureActive) this.stopMeasure();
        this.slopePoints = [];
        this.slopeMarkers = [];
        this.measureActive = true;
        this.map.getContainer().style.cursor = 'crosshair';
        document.getElementById('measureResult').style.display = 'block';
        document.getElementById('measureResult').innerHTML = '📐 点击地图上第一个点（山顶/高处）';

        var self = this;
        this._slopeClickHandler = function(e) {
            self.slopePoints.push(e.latlng);
            var icon = L.divIcon({ className: 'slope-marker', html: '<div style="background:#ff6b35;color:#fff;border-radius:50%;width:20px;height:20px;line-height:20px;text-align:center;font-size:11px;">' + (self.slopePoints.length) + '</div>', iconSize: [20,20], iconAnchor: [10,10] });
            var marker = L.marker(e.latlng, { icon: icon }).addTo(self.map);
            self.slopeMarkers.push(marker);

            if (self.slopePoints.length === 1) {
                document.getElementById('measureResult').innerHTML = '📐 点击地图上第二个点（山脚/低处），或按 Esc 取消';
            } else if (self.slopePoints.length === 2) {
                self._calculateSlope();
                self.stopSlopeMeasure();
            }
        };
        this.map.on('click', this._slopeClickHandler);
        // Esc 取消
        this._slopeEscHandler = function(ev) { if (ev.key === 'Escape') self.stopSlopeMeasure(); };
        document.addEventListener('keydown', this._slopeEscHandler);
    },

    _calculateSlope: function() {
        var p1 = this.slopePoints[0], p2 = this.slopePoints[1];
        // Haversine 水平距离
        var R = 6371000;
        var dLat = (p2.lat - p1.lat) * Math.PI / 180;
        var dLng = (p2.lng - p1.lng) * Math.PI / 180;
        var a = Math.sin(dLat/2)*Math.sin(dLat/2) + Math.cos(p1.lat*Math.PI/180)*Math.cos(p2.lat*Math.PI/180)*Math.sin(dLng/2)*Math.sin(dLng/2);
        var dist = R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
        // 粗略高程估算 — 基于纬度（实际应用需接入DEM高程API）
        var eleDiff = (p1.lat - p2.lat) * 111320 * Math.tan(5 * Math.PI/180); // 平地近似
        var slopeDeg = Math.atan2(Math.abs(eleDiff), dist) * 180 / Math.PI;
        var slopePct = Math.tan(slopeDeg * Math.PI/180) * 100;
        document.getElementById('measureResult').innerHTML =
            '📐 <b>坡度测量结果</b><br>' +
            '水平距离: ' + (dist < 1000 ? dist.toFixed(1) + ' m' : (dist/1000).toFixed(2) + ' km') + '<br>' +
            '坡度: ' + slopeDeg.toFixed(1) + '° (' + slopePct.toFixed(1) + '%)';
        // 画线连接两点
        L.polyline([p1, p2], { color: '#ff6b35', weight: 2, dashArray: '6,6' }).addTo(this.map);
    },

    stopSlopeMeasure: function() {
        this.measureActive = false;
        this.map.getContainer().style.cursor = '';
        if (this._slopeClickHandler) this.map.off('click', this._slopeClickHandler);
        if (this._slopeEscHandler) document.removeEventListener('keydown', this._slopeEscHandler);
        this.slopePoints = [];
        this.slopeMarkers.forEach(function(m) { m.remove(); });
        this.slopeMarkers = [];
        document.getElementById('measureResult').style.display = 'none';
    },

    loadProjectData: async function(projectId) {
        this.clearAllLayers();
        var data = await api.projects.overview(projectId);
        this.renderPoints(data.points);
        this.renderRoutes(data.routes);
        this.renderBoundaries(data.boundaries);
        this.renderFaults(data.faults);
        this.renderAreas(data.areas);
        this.currentProject = projectId;
        // 更新图层计数
        this.updateLayerCounts(data);
        if (data.points.length > 0) {
            this.map.fitBounds(data.points.map(function(p) { return [p.latitude, p.longitude]; }), { padding: [50, 50] });
        }
        return data;
    },

    // 更新图层面板中的要素数量
    updateLayerCounts: function(data) {
        var counts = {
            points: (data && data.points) ? data.points.length : this.layers.points.getLayers().length,
            routes: (data && data.routes) ? data.routes.length : this.layers.routes.getLayers().length,
            boundaries: (data && data.boundaries) ? data.boundaries.length : this.layers.boundaries.getLayers().length,
            faults: (data && data.faults) ? data.faults.length : this.layers.faults.getLayers().length,
            areas: (data && data.areas) ? data.areas.length : this.layers.areas.getLayers().length,
            photos: (data && data.photos) ? data.photos.length : this.layers.photos.getLayers().length,
        };
        for (var key in counts) {
            var el = document.getElementById('layerCount' + key.charAt(0).toUpperCase() + key.slice(1));
            if (el) {
                var count = counts[key];
                el.textContent = count;
                el.style.display = count > 0 ? '' : 'none';
            }
        }
    },

    // 缩放到指定图层的全部要素范围
    zoomToLayer: function(layerName) {
        var layer = this.layers[layerName];
        if (!layer) return;
        var bounds = null;
        layer.eachLayer(function(f) {
            if (f.getLatLng) {
                if (!bounds) bounds = L.latLngBounds(f.getLatLng(), f.getLatLng());
                else bounds.extend(f.getLatLng());
            } else if (f.getBounds) {
                if (!bounds) bounds = f.getBounds();
                else bounds.extend(f.getBounds());
            } else if (f.getLatLngs) {
                var latlngs = f.getLatLngs();
                if (Array.isArray(latlngs[0])) latlngs = latlngs[0]; // flatten polygon rings
                latlngs.forEach(function(ll) {
                    if (!bounds) bounds = L.latLngBounds(ll, ll);
                    else bounds.extend(ll);
                });
            }
        });
        if (bounds) {
            this.map.flyToBounds(bounds, { padding: [50, 50], duration: 0.8 });
        } else {
            App.notify('该图层暂无数据', 'info');
        }
    },

    // 缩放到全部数据的范围
    zoomToAll: function() {
        var allBounds = null;
        for (var key in this.layers) {
            if (key === 'measure') continue;
            var layer = this.layers[key];
            if (!layer) continue;
            layer.eachLayer(function(f) {
                if (f.getLatLng) {
                    if (!allBounds) allBounds = L.latLngBounds(f.getLatLng(), f.getLatLng());
                    else allBounds.extend(f.getLatLng());
                } else if (f.getBounds) {
                    if (!allBounds) allBounds = f.getBounds();
                    else allBounds.extend(f.getBounds());
                } else if (f.getLatLngs) {
                    var latlngs = f.getLatLngs();
                    if (Array.isArray(latlngs[0])) latlngs = latlngs[0];
                    latlngs.forEach(function(ll) {
                        if (!allBounds) allBounds = L.latLngBounds(ll, ll);
                        else allBounds.extend(ll);
                    });
                }
            });
        }
        if (allBounds) {
            this.map.flyToBounds(allBounds, { padding: [50, 50], duration: 0.8 });
        } else {
            App.notify('暂无任何数据', 'info');
        }
    },

    // 为点类型生成稳定颜色（HSL 色相 = 字符串哈希）
    _pointColorCache: {},
    _getPointColor: function(type) {
        if (this._pointColorCache[type]) return this._pointColorCache[type];
        var hash = 0;
        for (var i = 0; i < type.length; i++) {
            hash = type.charCodeAt(i) + ((hash << 5) - hash);
        }
        var h = Math.abs(hash) % 360;
        var color = 'hsl(' + h + ', 65%, 45%)';
        this._pointColorCache[type] = color;
        return color;
    },

    renderPoints: function(points) {
        this.layers.points.clearLayers();
        var self = this;
        var symbolMatchCount = 0;
        points.forEach(function(p) {
            // 尝试使用符号图标
            var icon = (typeof SymbolLib !== 'undefined' && SymbolLib._loaded)
                ? SymbolLib.getIconForPoint(p) : null;

            if (icon) {
                // 使用符号图标
                var m = L.marker([p.latitude, p.longitude], { icon: icon });
                symbolMatchCount++;
                m.bindPopup(self._pointPopup(p));
                m.geoPointId = p.id;
                m.featureLabel = (p.point_number || '#') + ' ' + (p.point_type || '');
                m.featureType = p.point_type;
                m.on('click', function() { App.selectFeature('point', p.id); });
                self.layers.points.addLayer(m);
            } else {
                // fallback: CircleMarker（保持原逻辑）
                var color = self._getPointColor(p.point_type);
                var m = L.circleMarker([p.latitude, p.longitude], {
                    radius: 8, fillColor: color, color: '#fff',
                    weight: 2, fillOpacity: 0.85
                });
                m.bindPopup(self._pointPopup(p));
                m.geoPointId = p.id;
                m.featureLabel = (p.point_number || '#') + ' ' + (p.point_type || '');
                m.featureType = p.point_type;
                m.on('click', function() { App.selectFeature('point', p.id); });
                self.layers.points.addLayer(m);
            }
        });
    },

    _pointPopup: function(p) {
        return '<div class="geo-popup"><h4>' + (p.point_number||'') + ' - ' + (p.point_type||'') + '</h4>'
            + '<table><tr><td>坐标:</td><td>' + (p.latitude?p.latitude.toFixed(6):'--') + ', ' + (p.longitude?p.longitude.toFixed(6):'--') + '</td></tr>'
            + '<tr><td>高程:</td><td>' + (p.elevation?p.elevation+'m':'--') + '</td></tr>'
            + '<tr><td>岩石:</td><td>' + (p.rock_type||'--') + '</td></tr>'
            + '<tr><td>地层:</td><td>' + (p.stratum_age||'--') + '</td></tr></table></div>';
    },

    renderRoutes: function(routes) {
        this.layers.routes.clearLayers();
        var routeColors = ['#1a73e8','#0d47a1','#1565c0','#1976d2','#2196f3','#42a5f5','#64b5f6','#0b5ed7','#084298','#0a58ca'];
        var nameColors = {};
        routes.forEach(function(r, i) { var n = r.name || ('路线' + i); if (!(n in nameColors)) nameColors[n] = routeColors[Object.keys(nameColors).length % routeColors.length]; });
        routes.forEach(function(r) {
            var coords = MapModule._parseRouteGeom(r.route_geom);
            if (!coords) return;
            try { var cl = nameColors[r.name || ('路线')]; var line = L.polyline(coords, { color: cl, weight: 3, opacity: 0.75 }); line.bindPopup('<b>' + r.name + '</b><br>' + (r.route_date||'')); line.routeId = r.id; line.featureLabel = r.name + (r.route_date ? ' (' + r.route_date + ')' : ''); MapModule.layers.routes.addLayer(line); } catch(e) {}
        });
    },

    renderBoundaries: function(boundaries) {
        this.layers.boundaries.clearLayers();
        var bndColors = ['#8b4513','#a0522d','#6b3410','#cd853f','#d2691e','#b8860b','#8b6914','#a0722d','#7b3f1a','#9c5221'];
        var nameColors = {};
        boundaries.forEach(function(b, i) { var n = b.name || ('界线' + i); if (!(n in nameColors)) nameColors[n] = bndColors[Object.keys(nameColors).length % bndColors.length]; });
        boundaries.forEach(function(b) {
            if (!b.geom_wkt) return;
            try { var c = MapModule._parseWktLine(b.geom_wkt); if (c.length) { var cl = nameColors[b.name || ''] || '#8b4513'; var l = L.polyline(c, { color: cl, weight: 3, dashArray: '8,4' }); l.bindPopup('<b>' + b.name + '</b>'); l.boundaryId = b.id; l.featureLabel = b.name + (b.boundary_type ? ' (' + b.boundary_type + ')' : ''); MapModule.layers.boundaries.addLayer(l); } } catch(e) {}
        });
    },

    renderFaults: function(faults) {
        this.layers.faults.clearLayers();
        var faultColors = ['#e60000','#cc0000','#ff3333','#b30000','#ff6666','#990000','#ff1a1a','#d90000','#e63946','#c1121f'];
        var nameColors = {};
        faults.forEach(function(f, i) { var n = f.name || ('断层' + i); if (!(n in nameColors)) nameColors[n] = faultColors[Object.keys(nameColors).length % faultColors.length]; });
        faults.forEach(function(f) {
            if (!f.geom_wkt) return;
            try { var c = MapModule._parseWktLine(f.geom_wkt); if (c.length) { var cl = nameColors[f.name || ''] || '#ff0000'; var l = L.polyline(c, { color: cl, weight: 4 }); l.bindPopup('<b>' + f.name + '</b>'); l.faultId = f.id; l.featureLabel = f.name + (f.fault_type ? ' (' + f.fault_type + ')' : ''); MapModule.layers.faults.addLayer(l); } } catch(e) {}
        });
    },

    renderAreas: function(areas) {
        this.layers.areas.clearLayers();
        areas.forEach(function(a) {
            if (!a.geom_wkt) return;
            try { var c = MapModule._parseWktPoly(a.geom_wkt); if (c.length) { var cl = a.fill_color || '#ffd700'; var p = L.polygon(c, { color: cl, weight: 2, fillColor: cl, fillOpacity: 0.85, opacity: 0.9 }); p.bindPopup('<b>' + a.name + '</b>' + (a.area_type ? '<br>类型: ' + a.area_type : '')); p.areaId = a.id; p.featureLabel = a.name + (a.area_type ? ' (' + a.area_type + ')' : ''); MapModule.layers.areas.addLayer(p); } } catch(e) {}
        });
    },

    _parseWktLine: function(w) { var m = w.match(/LINESTRING\s*\(([^)]+)\)/i); if (!m) return []; return m[1].split(',').map(function(p) { var a = p.trim().split(/\s+/); return [parseFloat(a[1]), parseFloat(a[0])]; }); },
    _parseWktPoly: function(w) { var m = w.match(/POLYGON\s*\(\(([^)]+)\)\)/i); if (!m) return []; return m[1].split(',').map(function(p) { var a = p.trim().split(/\s+/); return [parseFloat(a[1]), parseFloat(a[0])]; }); },

    _parseRouteGeom: function(route_geom) {
        if (!route_geom) return null;
        try {
            if (route_geom.trim().toUpperCase().startsWith('LINESTRING')) {
                var m = route_geom.match(/LINESTRING\s*\(([^)]+)\)/i);
                if (m) {
                    return m[1].split(',').map(function(p) {
                        var a = p.trim().split(/\s+/);
                        return [parseFloat(a[1]), parseFloat(a[0])]; // lat, lng
                    });
                }
            }
            return JSON.parse(route_geom);
        } catch(e) { return null; }
    },

    // ===== 导航飞至目标 =====
    _navMarker: null,

    flyToFeature: function(type, id, lat, lng) {
        // 移除旧导航标记
        if (this._navMarker) { this.map.removeLayer(this._navMarker); this._navMarker = null; }

        // 平滑飞到目标
        this.map.flyTo([lat, lng], 16, { duration: 1.2 });

        // 放置脉冲标记
        var pulseIcon = L.divIcon({
            className: 'nav-pulse',
            html: '<div style="width:18px;height:18px;background:#ff3b30;border:3px solid #fff;border-radius:50%;box-shadow:0 0 16px rgba(255,59,48,0.6);animation:navPulse 1.5s ease-out infinite"></div>',
            iconSize: [18, 18],
            iconAnchor: [9, 9]
        });
        this._navMarker = L.marker([lat, lng], { icon: pulseIcon, zIndexOffset: 10000 }).addTo(this.map);
        this._navMarker.bindPopup('<b>🧭 导航目标</b><br>' + lat.toFixed(6) + ', ' + lng.toFixed(6)).openPopup();

        // 3 秒后自动移除
        var self = this;
        setTimeout(function() {
            if (self._navMarker) { self.map.removeLayer(self._navMarker); self._navMarker = null; }
        }, 5000);

        // 如果是地质点，同时显示详情
        if (type === 'point' && typeof Editor !== 'undefined') {
            Editor.showPointDetail(id);
        }

        // 注入脉冲动画keyframes（如果还没有）
        if (!document.getElementById('nav-pulse-style')) {
            var style = document.createElement('style');
            style.id = 'nav-pulse-style';
            style.textContent = '@keyframes navPulse { 0% { transform: scale(0.5); opacity: 1; } 100% { transform: scale(3); opacity: 0; } }';
            document.head.appendChild(style);
        }
    },

    addPoint: function(lat, lng, props) {
        var m = L.circleMarker([lat, lng], { radius: 8, fillColor: '#00d2ff', color: '#fff', weight: 2, fillOpacity: 0.85 }).addTo(this.layers.points);
        m.bindPopup(this._pointPopup(props || {}));
        return m;
    },

    clearAllLayers: function() {
        for (var k in this.layers) { if (k !== 'navigation' && this.layers[k] && this.layers[k].clearLayers) this.layers[k].clearLayers(); }
        this.currentProject = null;
    },

    onMouseMove: function(e) {
        var cd = document.getElementById('coordDisplay');
        if (cd) cd.textContent = '经度: ' + e.latlng.lng.toFixed(6) + '  纬度: ' + e.latlng.lat.toFixed(6);
    },

    onContextMenu: function(e) {
        // 绘制/编辑模式下，右键留给绘制确认使用，不弹出菜单
        if (typeof Editor !== 'undefined' && Editor.editMode) return;

        var menu = document.getElementById('contextMenu');
        if (!menu) return;
        menu.style.display = 'block';
        menu.style.left = e.originalEvent.clientX + 'px';
        menu.style.top = e.originalEvent.clientY + 'px';
        this._contextLatLng = e.latlng;

        // 检测右键点击了哪个要素
        this.selectedFeature = null;
        var self = this;
        var closestDist = Infinity;
        var closestLayer = null;
        var clickLatLng = e.latlng;

        // 遍历各图层找最近要素
        ['points','routes','boundaries','faults','areas'].forEach(function(layerName) {
            var layer = self.layers[layerName];
            if (!layer) return;
            layer.eachLayer(function(feature) {
                var dist;
                if (feature.getLatLng) {
                    // CircleMarker / Marker
                    dist = clickLatLng.distanceTo(feature.getLatLng());
                } else if (feature.getLatLngs) {
                    // Polyline / Polygon — 找最近顶点
                    var latlngs = feature.getLatLngs();
                    if (Array.isArray(latlngs[0])) latlngs = latlngs[0]; // flatten polygon rings
                    for (var i = 0; i < latlngs.length; i++) {
                        var d = clickLatLng.distanceTo(latlngs[i]);
                        if (d < (closestDist || Infinity)) { closestDist = d; closestLayer = feature; }
                    }
                    return;
                }
                if (dist !== undefined && dist < closestDist) {
                    closestDist = dist;
                    closestLayer = feature;
                }
            });
        });

        // 距离 < 50 米（约 3-5 像素）≈ 在可点击范围内
        if (closestLayer && closestDist < 50) {
            this.selectedFeature = closestLayer;
        }
    },

    updateMapInfo: function() {
        var z = this.map.getZoom();
        var zoomEl = document.getElementById('zoomDisplay');
        if (zoomEl) zoomEl.textContent = '级别: ' + z;

        // 比例尺: 标准 OGC 0.28mm/pixel
        // 地面分辨率 = 赤道周长 * cos(纬度) / (256 * 2^z)
        // 赤道周长 WGS84 = 40075016.686 米
        // 比例尺分母 = 分辨率 / 0.00028 (每像素0.28mm = 0.00028m)
        var center = this.map.getCenter();
        var resolution = 40075016.686 * Math.cos(center.lat * Math.PI / 180) / (256 * Math.pow(2, z));
        var scaleDenom = Math.round(resolution / 0.00028);
        var scaleEl = document.getElementById('scaleDisplay');
        if (scaleEl) {
            if (scaleDenom >= 1000000) {
                scaleEl.textContent = '比例尺: 1:' + (scaleDenom / 1000000).toFixed(1) + 'M';
            } else if (scaleDenom >= 1000) {
                scaleEl.textContent = '比例尺: 1:' + (scaleDenom / 1000).toFixed(0) + ',' + ('000' + (scaleDenom % 1000)).slice(-3);
            } else {
                scaleEl.textContent = '比例尺: 1:' + scaleDenom;
            }
        }
    },

    // === 测量 ===
    _measureHandler: null,
    _measureDblClickHandler: null,
    _measureBearingClick1: null,
    _measureBearingClick2: null,
    _measureClearTimer: null,
    _lastClickTime: 0,

    startMeasure: function(type) {
        if (this.measureActive) this.stopMeasure();
        // 清除之前的定时器
        if (this._measureClearTimer) { clearTimeout(this._measureClearTimer); this._measureClearTimer = null; }
        this.measureActive = true;
        this._measureType = type;
        this.measureLayer.clearLayers();
        this._lastClickTime = 0;
        var pts = [], self = this;
        var h = function(e) {
            var now = Date.now();
            // 防止双击时第二个 click 多加一个点（双击间隔通常 < 350ms）
            if (now - self._lastClickTime < 350) return;
            self._lastClickTime = now;

            pts.push(e.latlng);
            L.circleMarker(e.latlng, { radius: 3, color: '#ff6600' }).addTo(self.measureLayer);
            if (type === 'distance' && pts.length >= 2) {
                var d = 0; for (var i = 1; i < pts.length; i++) d += pts[i-1].distanceTo(pts[i]);
                var el = document.getElementById('measureResult'); if (el) { el.style.display = 'block'; el.textContent = '📐 测距: ' + d.toFixed(1) + 'm（双击结束）'; }
            }
            if (type === 'area' && pts.length >= 3) {
                var a = 0; for (var i = 0; i < pts.length; i++) { var j = (i+1)%pts.length; a += pts[i].lng * pts[j].lat - pts[j].lng * pts[i].lat; }
                a = Math.abs(a) * 111000 * 111000 * Math.cos(pts[0].lat * Math.PI / 180) / 2;
                var el = document.getElementById('measureResult'); if (el) { el.style.display = 'block'; el.textContent = '📏 测面: ' + (a > 1000000 ? (a/1000000).toFixed(1) + 'km²' : a.toFixed(1) + 'm²') + '（双击结束）'; }
            }
            if (pts.length >= 2) L.polyline(pts.map(function(p) { return [p.lat, p.lng]; }), { color: '#ff6600', weight: 2, dashArray: '5,5' }).addTo(self.measureLayer);
        };
        var dblClickHandler = function() {
            self.stopMeasure();
        };
        this.map.on('click', h);
        this._measureHandler = h;
        this.map.on('dblclick', dblClickHandler);
        this._measureDblClickHandler = dblClickHandler;
        App.notify(type === 'distance' ? '📐 单击加点测距，双击结束' : '📏 单击加点测面，双击结束', 'info');
    },

    stopMeasure: function() {
        if (this._measureHandler) { this.map.off('click', this._measureHandler); this._measureHandler = null; }
        if (this._measureDblClickHandler) { this.map.off('dblclick', this._measureDblClickHandler); this._measureDblClickHandler = null; }
        // 清理方位角测量监听器
        if (this._measureBearingClick1) { this.map.off('click', this._measureBearingClick1); this._measureBearingClick1 = null; }
        if (this._measureBearingClick2) { this.map.off('click', this._measureBearingClick2); this._measureBearingClick2 = null; }
        if (this._measureBearingMouseMove) { this.map.off('mousemove', this._measureBearingMouseMove); this._measureBearingMouseMove = null; }
        this.measureActive = false;
        this._measureType = null;
        // 清除之前的定时器避免堆积
        if (this._measureClearTimer) { clearTimeout(this._measureClearTimer); }
        var self = this;
        // 双击结束后保留结果 1.5 秒然后自动清除
        this._measureClearTimer = setTimeout(function() {
            var el = document.getElementById('measureResult');
            if (el) el.style.display = 'none';
            self.measureLayer.clearLayers();
            self._measureClearTimer = null;
        }, 1500);
    },

    // 清除测量结果（立即，不留残余）
    clearMeasure: function() {
        if (this._measureClearTimer) { clearTimeout(this._measureClearTimer); this._measureClearTimer = null; }
        this.stopMeasure();
        // stopMeasure 里的 setTimeout 也清除
        if (this._measureClearTimer) { clearTimeout(this._measureClearTimer); this._measureClearTimer = null; }
        this.measureLayer.clearLayers();
        var el = document.getElementById('measureResult');
        if (el) el.style.display = 'none';
    },

    // === GPS ===
    gpsMarker: null, gpsCircle: null, gpsWatchId: null, currentGpsPos: null,

    startGpsTracking: function() {
        if (!navigator.geolocation) { App.notify('浏览器不支持GPS定位', 'error'); return; }
        if (this.gpsWatchId) { this.stopGpsTracking(); return; }
        var btn = document.getElementById('btnGpsLocate'), self = this;
        if (btn) btn.classList.add('active');
        this.gpsWatchId = navigator.geolocation.watchPosition(
            function(pos) {
                self.currentGpsPos = { lat: pos.coords.latitude, lng: pos.coords.longitude, elevation: pos.coords.altitude, accuracy: pos.coords.accuracy };
                self._updateGpsMarker();
                if (!self._gpsFirstFix) { self._gpsFirstFix = true; self.map.setView([pos.coords.latitude, pos.coords.longitude], 15); }
                var cd = document.getElementById('coordDisplay'); if (cd) cd.textContent = '经度: ' + pos.coords.longitude.toFixed(6) + '  纬度: ' + pos.coords.latitude.toFixed(6) + '  精度:' + (pos.coords.accuracy?pos.coords.accuracy.toFixed(1):'?') + 'm';
                var ed = document.getElementById('elevDisplay');
                if (ed && pos.coords.altitude != null) ed.textContent = '高程: ' + pos.coords.altitude.toFixed(1) + ' m (GPS)';
                else if (ed && pos.coords.altitude == null) ed.textContent = '高程: -- m (无GPS数据)';
                if (btn) { btn.textContent = '已定位'; btn.style.color = '#38a169'; }
            },
            function(err) { App.notify('定位失败', 'error'); if (btn) btn.classList.remove('active'); },
            { enableHighAccuracy: true, timeout: 15000, maximumAge: 5000 }
        );
    },

    stopGpsTracking: function() {
        if (this.gpsWatchId) { navigator.geolocation.clearWatch(this.gpsWatchId); this.gpsWatchId = null; }
        this._gpsFirstFix = false;
        if (this.gpsMarker) { this.map.removeLayer(this.gpsMarker); this.gpsMarker = null; }
        if (this.gpsCircle) { this.map.removeLayer(this.gpsCircle); this.gpsCircle = null; }
        var btn = document.getElementById('btnGpsLocate'); if (btn) { btn.classList.remove('active'); btn.textContent = '我的位置'; btn.style.color = ''; }
    },

    _updateGpsMarker: function() {
        if (!this.currentGpsPos) return;
        var p = this.currentGpsPos;
        if (this.gpsMarker) this.map.removeLayer(this.gpsMarker);
        this.gpsMarker = L.circleMarker([p.lat, p.lng], { radius: 8, fillColor: '#00d2ff', color: '#fff', weight: 3, fillOpacity: 1, zIndexOffset: 9999 }).addTo(this.map);
        if (this.gpsCircle) this.map.removeLayer(this.gpsCircle);
        if (p.accuracy) this.gpsCircle = L.circle([p.lat, p.lng], { radius: p.accuracy, color: '#00d2ff', fillOpacity: 0.1, weight: 1 }).addTo(this.map);
    },

    addPointAtMyLocation: function() {
        if (!this.currentGpsPos) { App.notify('请先点击"我的位置"', 'info'); return; }
        var p = this.currentGpsPos;
        Editor.showPointForm(p.lat, p.lng, null, { elevation: p.elevation, accuracy: p.accuracy });
    },
};
