"""
地质点采集管理 API
"""

from flask import Blueprint, request, jsonify
from database import get_db

points_bp = Blueprint('points', __name__)

@points_bp.route('/project/<int:project_id>', methods=['GET'])
def list_points(project_id):
    """获取项目下所有地质点（支持筛选）"""
    point_type = request.args.get('type')
    route_id = request.args.get('route_id')
    is_checked = request.args.get('is_checked')

    conn = get_db()
    query = 'SELECT * FROM geological_points WHERE project_id = ?'
    params = [project_id]

    if point_type:
        query += ' AND point_type = ?'
        params.append(point_type)
    if route_id:
        query += ' AND route_id = ?'
        params.append(int(route_id))
    if is_checked is not None:
        query += ' AND is_checked = ?'
        params.append(int(is_checked))

    query += ' ORDER BY created_at DESC'
    points = conn.execute(query, params).fetchall()
    conn.close()
    return jsonify([dict(p) for p in points])

@points_bp.route('/<int:point_id>', methods=['GET'])
def get_point(point_id):
    """获取单个地质点详情"""
    conn = get_db()
    point = conn.execute(
        'SELECT * FROM geological_points WHERE id = ?', (point_id,)
    ).fetchone()
    if not point:
        conn.close()
        return jsonify({'error': '地质点不存在'}), 404

    # 获取关联的照片
    photos = conn.execute(
        'SELECT * FROM photos WHERE point_id = ?', (point_id,)
    ).fetchall()

    # 获取关联的附件
    attachments = conn.execute(
        'SELECT * FROM attachments WHERE point_id = ?', (point_id,)
    ).fetchall()

    conn.close()
    return jsonify({
        **dict(point),
        'photos': [dict(p) for p in photos],
        'attachments': [dict(a) for a in attachments]
    })

@points_bp.route('/', methods=['POST'])
def create_point():
    """创建新地质点"""
    data = request.json
    conn = get_db()

    # 验证必填字段
    if not data.get('point_number'):
        return jsonify({'error': '点编号不能为空'}), 400
    if not data.get('point_type'):
        return jsonify({'error': '点类型不能为空'}), 400
    if not data.get('latitude') or not data.get('longitude'):
        return jsonify({'error': '坐标不能为空'}), 400

    # 检查编号唯一性
    existing = conn.execute(
        'SELECT id FROM geological_points WHERE point_number = ?',
        (data['point_number'],)
    ).fetchone()
    if existing:
        conn.close()
        return jsonify({'error': '点编号已存在'}), 409

    cursor = conn.execute(
        '''INSERT INTO geological_points
           (project_id, route_id, point_number, point_type, latitude, longitude,
            elevation, accuracy, location_method, description, rock_type,
            stratum_age, stratum_name, occurrence_type, strike, dip, dip_direction,
            sample_number, sample_type, sketch_path, symbol,
            is_corrected, corrected_lat, corrected_lon)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)''',
        (data['project_id'], data.get('route_id'), data['point_number'],
         data['point_type'], data['latitude'], data['longitude'],
         data.get('elevation'), data.get('accuracy'), data.get('location_method', 'GPS'),
         data.get('description', ''), data.get('rock_type', ''),
         data.get('stratum_age', ''), data.get('stratum_name', ''),
         data.get('occurrence_type', ''), data.get('strike'), data.get('dip'),
         data.get('dip_direction'), data.get('sample_number', ''),
         data.get('sample_type', ''), data.get('sketch_path', ''),
         data.get('symbol', None),
         data.get('is_corrected', 0), data.get('corrected_lat'), data.get('corrected_lon'))
    )
    conn.commit()
    point_id = cursor.lastrowid

    # 如果有样品信息，自动创建样品台账记录
    if data.get('sample_number'):
        conn.execute(
            '''INSERT INTO sample_ledger
               (project_id, sample_number, sample_type, point_id, latitude, longitude,
                elevation, rock_type, stratum_age, description, collection_date, collector)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)''',
            (data['project_id'], data['sample_number'], data.get('sample_type', ''),
             point_id, data['latitude'], data['longitude'],
             data.get('elevation'), data.get('rock_type', ''),
             data.get('stratum_age', ''), data.get('description', ''),
             data.get('route_date'), data.get('surveyor', ''))
        )

    conn.commit()
    conn.close()
    return jsonify({'id': point_id, 'message': '地质点创建成功'}), 201

