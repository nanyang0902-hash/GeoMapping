"""
数据导出 API（Shapefile, GeoJSON, KML, CSV, DXF等格式）
"""

import os
import json
import csv
import io
from flask import Blueprint, request, jsonify, Response
from database import get_db

export_bp = Blueprint('export', __name__)

@export_bp.route('/geojson/<int:project_id>', methods=['GET'])
def export_geojson(project_id):
    """导出为GeoJSON格式"""
    feature_type = request.args.get('type', 'all')  # points, routes, boundaries, faults, areas, all

    conn = get_db()
    features = []

    if feature_type in ('points', 'all'):
        points = conn.execute(
            'SELECT * FROM geological_points WHERE project_id = ?', (project_id,)
        ).fetchall()
        for p in points:
            features.append({
                'type': 'Feature',
                'geometry': {
                    'type': 'Point',
                    'coordinates': [p['longitude'], p['latitude']]
                },
                'properties': {
                    'id': p['id'], 'point_number': p['point_number'],
                    'point_type': p['point_type'], 'elevation': p['elevation'],
                    'rock_type': p['rock_type'], 'stratum_age': p['stratum_age'],
                    'description': p['description']
                }
            })

    if feature_type in ('routes', 'all'):
        routes = conn.execute(
            'SELECT * FROM field_routes WHERE project_id = ?', (project_id,)
        ).fetchall()
        for r in routes:
            try:
                geom = json.loads(r['route_geom']) if r['route_geom'] else []
                features.append({
                    'type': 'Feature',
                    'geometry': {
                        'type': 'LineString',
                        'coordinates': [[pt[1], pt[0]] for pt in geom]  # lat,lng -> lng,lat
                    },
                    'properties': {
                        'id': r['id'], 'name': r['name'],
                        'route_date': r['route_date'], 'surveyor': r['surveyor'],
                        'total_distance': r['total_distance']
                    }
                })
            except:
                pass

    if feature_type in ('boundaries', 'all'):
        boundaries = conn.execute(
            'SELECT * FROM geological_boundaries WHERE project_id = ? AND geom_wkt IS NOT NULL',
            (project_id,)
        ).fetchall()
        for b in boundaries:
            try:
                from shapely import wkt as wkt_parser
                geom = wkt_parser.loads(b['geom_wkt'])
                features.append({
                    'type': 'Feature',
                    'geometry': geom.__geo_interface__,
                    'properties': {
                        'id': b['id'], 'name': b['name'],
                        'boundary_type': b['boundary_type'],
                        'description': b['description']
                    }
                })
            except:
                pass

    if feature_type in ('faults', 'all'):
        faults = conn.execute(
            'SELECT * FROM faults WHERE project_id = ? AND geom_wkt IS NOT NULL',
            (project_id,)
        ).fetchall()
        for f in faults:
            try:
                from shapely import wkt as wkt_parser
                geom = wkt_parser.loads(f['geom_wkt'])
                features.append({
                    'type': 'Feature',
                    'geometry': geom.__geo_interface__,
                    'properties': {
                        'id': f['id'], 'name': f['name'],
                        'fault_type': f['fault_type'], 'dip': f['dip']
                    }
                })
            except:
                pass

    if feature_type in ('areas', 'all'):
        areas = conn.execute(
            'SELECT * FROM geological_areas WHERE project_id = ? AND geom_wkt IS NOT NULL',
            (project_id,)
        ).fetchall()
        for a in areas:
            try:
                from shapely import wkt as wkt_parser
                geom = wkt_parser.loads(a['geom_wkt'])
                features.append({
                    'type': 'Feature',
                    'geometry': geom.__geo_interface__,
                    'properties': {
                        'id': a['id'], 'name': a['name'],
                        'area_type': a['area_type'], 'rock_type': a['rock_type'],
                        'stratum_age': a['stratum_age'],
                        'fill_pattern': a['fill_pattern'], 'fill_color': a['fill_color']
                    }
                })
            except:
                pass

    conn.close()

    geojson = {
        'type': 'FeatureCollection',
        'features': features
    }
    return jsonify(geojson)

