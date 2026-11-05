"""
地质填图系统 - 主应用入口
Geological Mapping System - Main Application Entry
Flask REST API 服务器
"""

from flask import Flask, jsonify, send_from_directory
from flask_cors import CORS
from database import init_db
from config import HOST, PORT, DEBUG, UPLOAD_FOLDER, PHOTO_FOLDER, ATTACHMENT_FOLDER

app = Flask(__name__, static_folder='../frontend', static_url_path='')
CORS(app, resources={r"/*": {"origins": "*"}}, supports_credentials=True)

# 初始化数据库
init_db()

# 注册路由蓝图
from routes.projects import projects_bp
from routes.routes import routes_bp
from routes.points import points_bp
from routes.photos import photos_bp
from routes.samples import samples_bp
from routes.boundaries import boundaries_bp
from routes.faults import faults_bp
from routes.areas import areas_bp
from routes.sync import sync_bp
from routes.export import export_bp
from routes.symbols import symbols_bp
from routes.strata import strata_bp
from routes.navigation import navigation_bp

app.register_blueprint(projects_bp, url_prefix='/api/projects')
app.register_blueprint(routes_bp, url_prefix='/api/routes')
app.register_blueprint(points_bp, url_prefix='/api/points')
app.register_blueprint(photos_bp, url_prefix='/api/photos')
app.register_blueprint(samples_bp, url_prefix='/api/samples')
app.register_blueprint(boundaries_bp, url_prefix='/api/boundaries')
app.register_blueprint(faults_bp, url_prefix='/api/faults')
app.register_blueprint(areas_bp, url_prefix='/api/areas')
app.register_blueprint(sync_bp, url_prefix='/api/sync')
app.register_blueprint(export_bp, url_prefix='/api/export')
app.register_blueprint(symbols_bp, url_prefix='/api/symbols')
app.register_blueprint(strata_bp, url_prefix='/api/strata')
app.register_blueprint(navigation_bp, url_prefix='/api/navigation')

# 静态文件服务
@app.route('/')
def index():
    return send_from_directory('../frontend', 'index.html')

@app.route('/desktop')
@app.route('/desktop/')
def desktop():
    return send_from_directory('../frontend/desktop', 'index.html')

@app.route('/mobile/')
def mobile():
    return send_from_directory('../frontend/mobile', 'index.html')

@app.route('/<path:path>')
def static_files(path):
    return send_from_directory('../frontend', path)

# 健康检查
@app.route('/api/health')
def health():
    return jsonify({
        'status': 'ok',
        'service': '地质填图系统 API',
        'version': '1.0.0'
    })

# 获取系统配置
@app.route('/api/config')
def get_config():
    from config import SUPPORTED_CRS, POINT_TYPES, OCCURRENCE_TYPES, ROCK_TYPES, STRATIGRAPHIC_AGES, POINT_TYPE_SYMBOLS
    return jsonify({
        'supported_crs': SUPPORTED_CRS,
        'point_types': POINT_TYPES,
        'occurrence_types': OCCURRENCE_TYPES,
        'rock_types': ROCK_TYPES,
        'stratigraphic_ages': STRATIGRAPHIC_AGES,
        'point_type_symbols': POINT_TYPE_SYMBOLS
    })

@app.errorhandler(404)
def not_found(e):
    return jsonify({'error': '接口不存在'}), 404

@app.errorhandler(500)
def server_error(e):
    return jsonify({'error': '服务器内部错误'}), 500

if __name__ == '__main__':
    print("=" * 60)
    print("  地质填图系统 - Geological Mapping System")
    print("  API 服务器启动中...")
    print(f"  地址: http://{HOST}:{PORT}")
    print(f"  桌面端: http://localhost:{PORT}/desktop/")
    print(f"  移动端: http://localhost:{PORT}/mobile/")
    print("=" * 60)
    app.run(host=HOST, port=PORT, debug=DEBUG)
