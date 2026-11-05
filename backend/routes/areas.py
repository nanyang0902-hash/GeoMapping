"""
地层面管理 API
"""

from flask import Blueprint, request, jsonify
from database import get_db

areas_bp = Blueprint('areas', __name__)

@areas_bp.route('/<int:area_id>', methods=['GET'])
def get_area(area_id):
    """获取单个地层面"""
    conn = get_db()
    area = conn.execute(
        'SELECT * FROM geological_areas WHERE id = ?', (area_id,)
    ).fetchone()
    conn.close()
    if not area:
        return jsonify({'error': '地层面不存在'}), 404
    return jsonify(dict(area))

@areas_bp.route('/project/<int:project_id>', methods=['GET'])
def list_areas(project_id):
    """获取项目下所有地层面"""
    conn = get_db()
    areas = conn.execute(
        'SELECT * FROM geological_areas WHERE project_id = ?', (project_id,)
    ).fetchall()
    conn.close()
    return jsonify([dict(a) for a in areas])

@areas_bp.route('/', methods=['POST'])
def create_area():
    """创建地层面"""
    data = request.json
    conn = get_db()
    cursor = conn.execute(
        '''INSERT INTO geological_areas
           (project_id, name, area_type, rock_type, stratum_age, description,
            fill_pattern, fill_color, geom_wkt)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)''',
        (data['project_id'], data['name'], data.get('area_type', ''),
         data.get('rock_type', ''), data.get('stratum_age', ''),
         data.get('description', ''), data.get('fill_pattern', ''),
         data.get('fill_color', ''), data.get('geom_wkt', ''))
    )
    conn.commit()
    area_id = cursor.lastrowid
    conn.close()
    return jsonify({'id': area_id, 'message': '地层面创建成功'}), 201

@areas_bp.route('/<int:area_id>', methods=['PUT'])
def update_area(area_id):
    """更新地层面"""
    data = request.json
    conn = get_db()
    conn.execute(
        '''UPDATE geological_areas SET
           name=?, area_type=?, rock_type=?, stratum_age=?, description=?,
           fill_pattern=?, fill_color=?, geom_wkt=? WHERE id=?''',
        (data.get('name'), data.get('area_type'), data.get('rock_type'),
         data.get('stratum_age'), data.get('description'), data.get('fill_pattern'),
         data.get('fill_color'), data.get('geom_wkt'), area_id)
    )
    conn.commit()
    conn.close()
    return jsonify({'message': '地层面更新成功'})

@areas_bp.route('/<int:area_id>', methods=['DELETE'])
def delete_area(area_id):
    """删除地层面"""
    conn = get_db()
    conn.execute('DELETE FROM geological_areas WHERE id = ?', (area_id,))
    conn.commit()
    conn.close()
    return jsonify({'message': '地层面删除成功'})

@areas_bp.route('/project/<int:project_id>/topology-check', methods=['GET'])
def area_topology_check(project_id):
    """地层面拓扑检查（重叠、缝隙检查）"""
    conn = get_db()
    areas = conn.execute(
        'SELECT * FROM geological_areas WHERE project_id = ?', (project_id,)
    ).fetchall()

    issues = []
    area_geoms = []

    for a in areas:
        if a['geom_wkt']:
            try:
                from shapely import wkt
                geom = wkt.loads(a['geom_wkt'])
                if geom.geom_type == 'Polygon' or geom.geom_type == 'MultiPolygon':
                    area_geoms.append((a['id'], a['name'], geom))
            except:
                pass

    # 检查面重叠
    for i in range(len(area_geoms)):
        for j in range(i + 1, len(area_geoms)):
            id1, name1, poly1 = area_geoms[i]
            id2, name2, poly2 = area_geoms[j]

            if poly1.intersects(poly2):
                intersection = poly1.intersection(poly2)
                if not intersection.is_empty:
                    area_ratio = intersection.area / min(poly1.area, poly2.area)
                    if area_ratio > 0.001:  # 重叠比例超过0.1%
                        issues.append({
                            'type': '面重叠',
                            'area1_id': id1, 'area1_name': name1,
                            'area2_id': id2, 'area2_name': name2,
                            'overlap_area': round(intersection.area * 12321000000, 2),
                            'message': f'{name1}与{name2}存在重叠区域'
                        })

    conn.close()
    return jsonify({'issues': issues, 'total': len(issues)})