@export_bp.route('/csv/<int:project_id>', methods=['GET'])
def export_csv(project_id):
    """导出地质点为CSV"""
    conn = get_db()
    points = conn.execute(
        'SELECT * FROM geological_points WHERE project_id = ?', (project_id,)
    ).fetchall()
    conn.close()

    output = io.StringIO()
    writer = csv.writer(output)

    # 写入表头
    headers = ['点编号', '点类型', '纬度', '经度', '高程', '精度', '定位方式',
               '岩石类型', '地层时代', '地层名称', '构造类型', '走向', '倾向', '倾角',
               '样品编号', '样品类型', '描述', '是否已审核']
    writer.writerow(headers)

    # 写入数据
    for p in points:
        writer.writerow([
            p['point_number'], p['point_type'], p['latitude'], p['longitude'],
            p['elevation'], p['accuracy'], p['location_method'],
            p['rock_type'], p['stratum_age'], p['stratum_name'],
            p['occurrence_type'], p['strike'], p['dip_direction'], p['dip'],
            p['sample_number'], p['sample_type'], p['description'],
            '是' if p['is_checked'] else '否'
        ])

    output.seek(0)
    return Response(
        output.getvalue(),
        mimetype='text/csv',
        headers={'Content-Disposition': f'attachment;filename=geological_points_{project_id}.csv'}
    )

@export_bp.route('/kml/<int:project_id>', methods=['GET'])
def export_kml(project_id):
    """导出为KML格式（Google Earth兼容）"""
    import re
    feature_type = request.args.get('type', 'all')

    def _wkt_to_kml_coords(wkt):
        """将 WKT 几何字符串转换为 KML 坐标字符串（lng,lat lng,lat ...）"""
        if not wkt:
            return ''
        m = re.search(r'LINESTRING\s*\(([^)]+)\)', wkt, re.IGNORECASE)
        if m:
            coords = m.group(1).split(',')
            pts = [c.strip().split() for c in coords]
            return ' '.join('{},{}'.format(p[0], p[1]) for p in pts)
        m = re.search(r'POLYGON\s*\(\(\s*([^)]+)\)\s*\)', wkt, re.IGNORECASE)
        if m:
            coords = m.group(1).split(',')
            pts = [c.strip().split() for c in coords]
            return ' '.join('{},{}'.format(p[0], p[1]) for p in pts)
        return ''

    conn = get_db()

    kml_parts = [
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<kml xmlns="http://www.opengis.net/kml/2.2">',
        '<Document>',
        '<name>地质填图数据</name>',
    ]

    if feature_type in ('points', 'all'):
        points = conn.execute(
            'SELECT * FROM geological_points WHERE project_id = ?', (project_id,)
        ).fetchall()
        for p in points:
            kml_parts.append('<Placemark>')
            kml_parts.append(f'<name>{p["point_number"]}</name>')
            kml_parts.append(f'<description><![CDATA['
                            f'类型: {p["point_type"]}<br>'
                            f'岩石: {p["rock_type"] or "未填写"}<br>'
                            f'地层: {p["stratum_age"] or "未填写"}<br>'
                            f'描述: {p["description"] or "无"}'
                            f']]></description>')
            kml_parts.append(f'<Point><coordinates>{p["longitude"]},{p["latitude"]},{p["elevation"] or 0}</coordinates></Point>')
            kml_parts.append('</Placemark>')

    if feature_type in ('routes', 'all'):
        routes = conn.execute(
            'SELECT * FROM field_routes WHERE project_id = ?', (project_id,)
        ).fetchall()
        for r in routes:
            try:
                geom = json.loads(r['route_geom']) if r['route_geom'] else []
                if geom:
                    coords = ' '.join('{},{}'.format(pt[1], pt[0]) for pt in geom)
                    kml_parts.append('<Placemark>')
                    kml_parts.append(f'<name>{r["name"]}</name>')
                    kml_parts.append(f'<description><![CDATA[路线: {r["name"]}<br>观测者: {r["surveyor"] or "未填写"}<br>日期: {r["route_date"] or "未填写"}]]></description>')
                    kml_parts.append(f'<LineString><coordinates>{coords}</coordinates></LineString>')
                    kml_parts.append('</Placemark>')
            except:
                pass

    if feature_type in ('boundaries', 'all'):
        boundaries = conn.execute(
            'SELECT * FROM geological_boundaries WHERE project_id = ? AND geom_wkt IS NOT NULL', (project_id,)
        ).fetchall()
        for b in boundaries:
            coords = _wkt_to_kml_coords(b['geom_wkt'])
            if coords:
                kml_parts.append('<Placemark>')
                kml_parts.append(f'<name>{b["name"]}</name>')
                kml_parts.append(f'<description><![CDATA[界线类型: {b["boundary_type"] or "未填写"}<br>描述: {b["description"] or "无"}]]></description>')
                kml_parts.append(f'<LineString><coordinates>{coords}</coordinates></LineString>')
                kml_parts.append('</Placemark>')

    if feature_type in ('faults', 'all'):
        faults = conn.execute(
            'SELECT * FROM faults WHERE project_id = ? AND geom_wkt IS NOT NULL', (project_id,)
        ).fetchall()
        for f in faults:
            coords = _wkt_to_kml_coords(f['geom_wkt'])
            if coords:
                kml_parts.append('<Placemark>')
                kml_parts.append(f'<name>{f["name"]}</name>')
                kml_parts.append(f'<description><![CDATA[断层类型: {f["fault_type"] or "未填写"}<br>倾角: {f["dip"] or "未填写"}<br>描述: {f["description"] or "无"}]]></description>')
                kml_parts.append(f'<LineString><coordinates>{coords}</coordinates></LineString>')
                kml_parts.append('</Placemark>')

    if feature_type in ('areas', 'all'):
        areas = conn.execute(
            'SELECT * FROM geological_areas WHERE project_id = ? AND geom_wkt IS NOT NULL', (project_id,)
        ).fetchall()
        for a in areas:
            coords = _wkt_to_kml_coords(a['geom_wkt'])
            if coords:
                kml_parts.append('<Placemark>')
                kml_parts.append(f'<name>{a["name"]}</name>')
                kml_parts.append(f'<description><![CDATA[面类型: {a["area_type"] or "未填写"}<br>岩石: {a["rock_type"] or "未填写"}<br>地层: {a["stratum_age"] or "未填写"}<br>描述: {a["description"] or "无"}]]></description>')
                kml_parts.append('<Polygon><outerBoundaryIs><LinearRing><coordinates>{}</coordinates></LinearRing></outerBoundaryIs></Polygon>'.format(coords))
                kml_parts.append('</Placemark>')

    conn.close()

    kml_parts.append('</Document>')
    kml_parts.append('</kml>')

    return Response(
        '\n'.join(kml_parts),
        mimetype='application/vnd.google-earth.kml+xml',
        headers={'Content-Disposition': f'attachment;filename=geological_data_{project_id}.kml'}
    )

