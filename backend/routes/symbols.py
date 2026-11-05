"""
地质填图系统 - 符号库管理模块
Symbol Library Management Module
"""

from flask import Blueprint, request, jsonify
from database import get_db

symbols_bp = Blueprint('symbols', __name__)

# 内置专业地质符号 SVG 定义
BUILTIN_SYMBOLS = [
    # ===== 产状符号 (Attitude) =====
    {
        'name': '水平产状', 'symbol_type': 'attitude', 'category': 'structure',
        'svg_path': '<circle cx="12" cy="12" r="10" fill="none" stroke="{color}" stroke-width="1.5"/>',
        'description': '水平岩层产状符号'
    },
    {
        'name': '倾斜产状', 'symbol_type': 'attitude', 'category': 'structure',
        'svg_path': '<line x1="2" y1="22" x2="22" y2="2" stroke="{color}" stroke-width="2"/><text x="18" y="8" font-size="8" fill="{color}">30°</text>',
        'description': '倾斜岩层产状，箭头指向倾向，数字为倾角'
    },
    {
        'name': '直立产状', 'symbol_type': 'attitude', 'category': 'structure',
        'svg_path': '<line x1="12" y1="2" x2="12" y2="22" stroke="{color}" stroke-width="2"/>',
        'description': '直立岩层产状符号'
    },
    {
        'name': '倒转产状', 'symbol_type': 'attitude', 'category': 'structure',
        'svg_path': '<line x1="2" y1="22" x2="22" y2="2" stroke="{color}" stroke-width="2"/><polygon points="18,2 22,6 14,6" fill="{color}"/>',
        'description': '倒转岩层产状，箭头指向倒转方向'
    },
    # ===== 褶皱符号 (Fold) =====
    {
        'name': '背斜轴', 'symbol_type': 'fold', 'category': 'structure',
        'svg_path': '<path d="M2 18 Q12 2 22 18" fill="none" stroke="{color}" stroke-width="1.5"/><line x1="12" y1="2" x2="12" y2="8" stroke="{color}" stroke-width="1.5"/>',
        'description': '背斜轴迹符号，箭头指向核部'
    },
    {
        'name': '向斜轴', 'symbol_type': 'fold', 'category': 'structure',
        'svg_path': '<path d="M2 6 Q12 22 22 6" fill="none" stroke="{color}" stroke-width="1.5"/><line x1="12" y1="22" x2="12" y2="16" stroke="{color}" stroke-width="1.5"/>',
        'description': '向斜轴迹符号，箭头指向核部'
    },
    {
        'name': '倾伏背斜', 'symbol_type': 'fold', 'category': 'structure',
        'svg_path': '<path d="M2 18 Q12 2 22 18" fill="none" stroke="{color}" stroke-width="1.5"/><line x1="12" y1="2" x2="12" y2="8" stroke="{color}" stroke-width="1.5"/><polygon points="10,8 12,4 14,8" fill="{color}"/>',
        'description': '倾伏背斜，三角形指向倾伏方向'
    },
    {
        'name': '倾伏向斜', 'symbol_type': 'fold', 'category': 'structure',
        'svg_path': '<path d="M2 6 Q12 22 22 6" fill="none" stroke="{color}" stroke-width="1.5"/><line x1="12" y1="22" x2="12" y2="16" stroke="{color}" stroke-width="1.5"/><polygon points="10,16 12,20 14,16" fill="{color}"/>',
        'description': '倾伏向斜，三角形指向倾伏方向'
    },
    # ===== 断层符号 (Fault) =====
    {
        'name': '正断层', 'symbol_type': 'fault', 'category': 'fault',
        'svg_path': '<line x1="2" y1="12" x2="22" y2="12" stroke="{color}" stroke-width="2"/><line x1="8" y1="6" x2="8" y2="18" stroke="{color}" stroke-width="1.5"/><line x1="16" y1="6" x2="16" y2="18" stroke="{color}" stroke-width="1.5"/>',
        'description': '正断层符号，箭头表示下降盘'
    },
    {
        'name': '逆断层', 'symbol_type': 'fault', 'category': 'fault',
        'svg_path': '<line x1="2" y1="12" x2="22" y2="12" stroke="{color}" stroke-width="2"/><polygon points="6,12 10,6 10,18" fill="{color}"/><polygon points="18,12 14,6 14,18" fill="{color}"/>',
        'description': '逆断层符号，三角形指向上升盘'
    },
    {
        'name': '平移断层', 'symbol_type': 'fault', 'category': 'fault',
        'svg_path': '<line x1="2" y1="12" x2="22" y2="12" stroke="{color}" stroke-width="2"/><line x1="6" y1="8" x2="10" y2="12" stroke="{color}" stroke-width="1.5"/><line x1="14" y1="12" x2="18" y2="16" stroke="{color}" stroke-width="1.5"/>',
        'description': '平移断层符号，箭头表示运动方向'
    },
    {
        'name': '推覆构造', 'symbol_type': 'fault', 'category': 'fault',
        'svg_path': '<line x1="2" y1="12" x2="22" y2="12" stroke="{color}" stroke-width="2"/><polygon points="4,12 12,4 12,20" fill="{color}"/><polygon points="20,12 12,4 12,20" fill="none" stroke="{color}" stroke-width="1.5"/>',
        'description': '推覆构造/逆冲断层符号'
    },
    # ===== 矿点符号 (Mineral) =====
    {
        'name': '金属矿点', 'symbol_type': 'mineral', 'category': 'mineral',
        'svg_path': '<rect x="6" y="6" width="12" height="12" fill="none" stroke="{color}" stroke-width="1.5"/><line x1="6" y1="6" x2="18" y2="18" stroke="{color}" stroke-width="1"/><line x1="18" y1="6" x2="6" y2="18" stroke="{color}" stroke-width="1"/>',
        'description': '金属矿点符号'
    },
    {
        'name': '非金属矿点', 'symbol_type': 'mineral', 'category': 'mineral',
        'svg_path': '<circle cx="12" cy="12" r="8" fill="none" stroke="{color}" stroke-width="1.5"/><line x1="12" y1="4" x2="12" y2="20" stroke="{color}" stroke-width="1"/><line x1="4" y1="12" x2="20" y2="12" stroke="{color}" stroke-width="1"/>',
        'description': '非金属矿点符号'
    },
    {
        'name': '煤矿', 'symbol_type': 'mineral', 'category': 'mineral',
        'svg_path': '<rect x="4" y="8" width="16" height="12" fill="none" stroke="{color}" stroke-width="1.5"/><line x1="8" y1="8" x2="8" y2="4" stroke="{color}" stroke-width="1"/><line x1="16" y1="8" x2="16" y2="4" stroke="{color}" stroke-width="1"/>',
        'description': '煤矿符号'
    },
    # ===== 采样点符号 (Sample) =====
    {
        'name': '岩石样', 'symbol_type': 'sample', 'category': 'sample',
        'svg_path': '<polygon points="12,4 20,20 4,20" fill="none" stroke="{color}" stroke-width="1.5"/>',
        'description': '岩石样品采样点'
    },
    {
        'name': '土样', 'symbol_type': 'sample', 'category': 'sample',
        'svg_path': '<rect x="4" y="8" width="16" height="12" fill="none" stroke="{color}" stroke-width="1.5"/>',
        'description': '土壤样品采样点'
    },
    {
        'name': '水样', 'symbol_type': 'sample', 'category': 'sample',
        'svg_path': '<path d="M12 4 C12 4 4 12 4 16 C4 20.4 7.6 24 12 24 C16.4 24 20 20.4 20 16 C20 12 12 4 12 4 Z" fill="none" stroke="{color}" stroke-width="1.5" transform="scale(0.7) translate(5,2)"/>',
        'description': '水样品采样点'
    },
    # ===== 地质点符号 (Point) =====
    {
        'name': '地质观察点', 'symbol_type': 'point', 'category': 'point',
        'svg_path': '<circle cx="12" cy="12" r="6" fill="{color}" stroke="white" stroke-width="1"/>',
        'description': '一般地质观察点'
    },
    {
        'name': '构造点', 'symbol_type': 'point', 'category': 'point',
        'svg_path': '<polygon points="12,4 22,22 2,22" fill="{color}" stroke="white" stroke-width="1"/>',
        'description': '构造测量点'
    },
    {
        'name': '化石点', 'symbol_type': 'point', 'category': 'point',
        'svg_path': '<ellipse cx="12" cy="14" rx="8" ry="6" fill="none" stroke="{color}" stroke-width="1.5"/><path d="M6 14 Q12 4 18 14" fill="none" stroke="{color}" stroke-width="1"/>',
        'description': '化石产出点'
    },
    {
        'name': '泉点', 'symbol_type': 'point', 'category': 'point',
        'svg_path': '<circle cx="12" cy="16" r="6" fill="none" stroke="{color}" stroke-width="1.5"/><line x1="12" y1="4" x2="12" y2="10" stroke="{color}" stroke-width="1.5"/><line x1="9" y1="7" x2="12" y2="4" stroke="{color}" stroke-width="1.5"/><line x1="15" y1="7" x2="12" y2="4" stroke="{color}" stroke-width="1.5"/>',
        'description': '泉点/地下水露头'
    },
    # ===== 岩性花纹 (Pattern) =====
    {
        'name': '砂岩花纹', 'symbol_type': 'pattern', 'category': 'lithology',
        'svg_path': '<pattern id="sandstone" patternUnits="userSpaceOnUse" width="10" height="10"><circle cx="5" cy="5" r="2" fill="{color}"/><circle cx="2" cy="8" r="1.5" fill="{color}"/><circle cx="8" cy="2" r="1.5" fill="{color}"/></pattern>',
        'description': '砂岩岩性花纹'
    },
    {
        'name': '泥岩花纹', 'symbol_type': 'pattern', 'category': 'lithology',
        'svg_path': '<pattern id="mudstone" patternUnits="userSpaceOnUse" width="12" height="12"><line x1="0" y1="3" x2="12" y2="3" stroke="{color}" stroke-width="0.5"/><line x1="0" y1="9" x2="12" y2="9" stroke="{color}" stroke-width="0.5"/></pattern>',
        'description': '泥岩岩性花纹'
    },
    {
        'name': '灰岩花纹', 'symbol_type': 'pattern', 'category': 'lithology',
        'svg_path': '<pattern id="limestone" patternUnits="userSpaceOnUse" width="8" height="8"><circle cx="4" cy="4" r="2" fill="none" stroke="{color}" stroke-width="0.5"/><circle cx="0" cy="0" r="2" fill="none" stroke="{color}" stroke-width="0.5"/><circle cx="8" cy="8" r="2" fill="none" stroke="{color}" stroke-width="0.5"/></pattern>',
        'description': '灰岩岩性花纹'
    },
    {
        'name': '花岗岩花纹', 'symbol_type': 'pattern', 'category': 'lithology',
        'svg_path': '<pattern id="granite" patternUnits="userSpaceOnUse" width="10" height="10"><circle cx="3" cy="3" r="1.5" fill="{color}"/><circle cx="7" cy="7" r="1.5" fill="{color}"/><circle cx="7" cy="3" r="1" fill="{color}"/><circle cx="3" cy="7" r="1" fill="{color}"/></pattern>',
        'description': '花岗岩岩性花纹'
    },
]


