"""
照片管理 API
"""

import os
import uuid
from datetime import datetime
from flask import Blueprint, request, jsonify
from werkzeug.utils import secure_filename
from database import get_db
from config import PHOTO_FOLDER, UPLOAD_FOLDER

photos_bp = Blueprint('photos', __name__)

ALLOWED_EXTENSIONS = {'png', 'jpg', 'jpeg', 'gif', 'bmp', 'tiff', 'tif'}

def allowed_file(filename):
    return '.' in filename and filename.rsplit('.', 1)[1].lower() in ALLOWED_EXTENSIONS

@photos_bp.route('/project/<int:project_id>', methods=['GET'])
def list_photos(project_id):
    """获取项目下所有照片"""
    point_id = request.args.get('point_id')
    route_id = request.args.get('route_id')

    conn = get_db()
    query = 'SELECT * FROM photos WHERE project_id = ?'
    params = [project_id]

    if point_id:
        query += ' AND point_id = ?'
        params.append(int(point_id))
    if route_id:
        query += ' AND route_id = ?'
        params.append(int(route_id))

    query += ' ORDER BY created_at DESC'
    photos = conn.execute(query, params).fetchall()
    conn.close()
    return jsonify([dict(p) for p in photos])

@photos_bp.route('/upload', methods=['POST'])
def upload_photo():
    """上传照片"""
    if 'file' not in request.files:
        return jsonify({'error': '未选择文件'}), 400

    file = request.files['file']
    if file.filename == '' or not allowed_file(file.filename):
        return jsonify({'error': '不支持的文件格式'}), 400

    # 生成唯一文件名
    ext = file.filename.rsplit('.', 1)[1].lower()
    filename = f"{datetime.now().strftime('%Y%m%d_%H%M%S')}_{uuid.uuid4().hex[:8]}.{ext}"

    # 按项目分文件夹
    project_id = request.form.get('project_id', 'default')
    project_folder = os.path.join(PHOTO_FOLDER, str(project_id))
    os.makedirs(project_folder, exist_ok=True)

    filepath = os.path.join(project_folder, filename)
    file.save(filepath)

    # 保存到数据库
    conn = get_db()
    cursor = conn.execute(
        '''INSERT INTO photos
           (point_id, route_id, project_id, filename, filepath, photo_type,
            latitude, longitude, elevation, direction, description, taken_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)''',
        (request.form.get('point_id'), request.form.get('route_id'),
         int(project_id) if project_id != 'default' else None,
         filename, filepath, request.form.get('photo_type', '现场照片'),
         request.form.get('latitude'), request.form.get('longitude'),
         request.form.get('elevation'), request.form.get('direction'),
         request.form.get('description', ''), request.form.get('taken_at'))
    )
    conn.commit()
    photo_id = cursor.lastrowid

    # 更新地质点的照片计数
    if request.form.get('point_id'):
        conn.execute(
            'UPDATE geological_points SET photo_count = '
            '(SELECT COUNT(*) FROM photos WHERE point_id = ?) '
            'WHERE id = ?',
            (int(request.form['point_id']), int(request.form['point_id']))
        )
        conn.commit()

    conn.close()
    return jsonify({
        'id': photo_id,
        'filename': filename,
        'filepath': filepath,
        'message': '照片上传成功'
    }), 201

@photos_bp.route('/<int:photo_id>', methods=['DELETE'])
def delete_photo(photo_id):
    """删除照片"""
    conn = get_db()
    photo = conn.execute('SELECT * FROM photos WHERE id = ?', (photo_id,)).fetchone()
    if not photo:
        conn.close()
        return jsonify({'error': '照片不存在'}), 404

    # 删除文件
    if os.path.exists(photo['filepath']):
        os.remove(photo['filepath'])

    # 更新关联点的照片计数
    if photo['point_id']:
        conn.execute(
            'UPDATE geological_points SET photo_count = '
            '(SELECT COUNT(*) FROM photos WHERE point_id = ?) WHERE id = ?',
            (photo['point_id'], photo['point_id'])
        )

    conn.execute('DELETE FROM photos WHERE id = ?', (photo_id,))
    conn.commit()
    conn.close()
    return jsonify({'message': '照片删除成功'})

@photos_bp.route('/<int:photo_id>/file', methods=['GET'])
def get_photo_file(photo_id):
    """获取照片文件"""
    from flask import send_file
    conn = get_db()
    photo = conn.execute('SELECT * FROM photos WHERE id = ?', (photo_id,)).fetchone()
    conn.close()
    if not photo or not os.path.exists(photo['filepath']):
        return jsonify({'error': '照片文件不存在'}), 404
    return send_file(photo['filepath'])