@export_bp.route('/convert-coords', methods=['POST'])
def convert_coords():
    """
    坐标转换端点 — 支持 CGCS2000 ↔ WGS84 ↔ Web Mercator
    POST JSON: { "points": [[lng, lat], ...], "from_crs": "EPSG:4326", "to_crs": "EPSG:4490" }
    """
    data = request.get_json()
    if not data:
        return jsonify({'error': '请提供JSON请求体'}), 400

    points = data.get('points', [])
    from_crs = data.get('from_crs', 'EPSG:4326')
    to_crs = data.get('to_crs', 'EPSG:4490')

    if not points or not isinstance(points, list):
        return jsonify({'error': '请提供points数组'}), 400

    try:
        from pyproj import Transformer
        transformer = Transformer.from_crs(from_crs, to_crs, always_xy=True)

        result = []
        for pt in points:
            if len(pt) >= 2:
                x, y = transformer.transform(float(pt[0]), float(pt[1]))
                out = {'x': round(x, 8), 'y': round(y, 8)}
                if len(pt) >= 3 and pt[2] is not None:
                    out['z'] = float(pt[2])  # 高程不变
                result.append(out)

        return jsonify({
            'from_crs': from_crs,
            'to_crs': to_crs,
            'points': result
        })
    except Exception as e:
        return jsonify({'error': f'坐标转换失败: {str(e)}'}), 500


@export_bp.route('/crs-list', methods=['GET'])
def crs_list():
    """返回支持的坐标系列表"""
    crs_list_data = [
        {'code': 'EPSG:4326', 'name': 'WGS84 (GPS经纬度)', 'proj': '地理坐标系'},
        {'code': 'EPSG:4490', 'name': 'CGCS2000 大地坐标系', 'proj': '地理坐标系'},
        {'code': 'EPSG:4547', 'name': 'CGCS2000 / 3度带 39带', 'proj': '投影坐标系'},
        {'code': 'EPSG:4548', 'name': 'CGCS2000 / 3度带 40带', 'proj': '投影坐标系'},
        {'code': 'EPSG:3857', 'name': 'Web Mercator (在线地图)', 'proj': '投影坐标系'},
    ]
    return jsonify(crs_list_data)


