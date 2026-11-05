"""
数据同步与导入导出 API
"""

from flask import Blueprint, request, jsonify
from database import get_db
import json, os, tempfile

from services.import_service import (
    detect_format, parse_shapefile, parse_geojson, parse_csv,
    parse_kml, parse_gpx, import_to_db
)
from config import MAX_UPLOAD_SIZE, MAX_UPLOAD_FILES

sync_bp = Blueprint('sync', __name__)

# ── 标准导入目标类型 ─────────────────────────────────────────
VALID_TARGETS = {'geo_points', 'routes', 'boundaries', 'faults', 'areas'}

# ── Routes ──────────────────────────────────────────────────

@sync_bp.route('/import', methods=['POST'])
def import_data():
    """统一数据导入 — 支持 Shapefile / GeoJSON / CSV / KML / GPX / JSON(移动端)"""

    # 方式1: multipart/form-data — 文件上传
    if request.content_type and 'multipart' in request.content_type:
        project_id = int(request.form.get('project_id', 0))
        target_type = request.form.get('target_type', 'geo_points')

        if not project_id:
            return jsonify({'error': '项目ID不能为空'}), 400
        if target_type not in VALID_TARGETS:
            return jsonify({'error': '无效的导入目标类型: {}。有效值: {}'.format(
                target_type, ', '.join(VALID_TARGETS))}), 400

        files = request.files.getlist('files')
        if not files:
            return jsonify({'error': '请选择文件'}), 400

        # 安全检查
        if len(files) > MAX_UPLOAD_FILES:
            return jsonify({'error': '单次最多上传 {} 个文件'.format(MAX_UPLOAD_FILES)}), 400
        total_size = 0
        for f in files:
            f.seek(0, 2)  # seek to end
            total_size += f.tell()
            f.seek(0)
        if total_size > MAX_UPLOAD_SIZE:
            return jsonify({'error': '文件总大小不能超过 {}MB'.format(MAX_UPLOAD_SIZE // 1024 // 1024)}), 400

        # 检测格式并解析
        fmt = detect_format(files)
        preview_only = request.form.get('preview', '0') == '1'

        try:
            tmpdir = tempfile.mkdtemp()
            try:
                for i, f in enumerate(files):
                    # 安全获取文件名：避免空字符串导致保存到目录路径
                    fname = f.filename
                    if not fname or fname.strip() == '':
                        fname = f'file_{i}'
                    fpath = os.path.join(tmpdir, fname)
                    f.save(fpath)
                    f.seek(0)  # 重置游标，否则后续 file.read() 返回空

                if fmt == 'shapefile':
                    # 检查必需文件是否存在并给出友好提示
                    shp_count = sum(1 for _, _, fs in os.walk(tmpdir) for name in fs if name.lower().endswith('.shp'))
                    dbf_count = sum(1 for _, _, fs in os.walk(tmpdir) for name in fs if name.lower().endswith('.dbf'))
                    shx_count = sum(1 for _, _, fs in os.walk(tmpdir) for name in fs if name.lower().endswith('.shx'))
                    if shp_count == 0:
                        raise ValueError('未找到 .shp 文件，请确保上传了 Shapefile 主文件')
                    if dbf_count == 0:
                        raise ValueError('缺少 .dbf 文件，Shapefile 必须同时包含 .shp + .dbf + .shx（至少 .shp + .dbf）')
                    parsed = parse_shapefile(files, tmpdir)
                elif fmt == 'geojson':
                    parsed = parse_geojson(files[0])
                elif fmt == 'csv':
                    parsed = parse_csv(files[0])
                elif fmt == 'kml':
                    parsed = parse_kml(files[0])
                elif fmt == 'gpx':
                    parsed = parse_gpx(files[0])
                else:
                    return jsonify({'error': '无法识别的文件格式。支持: SHP/GeoJSON/CSV/KML/GPX'}), 400
            finally:
                import shutil
                shutil.rmtree(tmpdir, ignore_errors=True)
        except ValueError as e:
            return jsonify({'error': str(e)}), 400
        except ImportError as e:
            return jsonify({'error': '缺少依赖库: {}。请运行 pip install -r requirements.txt'.format(str(e))}), 400
        except Exception as e:
            return jsonify({'error': '文件解析失败: {}'.format(str(e))}), 400

        # 预览模式 — 仅返回前 20 条
        if preview_only:
            preview = {
                'format': parsed.get('format', fmt),
                'target_type': target_type,
                'preview_points': parsed.get('points', [])[:20],
                'preview_lines': parsed.get('lines', [])[:5],
                'preview_polygons': parsed.get('polygons', [])[:5],
                'preview_routes': parsed.get('routes', [])[:5],
                'total_points': len(parsed.get('points', [])),
                'total_lines': len(parsed.get('lines', [])),
                'total_polygons': len(parsed.get('polygons', [])),
                'total_routes': len(parsed.get('routes', [])),
                'column_mapping': parsed.get('column_mapping'),
            }
            return jsonify(preview)

        # 导入模式 — dry-run 预校验
        conn = get_db()
        try:
            # 预校验：检查坐标范围
            points = parsed.get('points', [])
            bad = [p for p in points
                   if not (-90 <= (p.get('latitude') or 0) <= 90)
                   or not (-180 <= (p.get('longitude') or 0) <= 180)]
            if bad:
                conn.close()
                return jsonify({'error': '{} 个点坐标超出合法范围'.format(len(bad))}), 400

            # 写入（事务性）
            count = import_to_db(conn, parsed, target_type, project_id)
            conn.close()

            return jsonify({
                'format': fmt,
                'imported_count': count,
                'target_type': target_type,
                'message': '导入完成: {} 条数据已写入 {}'.format(count, target_type)
            })
        except Exception as e:
            conn.close()
            return jsonify({'error': '导入失败（数据已回滚）: {}'.format(str(e))}), 400

    # 方式2: application/json — 移动端同步
    elif request.is_json:
        data = request.get_json(silent=True) or {}
        project_id = data.get('project_id')
        if not project_id:
            return jsonify({'error': '项目ID不能为空'}), 400

        conn = get_db()
        # 移动端直接使用 _mobile_import
        imported = _mobile_import(conn, int(project_id), data)
        conn.close()

        parts = []
        if imported.get('points'): parts.append('{}点'.format(imported['points']))
        if imported.get('routes'): parts.append('{}路线'.format(imported['routes']))
        return jsonify({
            'format': 'json',
            'imported': imported,
            'message': '移动端同步完成: ' + ', '.join(parts) if parts else '无数据'
        })

    return jsonify({'error': '不支持的请求格式'}), 400


@sync_bp.route('/import/preview', methods=['POST'])
def import_preview():
    """预览导入数据 — 与 import 逻辑相同但 preview=true"""
    # 委托到 import 端点，加 preview 标志
    return import_data()


def _mobile_import(conn, project_id, data):
    """移动端 JSON 同步数据写入"""
    imported = {'points': 0, 'routes': 0, 'errors': []}

    for point in data.get('points', []):
        try:
            conn.execute(
                '''INSERT OR REPLACE INTO geological_points
                   (id, project_id, point_number, point_type, latitude, longitude,
                    elevation, accuracy, location_method, description, rock_type,
                    stratum_age, stratum_name, occurrence_type, strike, dip, dip_direction,
                    sample_number, sample_type, symbol)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)''',
                (point.get('id'), project_id,
                 point.get('point_number', 'M{:04d}'.format(imported['points'] + 1)),
                 point.get('point_type', '地质观察点'),
                 point.get('latitude', 0), point.get('longitude', 0),
                 point.get('elevation'), point.get('accuracy'),
                 point.get('location_method', 'GPS'), point.get('description', ''),
                 point.get('rock_type', ''), point.get('stratum_age', ''),
                 point.get('stratum_name', ''), point.get('occurrence_type', ''),
                 point.get('strike'), point.get('dip'), point.get('dip_direction'),
                 point.get('sample_number', ''), point.get('sample_type', ''),
                 point.get('symbol', None))
            )
            imported['points'] += 1
        except Exception as e:
            imported['errors'].append('点 {}: {}'.format(point.get('point_number', '?'), e))

    for route in data.get('routes', []):
        try:
            conn.execute(
                '''INSERT OR REPLACE INTO field_routes
                   (id, project_id, name, route_date, surveyor, description, route_geom)
                   VALUES (?, ?, ?, ?, ?, ?, ?)''',
                (route.get('id'), project_id,
                 route.get('name', '路线{}'.format(imported['routes'] + 1)),
                 route.get('route_date', ''), route.get('surveyor', ''),
                 route.get('description', ''), route.get('route_geom', ''))
            )
            imported['routes'] += 1
        except Exception as e:
            imported['errors'].append('路线 {}: {}'.format(route.get('name', '?'), e))

    conn.commit()
    return imported


@sync_bp.route('/export/<int:project_id>', methods=['GET'])
def export_data(project_id):
    """导出项目数据（供移动端同步）"""
    conn = get_db()
    project = conn.execute('SELECT * FROM projects WHERE id = ?', (project_id,)).fetchone()
    if not project:
        conn.close()
        return jsonify({'error': '项目不存在'}), 404

    tables = {
        'points': 'geological_points', 'routes': 'field_routes',
        'samples': 'sample_ledger', 'boundaries': 'geological_boundaries',
        'faults': 'faults', 'areas': 'geological_areas',
    }
    result = {'project': dict(project), 'export_time': None, 'data': {}}
    for key, table in tables.items():
        rows = conn.execute('SELECT * FROM {} WHERE project_id = ?'.format(table), (project_id,)).fetchall()
        result['data'][key] = [dict(r) for r in rows]

    conn.close()
    return jsonify(result)


@sync_bp.route('/status/<int:project_id>', methods=['GET'])
def sync_status(project_id):
    conn = get_db()
    stats = {
        'points_total': conn.execute('SELECT COUNT(*) FROM geological_points WHERE project_id = ?', (project_id,)).fetchone()[0],
        'points_checked': conn.execute('SELECT COUNT(*) FROM geological_points WHERE project_id = ? AND is_checked = 1', (project_id,)).fetchone()[0],
        'routes_total': conn.execute('SELECT COUNT(*) FROM field_routes WHERE project_id = ?', (project_id,)).fetchone()[0],
        'photos_total': conn.execute('SELECT COUNT(*) FROM photos WHERE project_id = ?', (project_id,)).fetchone()[0],
        'samples_total': conn.execute('SELECT COUNT(*) FROM sample_ledger WHERE project_id = ?', (project_id,)).fetchone()[0],
    }
    conn.close()
    return jsonify(stats)


@sync_bp.route('/check-data/<int:project_id>', methods=['GET'])
def check_data(project_id):
    conn = get_db()
    issues = []
    mc = conn.execute('SELECT COUNT(*) FROM geological_points WHERE project_id = ? AND (latitude IS NULL OR longitude IS NULL)', (project_id,)).fetchone()[0]
    if mc: issues.append({'type': '缺失坐标', 'count': mc, 'message': '{}个地质点缺少坐标'.format(mc)})
    os_ = conn.execute("SELECT COUNT(*) FROM sample_ledger WHERE project_id = ? AND (point_id IS NULL OR latitude IS NULL)", (project_id,)).fetchone()[0]
    if os_: issues.append({'type': '样品不完整', 'count': os_, 'message': '{}个样品缺少关联点或坐标'.format(os_)})
    op = conn.execute('SELECT COUNT(*) FROM photos WHERE project_id = ? AND point_id IS NULL AND route_id IS NULL', (project_id,)).fetchone()[0]
    if op: issues.append({'type': '照片未关联', 'count': op, 'message': '{}张照片未关联'.format(op)})
    rwt = conn.execute("""SELECT f.name FROM field_routes f WHERE f.project_id = ? AND f.id NOT IN (SELECT DISTINCT route_id FROM route_trackpoints)""", (project_id,)).fetchall()
    if rwt: issues.append({'type': '路线无轨迹', 'count': len(rwt), 'routes': [r[0] for r in rwt], 'message': '{}条路线没有轨迹点'.format(len(rwt))})
    conn.close()
    return jsonify({'issues': issues, 'total_issues': len(issues), 'is_complete': len(issues) == 0})
