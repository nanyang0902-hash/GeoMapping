"""
PyQGIS 空间处理服务
使用 QGIS Python 库执行高级空间分析和坐标转换

使用前需要:
  1. 安装 QGIS (已检测到 D:/Program Files/QGIS 3.44.11)
  2. 设置环境变量 (本模块自动配置)

如果 QGIS 未安装，此模块自动降级为 Shapely + pyproj 实现
"""

import os
import sys

# QGIS 3.44.11 安装路径 (本机)
_QGIS_ROOT = r"D:\Program Files\QGIS 3.44.11"
_QGIS_PYTHON_HOME = _QGIS_ROOT + r"\apps\Python312"
_QGIS_PREFIX = _QGIS_ROOT + r"\apps\qgis-ltr"
_QGIS_PYTHON_PATH = _QGIS_PREFIX + r"\python"
_QGIS_PLUGINS_PATH = _QGIS_PREFIX + r"\python\plugins"
_QGIS_SITE_PACKAGES = _QGIS_PYTHON_HOME + r"\Lib\site-packages"
_QGIS_QT5_BIN = _QGIS_ROOT + r"\apps\Qt5\bin"

# 尝试加载 PyQGIS
PYQGIS_AVAILABLE = False
try:
    # 设置必要的环境变量
    os.environ.setdefault("PYTHONHOME", _QGIS_PYTHON_HOME)
    os.environ.setdefault("QGIS_PREFIX", _QGIS_PREFIX)

    # 设置 PATH (DLL 查找)
    for p in [_QGIS_ROOT + r"\bin", _QGIS_PREFIX + r"\bin",
              _QGIS_QT5_BIN, _QGIS_PYTHON_HOME]:
        if p not in os.environ.get("PATH", ""):
            os.environ["PATH"] = p + ";" + os.environ.get("PATH", "")

    # 设置 Python 搜索路径
    for p in [_QGIS_PYTHON_PATH, _QGIS_PLUGINS_PATH,
              _QGIS_SITE_PACKAGES, _QGIS_QT5_BIN + r"\..\lib"]:
        if os.path.exists(p) and p not in sys.path:
            sys.path.insert(0, p)

    from qgis.core import (
        QgsApplication, QgsCoordinateReferenceSystem,
        QgsCoordinateTransform, QgsProject, QgsVectorLayer,
        QgsGeometry, QgsFeature, QgsPointXY,
        QgsVectorFileWriter, QgsWkbTypes
    )
    # 初始化 QGIS (headless模式)
    QgsApplication.setPrefixPath(_QGIS_PREFIX, True)
    PYQGIS_AVAILABLE = True
    print(f"[PyQGIS] QGIS 库加载成功 ({_QGIS_ROOT})")
except ImportError:
    print("[PyQGIS] QGIS 未安装，使用 Shapely 降级模式")
    try:
        from shapely import wkt as shapely_wkt
        from shapely.geometry import Point, LineString, Polygon, mapping
        from shapely.ops import transform
        SHAPELY_AVAILABLE = True
    except ImportError:
        SHAPELY_AVAILABLE = False


