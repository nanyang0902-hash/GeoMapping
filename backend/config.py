"""
地质填图系统 - 后端配置文件
Geological Mapping System - Backend Configuration
"""

import os

BASE_DIR = os.path.dirname(os.path.abspath(__file__))

# 数据库配置
DATABASE_PATH = os.path.join(BASE_DIR, 'data', 'geo_mapping.db')

# 文件存储路径
UPLOAD_FOLDER = os.path.join(BASE_DIR, 'data', 'uploads')
PHOTO_FOLDER = os.path.join(BASE_DIR, 'data', 'photos')
ATTACHMENT_FOLDER = os.path.join(BASE_DIR, 'data', 'attachments')
TILE_FOLDER = os.path.join(BASE_DIR, 'data', 'tiles')

# 服务器配置
HOST = '0.0.0.0'
PORT = 5050  # 前端请使用后端返回的 URL，不要硬编码端口
DEBUG = False

# 坐标系统支持
SUPPORTED_CRS = {
    'CGCS2000': 'EPSG:4490',   # CGCS2000 大地坐标系
    'WGS84': 'EPSG:4326',       # WGS84
    'CGCS2000_GK': 'EPSG:4547', # CGCS2000 / 3-degree Gauss-Kruger zone
    'WEB_MERCATOR': 'EPSG:3857' # Web Mercator (在线地图)
}

# 地质点类型
POINT_TYPES = [
    '地质观察点',   # Geological observation point
    '构造测量点',   # Structural measurement point
    '样品点',       # Sample point
    '照片点',       # Photo point
    '地貌点',       # Geomorphological point
    '水文点',       # Hydrological point
    '工程地质点',   # Engineering geological point
]

# 产状类型
OCCURRENCE_TYPES = [
    '层理',
    '片理',
    '节理',
    '断层',
    '褶皱轴面',
    '线理',
    '劈理',
]

# 岩石类型
ROCK_TYPES = [
    '沉积岩', '岩浆岩', '变质岩', '火山岩',
    '侵入岩', '喷出岩', '脉岩', '构造岩'
]

# 地层时代
STRATIGRAPHIC_AGES = [
    'Qh-全新统', 'Qp-更新统', 'N-新近系', 'E-古近系',
    'K-白垩系', 'J-侏罗系', 'T-三叠系', 'P-二叠系',
    'C-石炭系', 'D-泥盆系', 'S-志留系', 'O-奥陶系',
    'Є-寒武系', 'Z-震旦系', 'Pt-元古界', 'Ar-太古界'
]

# 点类型 → 默认符号名称映射（符号名=点类型名时无需配置，仅例外在此）
POINT_TYPE_SYMBOLS = {
    '地貌点': '地质观察点',  # 地貌点暂无专属符号，回退到地质观察点
}

# 高德地图 Web 服务 API Key
# 注册地址: https://console.amap.com/
# 请替换为你自己的 Key
AMAP_API_KEY = 'your_amap_key_here'

# 文件上传安全限制
MAX_UPLOAD_SIZE = 50 * 1024 * 1024   # 50MB
MAX_UPLOAD_FILES = 999                # 单次最多文件数（基本不限制）
