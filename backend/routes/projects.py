"""
项目管理 API
"""

from flask import Blueprint, request, jsonify
from database import get_db

projects_bp = Blueprint('projects', __name__)

@projects_bp.route('/', methods=['GET'])
def list_projects():
    """获取所有项目列表"""
    conn = get_db()
    projects = conn.execute(
        'SELECT * FROM projects ORDER BY updated_at DESC'
    ).fetchall()
    conn.close()
    return jsonify([dict(p) for p in projects])

@projects_bp.route('/<int:project_id>', methods=['GET'])
def get_project(project_id):
    """获取单个项目详情"""
    conn = get_db()
    project = conn.execute(
        'SELECT * FROM projects WHERE id = ?', (project_id,)
    ).fetchone()
    if not project:
        conn.close()
        return jsonify({'error': '项目不存在'}), 404

    # 获取统计数据
    stats = {
        'route_count': conn.execute(
            'SELECT COUNT(*) FROM field_routes WHERE project_id = ?', (project_id,)
        ).fetchone()[0],
        'point_count': conn.execute(
            'SELECT COUNT(*) FROM geological_points WHERE project_id = ?', (project_id,)
        ).fetchone()[0],
        'photo_count': conn.execute(
            'SELECT COUNT(*) FROM photos WHERE project_id = ?', (project_id,)
        ).fetchone()[0],
        'sample_count': conn.execute(
            'SELECT COUNT(*) FROM sample_ledger WHERE project_id = ?', (project_id,)
        ).fetchone()[0],
    }
    conn.close()
    return jsonify({**dict(project), 'stats': stats})

@projects_bp.route('/', methods=['POST'])
def create_project():
    """创建新项目"""
    data = request.json
    conn = get_db()
    cursor = conn.execute(
        '''INSERT INTO projects (name, description, region, crs)
           VALUES (?, ?, ?, ?)''',
        (data['name'], data.get('description', ''),
         data.get('region', ''), data.get('crs', 'EPSG:4326'))
    )
    conn.commit()
    project_id = cursor.lastrowid
    conn.close()
    return jsonify({'id': project_id, 'message': '项目创建成功'}), 201

@projects_bp.route('/<int:project_id>', methods=['PUT'])
def update_project(project_id):
    """更新项目"""
    data = request.json
    conn = get_db()
    conn.execute(
        '''UPDATE projects SET name=?, description=?, region=?, crs=?,
           updated_at=CURRENT_TIMESTAMP WHERE id=?''',
        (data['name'], data.get('description', ''),
         data.get('region', ''), data.get('crs', 'EPSG:4326'),
         project_id)
    )
    conn.commit()
    conn.close()
    return jsonify({'message': '项目更新成功'})

@projects_bp.route('/<int:project_id>', methods=['DELETE'])
def delete_project(project_id):
    """删除项目及其所有关联数据"""
    conn = get_db()
    try:
        # 显式删除所有子表数据（按依赖顺序：先删子再删父）
        # route_trackpoints 无 project_id，通过 route_id 关联删除
        conn.execute('DELETE FROM route_trackpoints WHERE route_id IN (SELECT id FROM field_routes WHERE project_id = ?)', (project_id,))
        # 其余表直接有 project_id
        direct_tables = [
            'geological_points',
            'photos', 'attachments', 'sample_ledger',
            'geological_boundaries', 'faults', 'geological_areas',
            'data_versions', 'field_routes',
        ]
        for table in direct_tables:
            conn.execute('DELETE FROM {} WHERE project_id = ?'.format(table), (project_id,))
        # 最后删除项目本身
        conn.execute('DELETE FROM projects WHERE id = ?', (project_id,))
        conn.commit()
        return jsonify({'message': '项目及所有关联数据已删除'})
    except Exception as e:
        conn.rollback()
        return jsonify({'error': '删除失败: {}'.format(str(e))}), 500
    finally:
        conn.close()

@projects_bp.route('/<int:project_id>/overview', methods=['GET'])
def project_overview(project_id):
    """获取项目概览（包含所有点、线、面数据）"""
    conn = get_db()
    points = conn.execute(
        'SELECT id, point_number, point_type, latitude, longitude, elevation, '
        'rock_type, stratum_age, description FROM geological_points WHERE project_id = ?',
        (project_id,)
    ).fetchall()

    routes = conn.execute(
        'SELECT id, name, route_date, total_distance, route_geom FROM field_routes WHERE project_id = ?',
        (project_id,)
    ).fetchall()

    boundaries = conn.execute(
        'SELECT id, name, boundary_type, geom_wkt FROM geological_boundaries WHERE project_id = ?',
        (project_id,)
    ).fetchall()

    faults = conn.execute(
        'SELECT id, name, fault_type, geom_wkt FROM faults WHERE project_id = ?',
        (project_id,)
    ).fetchall()

    areas = conn.execute(
        'SELECT id, name, area_type, rock_type, stratum_age, fill_pattern, fill_color, geom_wkt '
        'FROM geological_areas WHERE project_id = ?',
        (project_id,)
    ).fetchall()

    conn.close()
    return jsonify({
        'points': [dict(p) for p in points],
        'routes': [dict(r) for r in routes],
        'boundaries': [dict(b) for b in boundaries],
        'faults': [dict(f) for f in faults],
        'areas': [dict(a) for a in areas],
    })