@symbols_bp.route('/', methods=['GET'])
def list_symbols():
    """获取符号列表（支持按类别过滤）"""
    category = request.args.get('category', '')
    symbol_type = request.args.get('type', '')
    
    conn = get_db()
    try:
        query = 'SELECT * FROM symbol_library WHERE 1=1'
        params = []
        if category:
            query += ' AND category = ?'
            params.append(category)
        if symbol_type:
            query += ' AND symbol_type = ?'
            params.append(symbol_type)
        query += ' ORDER BY category, name'
        
        rows = conn.execute(query, params).fetchall()
        db_symbols = [dict(row) for row in rows]
        
        # 如果数据库为空，返回内置符号
        if not db_symbols:
            color = request.args.get('color', '#000000')
            return jsonify([{
                **s,
                'id': -(i + 1),  # 负ID表示内置符号
                'svg_path': s['svg_path'].replace('{color}', color)
            } for i, s in enumerate(BUILTIN_SYMBOLS)])
        
        return jsonify(db_symbols)
    finally:
        conn.close()


@symbols_bp.route('/init', methods=['POST'])
def init_symbols():
    """初始化内置符号到数据库"""
    conn = get_db()
    try:
        count = 0
        for symbol in BUILTIN_SYMBOLS:
            # 检查是否已存在
            existing = conn.execute(
                'SELECT id FROM symbol_library WHERE name = ? AND symbol_type = ?',
                (symbol['name'], symbol['symbol_type'])
            ).fetchone()
            if not existing:
                conn.execute(
                    '''INSERT INTO symbol_library (name, symbol_type, category, svg_path, description)
                       VALUES (?, ?, ?, ?, ?)''',
                    (symbol['name'], symbol['symbol_type'], symbol['category'],
                     symbol['svg_path'], symbol['description'])
                )
                count += 1
        conn.commit()
        return jsonify({'message': f'已初始化 {count} 个符号'})
    finally:
        conn.close()


@symbols_bp.route('/categories', methods=['GET'])
def list_categories():
    """获取符号分类列表"""
    conn = get_db()
    try:
        rows = conn.execute(
            'SELECT DISTINCT category FROM symbol_library ORDER BY category'
        ).fetchall()
        return jsonify([row['category'] for row in rows])
    finally:
        conn.close()