@points_bp.route('/<int:point_id>', methods=['PUT'])
def update_point(point_id):
    """更新地质点信息"""
    data = request.json
    conn = get_db()

    conn.execute(
        '''UPDATE geological_points SET
           point_type=?, latitude=?, longitude=?, elevation=?, accuracy=?,
           location_method=?, description=?, rock_type=?, stratum_age=?,
           stratum_name=?, occurrence_type=?, strike=?, dip=?, dip_direction=?,
           sample_number=?, sample_type=?, sketch_path=?, symbol=?,
           is_corrected=?, corrected_lat=?, corrected_lon=?,
           updated_at=CURRENT_TIMESTAMP
           WHERE id=?''',
        (data.get('point_type'), data.get('latitude'), data.get('longitude'),
         data.get('elevation'), data.get('accuracy'),
         data.get('location_method', 'GPS'), data.get('description', ''),
         data.get('rock_type', ''), data.get('stratum_age', ''),
         data.get('stratum_name', ''), data.get('occurrence_type', ''),
         data.get('strike'), data.get('dip'), data.get('dip_direction'),
         data.get('sample_number', ''), data.get('sample_type', ''),
         data.get('sketch_path', ''), data.get('symbol', None),
         data.get('is_corrected', 0),
         data.get('corrected_lat'), data.get('corrected_lon'),
         point_id)
    )
    conn.commit()
    conn.close()
    return jsonify({'message': '地质点更新成功'})

@points_bp.route('/<int:point_id>', methods=['DELETE'])
def delete_point(point_id):
    """删除地质点"""
    conn = get_db()
    conn.execute('DELETE FROM geological_points WHERE id = ?', (point_id,))
    conn.commit()
    conn.close()
    return jsonify({'message': '地质点删除成功'})

@points_bp.route('/<int:point_id>/check', methods=['POST'])
def check_point(point_id):
    """审核地质点（标记已检查）"""
    data = request.json
    conn = get_db()
    conn.execute(
        'UPDATE geological_points SET is_checked = ? WHERE id = ?',
        (data.get('is_checked', 1), point_id)
    )
    conn.commit()
    conn.close()
    return jsonify({'message': '审核状态更新成功'})

@points_bp.route('/batch', methods=['POST'])
def batch_update():
    """批量更新地质点"""
    data = request.json
    point_ids = data.get('ids', [])
    updates = data.get('updates', {})

    if not point_ids or not updates:
        return jsonify({'error': '参数不完整'}), 400

    conn = get_db()
    set_clause = ', '.join([f'{k}=?' for k in updates.keys()])
    params = list(updates.values()) + point_ids
    placeholders = ','.join(['?' for _ in point_ids])

    conn.execute(
        f'UPDATE geological_points SET {set_clause} WHERE id IN ({placeholders})',
        params
    )
    conn.commit()
    conn.close()
    return jsonify({'message': f'成功更新 {len(point_ids)} 个地质点'})

@points_bp.route('/next-number', methods=['GET'])
def get_next_number():
    """获取下一个可用编号"""
    project_id = request.args.get('project_id')
    prefix = request.args.get('prefix', 'D')

    conn = get_db()
    if project_id:
        result = conn.execute(
            '''SELECT point_number FROM geological_points
               WHERE project_id = ? AND point_number LIKE ?
               ORDER BY point_number DESC LIMIT 1''',
            (project_id, f'{prefix}%')
        ).fetchone()
    else:
        result = conn.execute(
            "SELECT point_number FROM geological_points WHERE point_number LIKE ? "
            "ORDER BY point_number DESC LIMIT 1", (f'{prefix}%',)
        ).fetchone()

    conn.close()

    if result:
        try:
            num = int(result[0][len(prefix):])
            next_num = num + 1
        except ValueError:
            next_num = 1
    else:
        next_num = 1

    return jsonify({'next_number': f'{prefix}{next_num:04d}'})
