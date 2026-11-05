"""
地质界线管理 API
"""

from flask import Blueprint, request, jsonify
from database import get_db

boundaries_bp = Blueprint('boundaries', __name__)

@boundaries_bp.route('/<int:boundary_id>', methods=['GET'])
def get_boundary(boundary_id):
    """获取单条地质界线"""
    conn = get_db()
    boundary = conn.execute(
        'SELECT * FROM geological_boundaries WHERE id = ?', (boundary_id,)
    ).fetchone()
    conn.close()
    if not boundary:
        return jsonify({'error': '界线不存在'}), 404
    return jsonify(dict(boundary))

@boundaries_bp.route('/project/<int:project_id>', methods=['GET'])
def list_boundaries(project_id):
    """获取项目下所有地质界线"""
    conn = get_db()
    boundaries = conn.execute(
        'SELECT * FROM geological_boundaries WHERE project_id = ?',
        (project_id,)
    ).fetchall()
    conn.close()
    return jsonify([dict(b) for b in boundaries])

@boundaries_bp.route('/', methods=['POST'])
def create_boundary():
    """创建地质界线"""
    data = request.json
    conn = get_db()
    cursor = conn.execute(
        '''INSERT INTO geological_boundaries
           (project_id, name, boundary_type, description, geom_wkt, left_unit, right_unit)
           VALUES (?, ?, ?, ?, ?, ?, ?)''',
        (data['project_id'], data['name'], data.get('boundary_type', ''),
         data.get('description', ''), data.get('geom_wkt', ''),
         data.get('left_unit', ''), data.get('right_unit', ''))
    )
    conn.commit()
    boundary_id = cursor.lastrowid
    conn.close()
    return jsonify({'id': boundary_id, 'message': '地质界线创建成功'}), 201

@boundaries_bp.route('/<int:boundary_id>', methods=['PUT'])
def update_boundary(boundary_id):
    """更新地质界线"""
    data = request.json
    conn = get_db()
    conn.execute(
        '''UPDATE geological_boundaries SET
           name=?, boundary_type=?, description=?, geom_wkt=?,
           left_unit=?, right_unit=? WHERE id=?''',
        (data.get('name'), data.get('boundary_type'), data.get('description'),
         data.get('geom_wkt'), data.get('left_unit'), data.get('right_unit'),
         boundary_id)
    )
    conn.commit()
    conn.close()
    return jsonify({'message': '地质界线更新成功'})

@boundaries_bp.route('/<int:boundary_id>', methods=['DELETE'])
def delete_boundary(boundary_id):
    """删除地质界线"""
    conn = get_db()
    conn.execute('DELETE FROM geological_boundaries WHERE id = ?', (boundary_id,))
    conn.commit()
    conn.close()
    return jsonify({'message': '地质界线删除成功'})

@boundaries_bp.route('/project/<int:project_id>/topology-check', methods=['GET'])
def topology_check(project_id):
    """拓扑检查（线断裂检查）"""
    conn = get_db()
    boundaries = conn.execute(
        'SELECT * FROM geological_boundaries WHERE project_id = ?',
        (project_id,)
    ).fetchall()

    # 简单的拓扑检查：检测可能的断裂（端点距离检查）
    issues = []
    wkt_lines = []

    for b in boundaries:
        if b['geom_wkt']:
            try:
                from shapely import wkt
                geom = wkt.loads(b['geom_wkt'])
                if geom.geom_type == 'LineString':
                    wkt_lines.append((b['id'], b['name'], geom))
            except:
                pass

    # 检查线段端点之间的距离
    threshold = 0.0001  # 约10米
    for i in range(len(wkt_lines)):
        for j in range(i + 1, len(wkt_lines)):
            id1, name1, line1 = wkt_lines[i]
            id2, name2, line2 = wkt_lines[j]

            # 检查line1终点与line2起点的距离
            dist1 = line1.boundary.geoms[1].distance(line2.boundary.geoms[0])
            # 检查line1起点与line2终点的距离
            dist2 = line1.boundary.geoms[0].distance(line2.boundary.geoms[1])

            if 0 < dist1 < threshold:
                issues.append({
                    'type': '线断裂',
                    'line1_id': id1, 'line1_name': name1,
                    'line2_id': id2, 'line2_name': name2,
                    'distance': round(dist1 * 111000, 2),
                    'message': f'{name1}终点与{name2}起点间距{dist1*111000:.1f}米'
                })
            if 0 < dist2 < threshold:
                issues.append({
                    'type': '线断裂',
                    'line1_id': id2, 'line1_name': name2,
                    'line2_id': id1, 'line2_name': name1,
                    'distance': round(dist2 * 111000, 2),
                    'message': f'{name2}终点与{name1}起点间距{dist2*111000:.1f}米'
                })

    conn.close()
    return jsonify({'issues': issues, 'total': len(issues)})
