"""
地质填图系统 - 地层单元管理模块
Stratum Unit Management Module
"""

from flask import Blueprint, request, jsonify
from database import get_db

strata_bp = Blueprint('strata', __name__)


@strata_bp.route('/project/<int:project_id>', methods=['GET'])
def list_strata(project_id):
    """获取项目地层单元列表"""
    conn = get_db()
    try:
        rows = conn.execute(
            '''SELECT * FROM stratum_units
               WHERE project_id = ? ORDER BY stratigraphic_age, code''',
            (project_id,)
        ).fetchall()
        return jsonify([dict(row) for row in rows])
    finally:
        conn.close()


@strata_bp.route('/<int:id>', methods=['GET'])
def get_stratum(id):
    """获取单个地层单元详情"""
    conn = get_db()
    try:
        row = conn.execute(
            'SELECT * FROM stratum_units WHERE id = ?', (id,)
        ).fetchone()
        if not row:
            return jsonify({'error': '地层单元不存在'}), 404
        return jsonify(dict(row))
    finally:
        conn.close()


@strata_bp.route('/', methods=['POST'])
def create_stratum():
    """创建地层单元"""
    data = request.get_json() or {}
    required = ['project_id', 'code', 'name']
    for field in required:
        if not data.get(field):
            return jsonify({'error': f'缺少必填字段: {field}'}), 400

    conn = get_db()
    try:
        cursor = conn.execute(
            '''INSERT INTO stratum_units
               (project_id, code, name, stratigraphic_age, lithology, description,
                color, fill_pattern, thickness_min, thickness_max, contact_type, remarks)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)''',
            (data['project_id'], data['code'], data['name'],
             data.get('stratigraphic_age', ''), data.get('lithology', ''),
             data.get('description', ''), data.get('color', '#808080'),
             data.get('fill_pattern', ''), data.get('thickness_min'),
             data.get('thickness_max'), data.get('contact_type', ''),
             data.get('remarks', ''))
        )
        conn.commit()
        return jsonify({'id': cursor.lastrowid, 'message': '地层单元创建成功'}), 201
    except Exception as e:
        return jsonify({'error': str(e)}), 400
    finally:
        conn.close()


@strata_bp.route('/<int:id>', methods=['PUT'])
def update_stratum(id):
    """更新地层单元"""
    data = request.get_json() or {}
    allowed = ['code', 'name', 'stratigraphic_age', 'lithology', 'description',
               'color', 'fill_pattern', 'thickness_min', 'thickness_max',
               'contact_type', 'remarks']
    
    updates = {k: data[k] for k in allowed if k in data}
    if not updates:
        return jsonify({'error': '没有提供更新字段'}), 400

    conn = get_db()
    try:
        set_clause = ', '.join(f'{k} = ?' for k in updates.keys())
        values = list(updates.values()) + [id]
        conn.execute(
            f'UPDATE stratum_units SET {set_clause} WHERE id = ?',
            values
        )
        conn.commit()
        return jsonify({'message': '地层单元更新成功'})
    except Exception as e:
        return jsonify({'error': str(e)}), 400
    finally:
        conn.close()


@strata_bp.route('/<int:id>', methods=['DELETE'])
def delete_stratum(id):
    """删除地层单元"""
    conn = get_db()
    try:
        conn.execute('DELETE FROM stratum_units WHERE id = ?', (id,))
        conn.commit()
        return jsonify({'message': '地层单元删除成功'})
    finally:
        conn.close()


@strata_bp.route('/project/<int:project_id>/summary', methods=['GET'])
def strata_summary(project_id):
    """获取项目地层统计摘要"""
    conn = get_db()
    try:
        rows = conn.execute(
            '''SELECT stratigraphic_age, COUNT(*) as count
               FROM stratum_units WHERE project_id = ?
               GROUP BY stratigraphic_age''',
            (project_id,)
        ).fetchall()
        return jsonify({
            'age_groups': [dict(row) for row in rows],
            'total': sum(r['count'] for r in rows)
        })
    finally:
        conn.close()
