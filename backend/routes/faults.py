"""
断层管理 API
"""

from flask import Blueprint, request, jsonify
from database import get_db

faults_bp = Blueprint('faults', __name__)

@faults_bp.route('/<int:fault_id>', methods=['GET'])
def get_fault(fault_id):
    """获取单条断层"""
    conn = get_db()
    fault = conn.execute(
        'SELECT * FROM faults WHERE id = ?', (fault_id,)
    ).fetchone()
    conn.close()
    if not fault:
        return jsonify({'error': '断层不存在'}), 404
    return jsonify(dict(fault))

@faults_bp.route('/project/<int:project_id>', methods=['GET'])
def list_faults(project_id):
    """获取项目下所有断层"""
    conn = get_db()
    faults = conn.execute(
        'SELECT * FROM faults WHERE project_id = ?', (project_id,)
    ).fetchall()
    conn.close()
    return jsonify([dict(f) for f in faults])

@faults_bp.route('/', methods=['POST'])
def create_fault():
    """创建断层"""
    data = request.json
    conn = get_db()
    cursor = conn.execute(
        '''INSERT INTO faults
           (project_id, name, fault_type, dip, dip_direction, throw, description, geom_wkt)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)''',
        (data['project_id'], data['name'], data.get('fault_type', ''),
         data.get('dip'), data.get('dip_direction'), data.get('throw'),
         data.get('description', ''), data.get('geom_wkt', ''))
    )
    conn.commit()
    fault_id = cursor.lastrowid
    conn.close()
    return jsonify({'id': fault_id, 'message': '断层创建成功'}), 201

@faults_bp.route('/<int:fault_id>', methods=['PUT'])
def update_fault(fault_id):
    """更新断层"""
    data = request.json
    conn = get_db()
    conn.execute(
        '''UPDATE faults SET name=?, fault_type=?, dip=?, dip_direction=?,
           throw=?, description=?, geom_wkt=? WHERE id=?''',
        (data.get('name'), data.get('fault_type'), data.get('dip'),
         data.get('dip_direction'), data.get('throw'), data.get('description'),
         data.get('geom_wkt'), fault_id)
    )
    conn.commit()
    conn.close()
    return jsonify({'message': '断层更新成功'})

@faults_bp.route('/<int:fault_id>', methods=['DELETE'])
def delete_fault(fault_id):
    """删除断层"""
    conn = get_db()
    conn.execute('DELETE FROM faults WHERE id = ?', (fault_id,))
    conn.commit()
    conn.close()
    return jsonify({'message': '断层删除成功'})
