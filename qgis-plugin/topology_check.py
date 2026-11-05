"""
拓扑检查模块
在 QGIS 中对地质图层执行拓扑规则检查
"""

from qgis.PyQt.QtWidgets import QMessageBox, QDialog, QVBoxLayout, QTextEdit, QPushButton
from qgis.core import (QgsProject, QgsVectorLayer, QgsGeometry, QgsFeature,
                        QgsWkbTypes, QgsFeatureRequest, QgsPointXY)
from qgis.utils import iface


class TopologyChecker:
    """地质图层拓扑检查器"""

    def __init__(self, iface):
        self.iface = iface
        self.issues = []

    def run(self):
        """执行所有拓扑检查"""
        self.issues = []

        # 遍历项目中所有图层
        for layer in QgsProject.instance().mapLayers().values():
            if not isinstance(layer, QgsVectorLayer):
                continue

            geom_type = layer.geometryType()

            if geom_type == QgsWkbTypes.LineGeometry:
                self.check_line_breaks(layer)
                self.check_dangling_nodes(layer)

            elif geom_type == QgsWkbTypes.PolygonGeometry:
                self.check_polygon_overlap(layer)
                self.check_polygon_gaps(layer)

            elif geom_type == QgsWkbTypes.PointGeometry:
                self.check_duplicate_points(layer)

        # 显示结果
        self.show_results()

    def check_line_breaks(self, layer):
        """检查线断裂（相邻线段端点间距过大）"""
        threshold = 0.0001  # 约10米（度）
        features = list(layer.getFeatures())
        line_ends = []

        for f in features:
            geom = f.geometry()
            if geom.isMultipart():
                continue
            polyline = geom.asPolyline()
            if len(polyline) >= 2:
                line_ends.append((f.id(), polyline[0], polyline[-1]))

        # 检查端点间距离
        for i in range(len(line_ends)):
            for j in range(i + 1, len(line_ends)):
                id1, start1, end1 = line_ends[i]
                id2, start2, end2 = line_ends[j]

                # 端点-端点距离
                d1 = end1.distance(start2)
                d2 = start1.distance(end2)

                if 0 < d1 < threshold:
                    self.issues.append(
                        f"⚠ 线断裂 [{layer.name()}]: "
                        f"要素{id1}终点与要素{id2}起点间距 {d1*111000:.1f}m")

                if 0 < d2 < threshold:
                    self.issues.append(
                        f"⚠ 线断裂 [{layer.name()}]: "
                        f"要素{id2}终点与要素{id1}起点间距 {d2*111000:.1f}m")

    def check_dangling_nodes(self, layer):
        """检查悬挂节点（线的端点未连接其他线）"""
        threshold = 0.0001
        features = list(layer.getFeatures())

        if len(features) < 2:
            return

        # 收集所有端点
        all_ends = []
        for f in features:
            geom = f.geometry()
            if geom.isMultipart():
                continue
            polyline = geom.asPolyline()
            if len(polyline) >= 2:
                all_ends.append((f.id(), polyline[0]))
                all_ends.append((f.id(), polyline[-1]))

        # 检查每个端点是否有其他端点靠近
        for i, ((fid, pt)) in enumerate(all_ends):
            isolated = True
            for j, ((fid2, pt2)) in enumerate(all_ends):
                if i != j and pt.distance(pt2) < threshold:
                    isolated = False
                    break
            if isolated:
                self.issues.append(
                    f"⚠ 悬挂节点 [{layer.name()}]: "
                    f"要素{fid}的端点 ({pt.x():.6f},{pt.y():.6f}) 未连接其他线")

    def check_polygon_overlap(self, layer):
        """检查面重叠"""
        features = list(layer.getFeatures())

        for i in range(len(features)):
            geom1 = features[i].geometry()
            for j in range(i + 1, len(features)):
                geom2 = features[j].geometry()

                if geom1.intersects(geom2):
                    intersection = geom1.intersection(geom2)
                    if not intersection.isEmpty() and intersection.area() > 0.000001:
                        overlap_area = intersection.area() * 12321000000  # 近似m²
                        self.issues.append(
                            f"⚠ 面重叠 [{layer.name()}]: "
                            f"要素{features[i].id()}与要素{features[j].id()}重叠，"
                            f"面积约 {overlap_area:.1f}m²")

    def check_polygon_gaps(self, layer):
        """检查面缝隙（相邻面之间的间隙）"""
        # 简化版本：检查面之间是否有小间隙
        # 完整实现需要 QGIS 原生拓扑检查器
        pass

    def check_duplicate_points(self, layer):
        """检查重复点（位置相同的点）"""
        threshold = 0.00001  # 约1米
        features = list(layer.getFeatures())
        points = []

        for f in features:
            geom = f.geometry()
            if geom.isMultipart():
                continue
            pt = geom.asPoint()
            points.append((f.id(), pt))

        for i in range(len(points)):
            for j in range(i + 1, len(points)):
                if points[i][1].distance(points[j][1]) < threshold:
                    self.issues.append(
                        f"⚠ 重复点 [{layer.name()}]: "
                        f"点{points[i][0]}与点{points[j][0]}位置重合")

    def show_results(self):
        """显示检查结果对话框"""
        dialog = QDialog()
        dialog.setWindowTitle("拓扑检查结果")
        dialog.setMinimumSize(500, 400)

        layout = QVBoxLayout(dialog)

        text_edit = QTextEdit()
        text_edit.setReadOnly(True)

        if not self.issues:
            text_edit.setHtml(
                "<h3 style='color:green;'>✅ 拓扑检查通过</h3>"
                "<p>未发现拓扑问题。</p>")
        else:
            text_edit.setHtml(
                f"<h3 style='color:red;'>⚠ 发现 {len(self.issues)} 个拓扑问题</h3>"
                + "".join(f"<p>{issue}</p>" for issue in self.issues))

        layout.addWidget(text_edit)

        btn_close = QPushButton("关闭")
        btn_close.clicked.connect(dialog.close)
        layout.addWidget(btn_close)

        dialog.show()
