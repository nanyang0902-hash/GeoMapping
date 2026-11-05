"""
样品台账管理 API
"""

from flask import Blueprint, request, jsonify
from database import get_db

samples_bp = Blueprint('samples', __name__)

@samples_bp.route('/project/<int:project_id>', methods=['GET'])
def list_samples(project_id):
    """获取项目样品台账"""
    sample_type = request.args.get('type')

    conn = get_db()
    query = 'SELECT * FROM sample_ledger WHERE project_id = ?'
    params = [project_id]

    if sample_type:
        query += ' AND sample_type = ?'
        params.append(sample_type)

    query += ' ORDER BY collection_date DESC'
    samples = conn.execute(query, params).fetchall()
    conn.close()
    return jsonify([dict(s) for s in samples])

@samples_bp.route('/<int:sample_id>', methods=['GET'])
def get_sample(sample_id):
    """获取单个样品详情"""
    conn = get_db()
    sample = conn.execute(
        'SELECT * FROM sample_ledger WHERE id = ?', (sample_id,)
    ).fetchone()
    conn.close()
    if not sample:
        return jsonify({'error': '样品不存在'}), 404
    return jsonify(dict(sample))

@samples_bp.route('/', methods=['POST'])
def create_sample():
    """创建样品记录"""
    data = request.json
    conn = get_db()

    existing = conn.execute(
        'SELECT id FROM sample_ledger WHERE sample_number = ?',
        (data['sample_number'],)
    ).fetchone()
    if existing:
        conn.close()
        return jsonify({'error': '样品编号已存在'}), 409

    cursor = conn.execute(
        '''INSERT INTO sample_ledger
           (project_id, sample_number, sample_type, point_id, latitude, longitude,
            elevation, rock_type, stratum_age, description, collection_date,
            collector, storage_location)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)''',
        (data['project_id'], data['sample_number'], data.get('sample_type', ''),
         data.get('point_id'), data.get('latitude'), data.get('longitude'),
         data.get('elevation'), data.get('rock_type', ''), data.get('stratum_age', ''),
         data.get('description', ''), data.get('collection_date'),
         data.get('collector', ''), data.get('storage_location', ''))
    )
    conn.commit()
    sample_id = cursor.lastrowid
    conn.close()
    return jsonify({'id': sample_id, 'message': '样品创建成功'}), 201

@samples_bp.route('/<int:sample_id>', methods=['PUT'])
def update_sample(sample_id):
    """更新样品信息"""
    data = request.json
    conn = get_db()
    conn.execute(
        '''UPDATE sample_ledger SET
           sample_type=?, rock_type=?, stratum_age=?, description=?,
           storage_location=?, is_analyzed=?, analysis_result=?
           WHERE id=?''',
        (data.get('sample_type'), data.get('rock_type'), data.get('stratum_age'),
         data.get('description'), data.get('storage_location'),
         data.get('is_analyzed', 0), data.get('analysis_result', ''),
         sample_id)
    )
    conn.commit()
    conn.close()
    return jsonify({'message': '样品更新成功'})

@samples_bp.route('/<int:sample_id>', methods=['DELETE'])
def delete_sample(sample_id):
    """删除样品"""
    conn = get_db()
    conn.execute('DELETE FROM sample_ledger WHERE id = ?', (sample_id,))
    conn.commit()
    conn.close()
    return jsonify({'message': '样品删除成功'})

@samples_bp.route('/export', methods=['GET'])
def export_samples():
    """导出样品台账（返回CSV兼容数据）"""
    project_id = request.args.get('project_id')
    conn = get_db()

    if project_id:
        samples = conn.execute(
            'SELECT * FROM sample_ledger WHERE project_id = ? ORDER BY sample_number',
            (project_id,)
        ).fetchall()
    else:
        samples = conn.execute(
            'SELECT * FROM sample_ledger ORDER BY sample_number'
        ).fetchall()

    conn.close()
    return jsonify({
        'headers': ['样品编号', '样品类型', '岩石类型', '地层时代', '纬度', '经度',
                    '高程', '描述', '采集日期', '采集人', '存放位置', '是否分析'],
        'data': [[s['sample_number'], s['sample_type'], s['rock_type'],
                  s['stratum_age'], s['latitude'], s['longitude'],
                  s['elevation'], s['description'], s['collection_date'],
                  s['collector'], s['storage_location'],
                  '是' if s['is_analyzed'] else '否']
                 for s in samples]
    })