class SpatialService:
    """空间分析服务（PyQGIS 或 Shapely 后端）"""

    def __init__(self):
        self.qgis_available = PYQGIS_AVAILABLE

    # ===== 坐标转换 =====
    def transform_coordinates(self, x, y, src_crs="EPSG:4326", dst_crs="EPSG:4547"):
        """坐标转换"""
        if self.qgis_available:
            src = QgsCoordinateReferenceSystem(src_crs)
            dst = QgsCoordinateReferenceSystem(dst_crs)
            transform = QgsCoordinateTransform(src, dst, QgsProject.instance())
            pt = transform.transform(QgsPointXY(x, y))
            return {"x": pt.x(), "y": pt.y()}
        elif SHAPELY_AVAILABLE:
            # 使用 pyproj 作为后备
            try:
                from pyproj import Transformer
                t = Transformer.from_crs(src_crs, dst_crs, always_xy=True)
                nx, ny = t.transform(x, y)
                return {"x": nx, "y": ny}
            except ImportError:
                pass
        raise RuntimeError("坐标转换需要安装 QGIS 或 pyproj")

    # ===== 几何运算 =====
    def calculate_area(self, wkt_geom):
        """计算面积（返回平方米）"""
        if self.qgis_available:
            geom = QgsGeometry.fromWkt(wkt_geom)
            # 假设以度为单位，近似转换
            return geom.area() * 12321000000  # 1平方度 ≈ 12321 km²
        elif SHAPELY_AVAILABLE:
            geom = shapely_wkt.loads(wkt_geom)
            return geom.area * 12321000000
        raise RuntimeError("需要 Shapely 或 QGIS")

    def calculate_length(self, wkt_geom):
        """计算长度（返回米）"""
        if self.qgis_available:
            geom = QgsGeometry.fromWkt(wkt_geom)
            return geom.length() * 111000  # 经度1度 ≈ 111km
        elif SHAPELY_AVAILABLE:
            geom = shapely_wkt.loads(wkt_geom)
            return geom.length * 111000
        raise RuntimeError("需要 Shapely 或 QGIS")

    def buffer(self, wkt_geom, distance_meters):
        """创建缓冲区"""
        distance_deg = distance_meters / 111000.0
        if self.qgis_available:
            geom = QgsGeometry.fromWkt(wkt_geom)
            buf = geom.buffer(distance_deg, 8)
            return buf.asWkt()
        elif SHAPELY_AVAILABLE:
            geom = shapely_wkt.loads(wkt_geom)
            buf = geom.buffer(distance_deg)
            return buf.wkt
        raise RuntimeError("需要 Shapely 或 QGIS")

    def intersection(self, wkt1, wkt2):
        """计算两个几何的交集"""
        if self.qgis_available:
            g1 = QgsGeometry.fromWkt(wkt1)
            g2 = QgsGeometry.fromWkt(wkt2)
            result = g1.intersection(g2)
            return result.asWkt()
        elif SHAPELY_AVAILABLE:
            g1 = shapely_wkt.loads(wkt1)
            g2 = shapely_wkt.loads(wkt2)
            return g1.intersection(g2).wkt
        raise RuntimeError("需要 Shapely 或 QGIS")

    # ===== GeoPackage 生成 =====
    def export_to_geopackage(self, features, gpkg_path, layer_name="geological_data"):
        """将要素数组导出为 GeoPackage 文件"""
        if not self.qgis_available:
            raise RuntimeError("GeoPackage 导出需要 QGIS")

        # 创建内存图层
        layer = QgsVectorLayer("Point?crs=EPSG:4326", layer_name, "memory")
        provider = layer.dataProvider()

        # 添加字段
        if features and features[0].get("properties"):
            from qgis.PyQt.QtCore import QVariant
            for key, value in features[0]["properties"].items():
                ftype = QVariant.Double if isinstance(value, (int, float)) else QVariant.String
                provider.addAttributes([QgsField(key, ftype)])
            layer.updateFields()

        # 添加要素
        for feat_data in features:
            feature = QgsFeature(layer.fields())
            coords = feat_data.get("geometry", {}).get("coordinates", [0, 0])
            feature.setGeometry(QgsGeometry.fromPointXY(
                QgsPointXY(coords[0], coords[1])))
            if "properties" in feat_data:
                for key, value in feat_data["properties"].items():
                    feature[key] = value
            provider.addFeatures([feature])

        # 写入 GeoPackage
        options = QgsVectorFileWriter.SaveVectorOptions()
        options.driverName = "GPKG"
        options.layerName = layer_name
        error = QgsVectorFileWriter.writeAsVectorFormatV3(
            layer, gpkg_path, QgsProject.instance().transformContext(), options)

        if error[0] == QgsVectorFileWriter.NoError:
            return {"path": gpkg_path, "layer": layer_name}
        else:
            raise RuntimeError(f"GeoPackage 导出失败: {error}")

    # ===== QGIS 项目文件生成 =====
    def generate_qgs_project(self, project_name, layers_data, output_path):
        """生成 QGIS 项目文件 (.qgs)"""
        if not self.qgis_available:
            # 降级：生成简化版 QGS (XML)
            return self._generate_qgs_xml(project_name, layers_data, output_path)

        project = QgsProject.instance()
        project.setCrs(QgsCoordinateReferenceSystem("EPSG:4326"))
        project.setTitle(project_name)

        # 添加图层
        for layer_info in layers_data:
            source = layer_info.get("source", "")
            name = layer_info.get("name", "layer")
            if source:
                layer = QgsVectorLayer(source, name, "ogr")
                if layer.isValid():
                    project.addMapLayer(layer)

        # 保存项目
        project.write(output_path)
        return {"path": output_path}

    def _generate_qgs_xml(self, project_name, layers_data, output_path):
        """生成 QGIS 项目 XML（不依赖 PyQGIS）"""
        xml = f'''<!DOCTYPE qgis PUBLIC 'http://mrcc.com/qgis.dtd' 'SYSTEM'>
<qgis projectname="{project_name}" version="3.34.0">
  <mapcanvas>
    <destinationsrs>
      <spatialrefsys>
        <authid>EPSG:4326</authid>
      </spatialrefsys>
    </destinationsrs>
  </mapcanvas>
  <projectlayers>
'''
        for layer in layers_data:
            xml += f'''    <maplayer type="vector" name="{layer['name']}">
      <datasource>{layer.get('source', '')}</datasource>
      <provider>{layer.get('provider', 'ogr')}</provider>
    </maplayer>
'''
        xml += '''  </projectlayers>
</qgis>'''

        with open(output_path, 'w', encoding='utf-8') as f:
            f.write(xml)
        return {"path": output_path, "note": "简化版 QGS，建议安装 QGIS 获取完整功能"}


# ===== 实例化服务 =====
spatial_service = SpatialService()
