"""
地质填图 — QGIS 停靠面板
提供图层管理、数据表格、属性编辑界面
"""

import os
from qgis.PyQt.QtWidgets import (QDockWidget, QWidget, QVBoxLayout, QHBoxLayout,
    QPushButton, QTreeWidget, QTreeWidgetItem, QLabel, QComboBox, QLineEdit,
    QTextEdit, QTableWidget, QTableWidgetItem, QHeaderView, QTabWidget,
    QGroupBox, QFormLayout, QMessageBox, QFileDialog)
from qgis.PyQt.QtCore import Qt, pyqtSignal
from qgis.core import QgsProject, QgsVectorLayer, QgsFeature, QgsGeometry
from qgis.utils import iface
import json


class GeoMappingDockWidget(QDockWidget):
    """地质填图停靠面板"""
    closed = pyqtSignal()

    def __init__(self, iface, plugin, parent=None):
        super().__init__("地质填图工具", parent)
        self.iface = iface
        self.plugin = plugin
        self.setObjectName("GeoMappingDock")
        self.setAllowedAreas(Qt.LeftDockWidgetArea | Qt.RightDockWidgetArea)
        self.setMinimumWidth(320)

        # 主容器
        main_widget = QWidget()
        layout = QVBoxLayout(main_widget)
        layout.setContentsMargins(8, 8, 8, 8)

        # === 标签页 ===
        tabs = QTabWidget()

        # Tab 1: 图层
        layer_tab = QWidget()
        layer_layout = QVBoxLayout(layer_tab)

        self.layer_tree = QTreeWidget()
        self.layer_tree.setHeaderLabels(["图层", "要素数"])
        self.layer_tree.itemClicked.connect(self.on_layer_clicked)
        layer_layout.addWidget(self.layer_tree)

        btn_refresh = QPushButton("🔄 刷新图层列表")
        btn_refresh.clicked.connect(self.refresh_layers)
        layer_layout.addWidget(btn_refresh)

        tabs.addTab(layer_tab, "📑 图层")

        # Tab 2: 属性
        attr_tab = QWidget()
        attr_layout = QVBoxLayout(attr_tab)

        form_group = QGroupBox("地质点属性")
        self.attr_form = QFormLayout()
        self.point_type_combo = QComboBox()
        self.point_type_combo.addItems([
            "地质观察点", "构造测量点", "样品点", "照片点",
            "地貌点", "水文点", "工程地质点"])
        self.attr_form.addRow("点类型:", self.point_type_combo)

        self.rock_type_combo = QComboBox()
        self.rock_type_combo.addItems(["", "沉积岩", "岩浆岩", "变质岩", "火山岩"])
        self.attr_form.addRow("岩石类型:", self.rock_type_combo)

        self.stratum_edit = QLineEdit()
        self.stratum_edit.setPlaceholderText("如: J-侏罗系")
        self.attr_form.addRow("地层时代:", self.stratum_edit)

        self.desc_edit = QTextEdit()
        self.desc_edit.setMaximumHeight(80)
        self.desc_edit.setPlaceholderText("地质描述...")
        self.attr_form.addRow("描述:", self.desc_edit)

        form_group.setLayout(self.attr_form)
        attr_layout.addWidget(form_group)

        btn_save = QPushButton("💾 保存当前要素")
        btn_save.clicked.connect(self.save_current_feature)
        attr_layout.addWidget(btn_save)

        attr_layout.addStretch()
        tabs.addTab(attr_tab, "✏️ 属性")

        # Tab 3: 工具
        tools_tab = QWidget()
        tools_layout = QVBoxLayout(tools_tab)

        btn_import = QPushButton("📥 导入野外数据 (GeoJSON/CSV)")
        btn_import.clicked.connect(self.plugin.import_field_data)
        tools_layout.addWidget(btn_import)

        btn_qfield = QPushButton("📱 导出 QField 项目")
        btn_qfield.clicked.connect(self.plugin.export_qfield_project)
        tools_layout.addWidget(btn_qfield)

        btn_symbol = QPushButton("🗿 添加地质符号标注")
        tools_layout.addWidget(btn_symbol)

        btn_pattern = QPushButton("🎨 岩性花纹填充")
        btn_pattern.clicked.connect(self.plugin.apply_lithology_pattern)
        tools_layout.addWidget(btn_pattern)

        btn_topo = QPushButton("🔍 拓扑检查")
        btn_topo.clicked.connect(self.plugin.run_topology_check)
        tools_layout.addWidget(btn_topo)

        btn_sync = QPushButton("🔄 同步服务器数据")
        btn_sync.clicked.connect(self.sync_from_server)
        tools_layout.addWidget(btn_sync)

        tools_layout.addStretch()
        tabs.addTab(tools_tab, "🔧 工具")

        layout.addWidget(tabs)

        # 服务器地址
        server_layout = QHBoxLayout()
        server_layout.addWidget(QLabel("API:"))
        self.server_edit = QLineEdit("http://localhost:5050")
        server_layout.addWidget(self.server_edit)
        layout.addLayout(server_layout)

        self.setWidget(main_widget)

    def refresh_layers(self):
        """刷新图层列表"""
        self.layer_tree.clear()
        for layer in QgsProject.instance().mapLayers().values():
            item = QTreeWidgetItem(self.layer_tree)
            item.setText(0, layer.name())
            item.setText(1, str(layer.featureCount()))
            item.setData(0, Qt.UserRole, layer.id())

    def on_layer_clicked(self, item, column):
        """图层点击处理"""
        layer_id = item.data(0, Qt.UserRole)
        layer = QgsProject.instance().mapLayer(layer_id)
        if layer:
            self.iface.setActiveLayer(layer)

    def save_current_feature(self):
        """保存当前选中要素的属性"""
        layer = self.iface.activeLayer()
        if not layer:
            QMessageBox.information(None, "提示", "请先选择一个图层")
            return

        features = layer.selectedFeatures()
        if not features:
            QMessageBox.information(None, "提示", "请先在地图上选中一个要素")
            return

        feature = features[0]
        layer.startEditing()
        feature["point_type"] = self.point_type_combo.currentText()
        feature["rock_type"] = self.rock_type_combo.currentText()
        feature["stratum"] = self.stratum_edit.text()
        feature["description"] = self.desc_edit.toPlainText()
        layer.updateFeature(feature)
        layer.commitChanges()
        self.iface.messageBar().pushSuccess("成功", "属性已保存")

    def sync_from_server(self):
        """从 Flask API 同步数据"""
        import urllib.request
        server = self.server_edit.text().rstrip('/')

        try:
            # 获取项目概览
            resp = urllib.request.urlopen(f"{server}/api/projects/")
            projects = json.loads(resp.read())
            if not projects:
                QMessageBox.information(None, "无数据", "服务器上没有项目数据")
                return

            # 选择第一个项目
            pid = projects[0]['id']
            resp = urllib.request.urlopen(f"{server}/api/projects/{pid}/overview")
            data = json.loads(resp.read())

            # 创建/更新图层
            for point in data.get('points', []):
                layer = self.plugin.get_or_create_layer('geo_points', '服务器地质点', 'Point',
                    fields=[("point_num", 10), ("point_type", 10), ("rock_type", 10)])
                feature = QgsFeature(layer.fields())
                feature.setGeometry(QgsGeometry.fromPointXY(
                    QgsPointXY(point['longitude'], point['latitude'])))
                feature['point_num'] = point['point_number']
                feature['point_type'] = point['point_type']
                feature['rock_type'] = point.get('rock_type', '')
                layer.dataProvider().addFeatures([feature])

            layer.triggerRepaint()
            self.iface.mapCanvas().refresh()
            self.iface.messageBar().pushSuccess("同步完成",
                f"从服务器加载了 {len(data.get('points', []))} 个地质点")
        except Exception as e:
            QMessageBox.warning(None, "同步失败",
                f"无法连接到服务器 ({server})\n\n请确保后端已启动\n\n错误: {e}")
