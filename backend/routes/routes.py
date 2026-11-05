"""
野外路线管理 API
"""

from flask import Blueprint, request, jsonify
from database import get_db
import json

routes_bp = Blueprint('routes', __name__)

@routes_bp.route('/project/<int:project_id>', methods=['GET'])
def list_routes(project_id):
    """获取项目下所有路线"""
    conn = get_db()
    routes = conn.execute(
        'SELECT * FROM field_routes WHERE project_id = ? ORDER BY route_date DESC',
        (project_id,)
    ).fetchall()
    conn.close()
    return jsonify([dict(r) for r in routes])

@routes_bp.route('/<int:route_id>', methods=['GET'])
def get_route(route_id):
    """获取单条路线详情（含轨迹点）"""
    conn = get_db()
    route = conn.execute(
        'SELECT * FROM field_routes WHERE id = ?', (route_id,)
    ).fetchone()
    if not route:
        conn.close()
        return jsonify({'error': '路线不存在'}), 404

    trackpoints = conn.execute(
        'SELECT * FROM route_trackpoints WHERE route_id = ? ORDER BY timestamp',
        (route_id,)
    ).fetchall()

    points = conn.execute(
        'SELECT * FROM geological_points WHERE route_id = ?', (route_id,)
    ).fetchall()

    conn.close()
    return jsonify({
        **dict(route),
        'trackpoints': [dict(t) for t in trackpoints],
        'points': [dict(p) for p in points]
    })

@routes_bp.route('/', methods=['POST'])
def create_route():
    """创建新路线"""
    data = request.json
    conn = get_db()
    cursor = conn.execute(
        '''INSERT INTO field_routes (project_id, name, route_date, surveyor,
           description, weather, start_time)
           VALUES (?, ?, ?, ?, ?, ?, ?)''',
        (data['project_id'], data['name'], data.get('route_date'),
         data.get('surveyor', ''), data.get('description', ''),
         data.get('weather', ''), data.get('start_time'))
    )
    conn.commit()
    route_id = cursor.lastrowid
    conn.close()
    return jsonify({'id': route_id, 'message': '路线创建成功'}), 201

@routes_bp.route('/<int:route_id>', methods=['PUT'])
def update_route(route_id):
    """更新路线信息"""
    data = request.json
    conn = get_db()
    conn.execute(
        '''UPDATE field_routes SET name=?, surveyor=?, description=?,
           weather=?, end_time=?, total_distance=?, route_geom=?
           WHERE id=?''',
        (data.get('name'), data.get('surveyor'), data.get('description'),
         data.get('weather'), data.get('end_time'), data.get('total_distance'),
         data.get('route_geom'), route_id)
    )
    conn.commit()
    conn.close()
    return jsonify({'message': '路线更新成功'})

@routes_bp.route('/<int:route_id>/trackpoints', methods=['POST'])
def add_trackpoints(route_id):
    """批量添加轨迹点，并自动生成 route_geom"""
    points = request.json.get('points', [])
    if not points:
        return jsonify({'error': '轨迹点数据为空'}), 400

    conn = get_db()
    for pt in points:
        conn.execute(
            '''INSERT INTO route_trackpoints
               (route_id, latitude, longitude, elevation, accuracy, speed, bearing, timestamp, sequence)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)''',
            (route_id, pt['latitude'], pt['longitude'], pt.get('elevation'),
             pt.get('accuracy'), pt.get('speed'), pt.get('bearing'),
             pt.get('timestamp'), pt.get('sequence', 0))
        )
    conn.commit()

    # 根据轨迹点生成 route_geom（LINESTRING WKT 格式）
    # 按 sequence 排序保证轨迹点顺序正确
    trackpoints = conn.execute(
        '''SELECT latitude, longitude FROM route_trackpoints
           WHERE route_id = ? ORDER BY sequence, id''',
        (route_id,)
    ).fetchall()

    if len(trackpoints) >= 2:
        # 构建 WKT LINESTRING: "LINESTRING(lng lat, lng lat, ...)"
        wkt_coords = ', '.join(f"{tp['longitude']} {tp['latitude']}" for tp in trackpoints)
        route_geom = f'LINESTRING({wkt_coords})'

        conn.execute(
            'UPDATE field_routes SET route_geom = ? WHERE id = ?',
            (route_geom, route_id)
        )
        conn.commit()

    conn.close()
    return jsonify({'message': f'成功添加 {len(points)} 个轨迹点'})

@routes_bp.route('/<int:route_id>/trackpoints', methods=['GET'])
def get_trackpoints(route_id):
    """获取路线的所有轨迹点"""
    conn = get_db()
    points = conn.execute(
        'SELECT * FROM route_trackpoints WHERE route_id = ? ORDER BY timestamp',
        (route_id,)
    ).fetchall()
    conn.close()
    return jsonify([dict(p) for p in points])

@routes_bp.route('/<int:route_id>', methods=['DELETE'])
def delete_route(route_id):
    """删除路线"""
    conn = get_db()
    conn.execute('DELETE FROM field_routes WHERE id = ?', (route_id,))
    conn.commit()
    conn.close()
    return jsonify({'message': '路线删除成功'})

@routes_bp.route('/<int:route_id>/log', methods=['GET'])
def get_route_log(route_id):
    """获取路线日志（自动生成）"""
    conn = get_db()
    route = conn.execute(
        'SELECT * FROM field_routes WHERE id = ?', (route_id,)
    ).fetchone()
    if not route:
        conn.close()
        return jsonify({'error': '路线不存在'}), 404

    points = conn.execute(
        'SELECT * FROM geological_points WHERE route_id = ? ORDER BY created_at',
        (route_id,)
    ).fetchall()

    trackpoints = conn.execute(
        'SELECT COUNT(*), MIN(timestamp), MAX(timestamp), '
        'AVG(elevation), MAX(elevation), MIN(elevation) '
        'FROM route_trackpoints WHERE route_id = ?', (route_id,)
    ).fetchone()

    route_dict = dict(route)
    log = {
        'route_name': route_dict['name'],
        'route_date': route_dict['route_date'],
        'surveyor': route_dict['surveyor'],
        'weather': route_dict['weather'],
        'trackpoint_count': trackpoints[0] or 0,
        'start_time': trackpoints[1],
        'end_time': trackpoints[2],
        'avg_elevation': round(trackpoints[3], 1) if trackpoints[3] else None,
        'max_elevation': trackpoints[4],
        'min_elevation': trackpoints[5],
        'point_count': len(points),
        'point_summary': [],
    }
    for p in points:
        log['point_summary'].append({
            'number': p['point_number'],
            'type': p['point_type'],
            'rock_type': p['rock_type'],
            'description': p['description'][:100] if p['description'] else ''
        })
    conn.close()
    return jsonify(log)
