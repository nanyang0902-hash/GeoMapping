"""
地质填图工具 — QGIS 插件主模块
GeoMapping Plugin for QGIS
"""

import os
import json
from qgis.PyQt.QtWidgets import (QAction, QToolBar, QMenu, QMessageBox,
                                   QFileDialog, QDialog, QVBoxLayout, QLabel)
from qgis.PyQt.QtGui import QIcon
from qgis.PyQt.QtCore import Qt, QSettings
from qgis.core import (QgsProject, QgsVectorLayer, QgsField, QgsFeature,
                        QgsGeometry, QgsPointXY, QgsVectorFileWriter,
                        QgsCoordinateReferenceSystem, QgsWkbTypes, QgsFillSymbol,
                        QgsLineSymbol, QgsMarkerSymbol, QgsRendererCategory,
                        QgsCategorizedSymbolRenderer)
from qgis.PyQt.QtCore import QVariant
from qgis.gui import QgsMapToolEmitPoint
from qgis.utils import iface

from .geo_mapping_dockwidget import GeoMappingDockWidget


class GeoMappingPlugin:
    """地质填图 QGIS 插件"""

    def __init__(self, iface):
        self.iface = iface
        self.plugin_dir = os.path.dirname(__file__)
        self.actions = []
        self.toolbar = None
        self.dock_widget = None
        self.map_tool = None
        self.current_layer = None

    def initGui(self):
        """初始化插件界面：工具栏按钮 + 停靠面板"""

        # === 工具栏 ===
        self.toolbar = self.iface.addToolBar("地质填图工具")
        self.toolbar.setObjectName("GeoMappingToolbar")

        # 1. 显示/隐藏面板
        icon = QIcon(os.path.join(self.plugin_dir, "icons", "panel.svg"))
        action = QAction(icon, "地质填图面板", self.iface.mainWindow())
        action.setCheckable(True)
        action.triggered.connect(self.toggle_panel)
        self.actions.append(action)
        self.toolbar.addAction(action)

        # 2. 添加地质点
        icon = QIcon(os.path.join(self.plugin_dir, "icons", "add_point.svg"))
        action = QAction(icon, "添加地质点", self.iface.mainWindow())
        action.triggered.connect(self.start_add_point)
        self.actions.append(action)
        self.toolbar.addAction(action)

        # 3. 导入野外数据
        icon = QIcon(os.path.join(self.plugin_dir, "icons", "import.svg"))
        action = QAction(icon, "导入野外数据", self.iface.mainWindow())
        action.triggered.connect(self.import_field_data)
        self.actions.append(action)
        self.toolbar.addAction(action)

        # 4. 导出 QField 项目
        icon = QIcon(os.path.join(self.plugin_dir, "icons", "qfield.svg"))
        action = QAction(icon, "导出QField项目", self.iface.mainWindow())
        action.triggered.connect(self.export_qfield_project)
        self.actions.append(action)
        self.toolbar.addAction(action)

        self.toolbar.addSeparator()

        # 5. 地质符号库子菜单
        menu = QMenu("地质符号库", self.iface.mainWindow())
        for sym_name, sym_code in self.get_symbols().items():
            sub_action = menu.addAction(sym_name)
            sub_action.triggered.connect(
                lambda checked, n=sym_name: self.add_symbol_to_map(n))
        menu_action = QAction("🗿 符号", self.iface.mainWindow())
        menu_action.setMenu(menu)
        self.toolbar.addAction(menu_action)
        self.actions.append(menu_action)

        # 6. 岩性花纹填充
        icon = QIcon(os.path.join(self.plugin_dir, "icons", "pattern.svg"))
        action = QAction(icon, "岩性花纹", self.iface.mainWindow())
        action.triggered.connect(self.apply_lithology_pattern)
        self.actions.append(action)
        self.toolbar.addAction(action)

        # 7. 拓扑检查
        icon = QIcon(os.path.join(self.plugin_dir, "icons", "topology.svg"))
        action = QAction(icon, "拓扑检查", self.iface.mainWindow())
        action.triggered.connect(self.run_topology_check)
        self.actions.append(action)
        self.toolbar.addAction(action)

        # === 停靠面板 ===
        self.dock_widget = GeoMappingDockWidget(self.iface, self)
        self.iface.addDockWidget(Qt.RightDockWidgetArea, self.dock_widget)
        self.dock_widget.hide()

        # 注册到插件菜单
        self.iface.addPluginToMenu("&地质填图", self.actions[0])

    def unload(self):
        """卸载插件"""
        for action in self.actions:
            self.iface.removePluginMenu("&地质填图", action)
            self.iface.removeToolBarIcon(action)
        if self.toolbar:
            del self.toolbar
        if self.dock_widget:
            self.iface.removeDockWidget(self.dock_widget)
            self.dock_widget.deleteLater()

    def toggle_panel(self):
        """切换停靠面板显示/隐藏"""
        if self.dock_widget.isVisible():
            self.dock_widget.hide()
        else:
            self.dock_widget.show()

    # ===== 添加地质点 =====
    def start_add_point(self):
        """开始在地图上点击添加地质点"""
        self.map_tool = GeoPointMapTool(self.iface, self)
        self.iface.mapCanvas().setMapTool(self.map_tool)
        self.iface.messageBar().pushInfo("地质填图", "点击地图添加地质点，右键取消")

    def add_point_at(self, point: QgsPointXY):
        """在指定坐标添加地质点"""
        layer = self.get_or_create_layer(
            "geological_points", "地质点", "Point",
            fields=[
                ("point_num", QVariant.String),
                ("point_type", QVariant.String),
                ("elevation", QVariant.Double),
                ("rock_type", QVariant.String),
                ("stratum", QVariant.String),
                ("strike", QVariant.Int),
                ("dip", QVariant.Int),
                ("description", QVariant.String),
            ]
        )
        feature = QgsFeature(layer.fields())
        feature.setGeometry(QgsGeometry.fromPointXY(point))
        feature["point_num"] = f"D{point.x():.0f}{point.y():.0f}"
        feature["point_type"] = "地质观察点"
        layer.dataProvider().addFeatures([feature])
        layer.triggerRepaint()
        self.iface.mapCanvas().refresh()

    # ===== 导入野外数据 =====
    def import_field_data(self):
        """从 GeoJSON/CSV 导入野外采集数据"""
        filepath, _ = QFileDialog.getOpenFileName(
            self.iface.mainWindow(), "导入野外数据", "",
            "GeoJSON (*.geojson *.json);;CSV (*.csv);;All Files (*)")

        if not filepath:
            return

        try:
            if filepath.endswith('.csv'):
                layer = QgsVectorLayer(f"file:///{filepath}?delimiter=,", "野外数据", "delimitedtext")
            else:
                layer = QgsVectorLayer(filepath, "野外数据", "ogr")

            if layer.isValid():
                QgsProject.instance().addMapLayer(layer)
                # 按点类型分类渲染
                self.categorize_points(layer, "point_type")
                self.iface.messageBar().pushSuccess("导入成功", f"已加载 {layer.featureCount()} 条记录")
            else:
                QMessageBox.warning(None, "导入失败", "无法读取文件，请检查格式")
        except Exception as e:
            QMessageBox.critical(None, "错误", str(e))

    # ===== QField 项目导出 =====
    def export_qfield_project(self):
        """导出为 QField 兼容项目"""
        from .qfield_export import QFieldExporter
        exporter = QFieldExporter(self.iface)
        exporter.export()

    # ===== 符号库 =====
    def get_symbols(self):
        """返回地质符号字典"""
        return {
            "地层产状 (走向/倾向/倾角)": "bedding",
            "倒转产状": "overturned",
            "节理产状": "joint",
            "正断层": "normal_fault",
            "逆断层": "reverse_fault",
            "平移断层": "strike_slip",
            "向斜轴": "syncline",
            "背斜轴": "anticline",
            "矿点": "mineral",
            "化石点": "fossil",
        }

    def add_symbol_to_map(self, symbol_name):
        """在地图上添加地质符号标注"""
        layer = self.get_or_create_layer(
            "geo_symbols", "地质符号", "Point",
            fields=[("symbol", QVariant.String), ("label", QVariant.String)])
        self.map_tool = SymbolMapTool(self.iface, layer, symbol_name)
        self.iface.mapCanvas().setMapTool(self.map_tool)

    # ===== 岩性花纹 =====
    def apply_lithology_pattern(self):
        """对选中的面图层应用岩性花纹"""
        layer = self.iface.activeLayer()
        if not layer or layer.geometryType() != QgsWkbTypes.PolygonGeometry:
            QMessageBox.information(None, "提示", "请先选择一个面图层（地质层面）")
            return

        # 定义岩性SVG填充
        # 注: patterns 字典预留用于SVG岩性花纹，当前版本使用简单颜色分类
        patterns = {
            "砂岩": "sandstone.svg",
            "页岩": "shale.svg",
            "灰岩": "limestone.svg",
            "花岗岩": "granite.svg",
            "玄武岩": "basalt.svg",
            "片麻岩": "gneiss.svg",
        }

        # 简单分类渲染（根据 rock_type 字段）
        categories = []
        colors = {
            "砂岩": "#FFD700", "页岩": "#8B4513", "灰岩": "#87CEEB",
            "花岗岩": "#FF69B4", "玄武岩": "#2F4F4F", "片麻岩": "#DDA0DD",
        }
        for rock, color in colors.items():
            symbol = QgsFillSymbol.createSimple({
                'color': color, 'outline_color': 'black', 'outline_width': '0.5'})
            categories.append(QgsRendererCategory(rock, symbol, rock))

        renderer = QgsCategorizedSymbolRenderer("rock_type", categories)
        layer.setRenderer(renderer)
        layer.triggerRepaint()

    # ===== 拓扑检查 =====
    def run_topology_check(self):
        """对当前图层执行拓扑检查"""
        from .topology_check import TopologyChecker
        checker = TopologyChecker(self.iface)
        checker.run()

    # ===== 辅助方法 =====
    def get_or_create_layer(self, name, display_name, geom_type, fields=None):
        """获取或创建内存图层"""
        layers = QgsProject.instance().mapLayersByName(display_name)
        if layers:
            return layers[0]

        if geom_type == "Point":
            wkb_type = QgsWkbTypes.Point
        elif geom_type == "LineString":
            wkb_type = QgsWkbTypes.LineString
        elif geom_type == "Polygon":
            wkb_type = QgsWkbTypes.Polygon
        else:
            wkb_type = geom_type

        layer = QgsVectorLayer(f"{wkb_type}?crs=EPSG:4326", display_name, "memory")
        if fields:
            provider = layer.dataProvider()
            for name, qtype in fields:
                provider.addAttributes([QgsField(name, qtype)])
            layer.updateFields()

        QgsProject.instance().addMapLayer(layer)
        return layer

    def categorize_points(self, layer, field_name):
        """按字段分类渲染点图层"""
        colors = {
            "地质观察点": "#0066ff", "构造测量点": "#ff0000",
            "样品点": "#00aa00", "照片点": "#ff8800",
            "地貌点": "#8b4513", "水文点": "#00cccc",
            "工程地质点": "#a0522d",
        }
        categories = []
        for name, color in colors.items():
            symbol = QgsMarkerSymbol.createSimple({
                'color': color, 'size': '4', 'outline_color': 'white'})
            categories.append(QgsRendererCategory(name, symbol, name))

        renderer = QgsCategorizedSymbolRenderer(field_name, categories)
        layer.setRenderer(renderer)
        layer.triggerRepaint()
        self.iface.mapCanvas().refresh()


class GeoPointMapTool(QgsMapToolEmitPoint):
    """在地图上点击添加地质点"""

    def __init__(self, iface, plugin):
        super().__init__(iface.mapCanvas())
        self.iface = iface
        self.plugin = plugin

    def canvasReleaseEvent(self, event):
        point = self.toMapCoordinates(event.pos())
        self.plugin.add_point_at(point)

    def activate(self):
        self.iface.mapCanvas().setCursor(Qt.CrossCursor)


class SymbolMapTool(QgsMapToolEmitPoint):
    """在地图上点击添加地质符号"""

    def __init__(self, iface, layer, symbol_name):
        super().__init__(iface.mapCanvas())
        self.layer = layer
        self.symbol_name = symbol_name

    def canvasReleaseEvent(self, event):
        point = self.toMapCoordinates(event.pos())
        feature = QgsFeature(self.layer.fields())
        feature.setGeometry(QgsGeometry.fromPointXY(point))
        feature["symbol"] = self.symbol_name
        feature["label"] = self.symbol_name
        self.layer.dataProvider().addFeatures([feature])
        self.layer.triggerRepaint()
