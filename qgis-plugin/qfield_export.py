"""
QField 项目导出模块
将当前 QGIS 项目导出为 QField 兼容的野外采集项目
"""

import os
import json
from qgis.PyQt.QtWidgets import QFileDialog, QMessageBox, QInputDialog
from qgis.core import (QgsProject, QgsVectorLayer, QgsVectorFileWriter,
                        QgsCoordinateReferenceSystem, QgsMapLayer,
                        QgsWkbTypes)


class QFieldExporter:
    """QField 项目导出器"""

    def __init__(self, iface):
        self.iface = iface
        self.project = QgsProject.instance()

    def export(self):
        """执行导出流程"""
        # 1. 选择导出目录
        export_dir = QFileDialog.getExistingDirectory(
            None, "选择 QField 项目导出目录")
        if not export_dir:
            return

        # 2. 输入项目名称
        project_name, ok = QInputDialog.getText(
            None, "项目名称", "请输入 QField 项目名称:")
        if not ok or not project_name.strip():
            project_name = "geological_mapping"

        project_dir = os.path.join(export_dir, project_name)
        os.makedirs(project_dir, exist_ok=True)

        # 3. 导出图层为 GeoPackage (QField 最佳格式)
        gpkg_path = os.path.join(project_dir, f"{project_name}.gpkg")
        exported_layers = []

        for layer_id, layer in self.project.mapLayers().items():
            if not isinstance(layer, QgsVectorLayer):
                continue

            layer_name = layer.name().replace(" ", "_")

            # 导出到 GeoPackage
            options = QgsVectorFileWriter.SaveVectorOptions()
            options.driverName = "GPKG"
            options.layerName = layer_name
            options.actionOnExistingFile = QgsVectorFileWriter.CreateOrOverwriteLayer

            if os.path.exists(gpkg_path) and exported_layers:
                options.actionOnExistingFile = QgsVectorFileWriter.CreateOrOverwriteLayer

            error = QgsVectorFileWriter.writeAsVectorFormatV3(
                layer, gpkg_path, self.project.transformContext(), options)

            if error[0] == QgsVectorFileWriter.NoError:
                exported_layers.append({
                    "name": layer_name,
                    "source": f"./{project_name}.gpkg|layername={layer_name}",
                    "type": self._geom_type_name(layer.geometryType()),
                })

        # 4. 生成 QField 项目配置文件 (qgs 项目文件)
        qgs_path = os.path.join(project_dir, f"{project_name}.qgs")
        self.project.write(qgs_path)

        # 5. 生成 QField 云同步配置
        qfield_config = {
            "name": project_name,
            "description": "地质填图野外采集项目",
            "layers": exported_layers,
            "coordinate_system": self.project.crs().authid(),
            "base_map": "OpenStreetMap",
            "offline_base_map": True,
            "gps_settings": {
                "minimum_distance": 10,
                "accuracy_threshold": 15,
                "track_recording": True,
            },
            "photo_settings": {
                "resize_to": 1024,
                "embed_geotag": True,
            },
            "templates": self._generate_point_templates(),
        }

        config_path = os.path.join(project_dir, "qfield_config.json")
        with open(config_path, 'w', encoding='utf-8') as f:
            json.dump(qfield_config, f, ensure_ascii=False, indent=2)

        # 6. 生成使用说明
        readme_path = os.path.join(project_dir, "README.md")
        with open(readme_path, 'w', encoding='utf-8') as f:
            f.write(f"""# {project_name} - QField 野外采集项目

## 使用方法

1. 将整个 `{project_name}` 文件夹复制到手机/平板
2. 安装 QField 应用 (Google Play / App Store)
3. 在 QField 中 → 打开项目 → 选择 `{project_name}.qgs`
4. 开始野外采集

## 图层
""")
            for lyr in exported_layers:
                f.write(f"- {lyr['name']} ({lyr['type']})\n")

            f.write(f"""
## GPS 设置
- 最小记录距离: {qfield_config['gps_settings']['minimum_distance']}m
- 精度阈值: {qfield_config['gps_settings']['accuracy_threshold']}m
- 轨迹记录: 启用

## 地质点采集模板
""")
            for tmpl in qfield_config['templates']:
                f.write(f"- {tmpl['name']}\n")

        QMessageBox.information(None, "导出成功",
            f"QField 项目已导出到:\n{project_dir}\n\n"
            f"包含 {len(exported_layers)} 个图层\n\n"
            f"将该文件夹复制到手机后，用 QField 打开 .qgs 文件")

    def _geom_type_name(self, wkb_type):
        types = {
            QgsWkbTypes.PointGeometry: "点",
            QgsWkbTypes.LineGeometry: "线",
            QgsWkbTypes.PolygonGeometry: "面",
        }
        return types.get(wkb_type, "未知")

    def _generate_point_templates(self):
        """生成地质点采集模板"""
        return [
            {
                "name": "地质观察点",
                "fields": [
                    {"name": "point_number", "type": "text", "label": "点编号"},
                    {"name": "rock_type", "type": "list",
                     "options": ["沉积岩","岩浆岩","变质岩","火山岩"], "label": "岩石类型"},
                    {"name": "stratum", "type": "text", "label": "地层时代"},
                    {"name": "strike", "type": "integer", "label": "走向(°)"},
                    {"name": "dip", "type": "integer", "label": "倾角(°)"},
                    {"name": "description", "type": "textarea", "label": "地质描述"},
                    {"name": "photo", "type": "photo", "label": "现场照片"},
                ]
            },
            {
                "name": "构造测量点",
                "fields": [
                    {"name": "point_number", "type": "text", "label": "点编号"},
                    {"name": "structure_type", "type": "list",
                     "options": ["层理","节理","断层","褶皱","线理"], "label": "构造类型"},
                    {"name": "strike", "type": "integer", "label": "走向(°)"},
                    {"name": "dip_direction", "type": "integer", "label": "倾向(°)"},
                    {"name": "dip", "type": "integer", "label": "倾角(°)"},
                    {"name": "description", "type": "textarea", "label": "描述"},
                ]
            },
            {
                "name": "样品点",
                "fields": [
                    {"name": "point_number", "type": "text", "label": "点编号"},
                    {"name": "sample_type", "type": "list",
                     "options": ["岩石样","土样","水样","矿样","化石样"], "label": "样品类型"},
                    {"name": "sample_number", "type": "text", "label": "样品编号"},
                    {"name": "rock_type", "type": "list",
                     "options": ["沉积岩","岩浆岩","变质岩"], "label": "岩石类型"},
                    {"name": "description", "type": "textarea", "label": "描述"},
                ]
            },
            {
                "name": "照片点",
                "fields": [
                    {"name": "point_number", "type": "text", "label": "点编号"},
                    {"name": "photo_direction", "type": "integer", "label": "拍摄方向(°)"},
                    {"name": "photo_type", "type": "list",
                     "options": ["全景","近景","剖面","远景"], "label": "照片类型"},
                    {"name": "description", "type": "textarea", "label": "描述"},
                ]
            },
        ]