@export_bp.route('/shapefile/<int:project_id>', methods=['GET'])
def export_shapefile(project_id):
    """导出为Shapefile格式（ZIP压缩包）"""
    import zipfile
    import tempfile

    conn = get_db()
    points = conn.execute(
        'SELECT * FROM geological_points WHERE project_id = ?', (project_id,)
    ).fetchall()
    conn.close()

    # 创建临时ZIP文件
    temp_dir = tempfile.mkdtemp()
    zip_path = os.path.join(temp_dir, 'export.zip')

    with zipfile.ZipFile(zip_path, 'w', zipfile.ZIP_DEFLATED) as zf:
        # 生成.prj文件
        prj_content = '''GEOGCS["WGS 84",DATUM["WGS_1984",SPHEROID["WGS 84",6378137,298.257223563,AUTHORITY["EPSG","7030"]],AUTHORITY["EPSG","6326"]],PRIMEM["Greenwich",0,AUTHORITY["EPSG","8901"]],UNIT["degree",0.0174532925199433,AUTHORITY["EPSG","9122"]],AUTHORITY["EPSG","4326"]]'''
        zf.writestr('geological_points.prj', prj_content)

        # 尝试生成真正的 Shapefile
        try:
            import shapefile as shp
            shp_path = os.path.join(temp_dir, 'geological_points')
            writer = shp.Writer(shp_path, shp.POINT)
            writer.field('point_num', 'C', 50)
            writer.field('point_typ', 'C', 50)
            writer.field('latitude', 'N', decimal=8)
            writer.field('longitude', 'N', decimal=8)
            writer.field('elevation', 'N', decimal=2)
            writer.field('rock_type', 'C', 100)
            writer.field('stratum_a', 'C', 100)
            writer.field('descripti', 'C', 255)

            for p in points:
                writer.point(p['longitude'], p['latitude'])
                writer.record(
                    p['point_number'], p['point_type'],
                    p['latitude'], p['longitude'],
                    p['elevation'] or 0,
                    p['rock_type'] or '', p['stratum_age'] or '',
                    (p['description'] or '')[:255]
                )
            writer.close()

            # 将 .shp, .shx, .dbf 写入 ZIP
            for ext in ['.shp', '.shx', '.dbf']:
                full_path = shp_path + ext
                if os.path.exists(full_path):
                    zf.write(full_path, 'geological_points' + ext)
                    os.remove(full_path)

            zf.writestr('README.txt',
                'Shapefile 导出说明:\n'
                '本 ZIP 包含标准的 ESRI Shapefile 格式数据（.shp/.shx/.dbf/.prj）。\n'
                '可直接在 QGIS、ArcGIS 等 GIS 软件中打开。\n'
                '坐标系: WGS84 (EPSG:4326)\n'
                '字段说明:\n'
                '  point_num  : 点编号\n'
                '  point_typ  : 点类型\n'
                '  latitude   : 纬度\n'
                '  longitude  : 经度\n'
                '  elevation  : 高程\n'
                '  rock_type  : 岩石类型\n'
                '  stratum_a  : 地层时代\n'
                '  descripti  : 描述\n'
            )
        except ImportError:
            # 回退到 CSV 方案
            csv_output = io.StringIO()
            writer = csv.writer(csv_output)
            writer.writerow(['point_num', 'point_typ', 'latitude', 'longitude', 'elevation',
                             'rock_type', 'stratum_a', 'descripti'])
            for p in points:
                writer.writerow([
                    p['point_number'], p['point_type'], p['latitude'], p['longitude'],
                    p['elevation'] or '', p['rock_type'] or '', p['stratum_age'] or '',
                    (p['description'] or '')[:100]
                ])
            zf.writestr('geological_points.csv', csv_output.getvalue())
            zf.writestr('geological_points.shp', '')  # 空占位文件
            zf.writestr('geological_points.shx', '')  # 空占位文件
            zf.writestr('geological_points.dbf', '')  # 空占位文件
            zf.writestr('README.txt',
                'Shapefile 导出说明 (CSV 回退模式):\n'
                '由于运行环境未安装 pyshp 库，无法生成真正的 .shp/.dbf/.shx 文件。\n'
                '本 ZIP 包含 CSV 格式的点数据，可通过以下方式在 GIS 软件中使用：\n'
                '  - QGIS: 菜单 → 图层 → 添加图层 → 添加分隔文本图层\n'
                '  - ArcGIS: 工具 → 添加 XY 数据\n'
                '坐标系: WGS84 (EPSG:4326)\n'
                '字段说明:\n'
                '  point_num  : 点编号\n'
                '  point_typ  : 点类型\n'
                '  latitude   : 纬度 (Y 字段)\n'
                '  longitude  : 经度 (X 字段)\n'
                '  elevation  : 高程\n'
                '  rock_type  : 岩石类型\n'
                '  stratum_a  : 地层时代\n'
                '  descripti  : 描述\n'
            )

    with open(zip_path, 'rb') as f:
        data = f.read()

    os.remove(zip_path)
    os.rmdir(temp_dir)

    return Response(
        data,
        mimetype='application/zip',
        headers={'Content-Disposition': f'attachment;filename=geological_data_{project_id}.zip'}
    )
