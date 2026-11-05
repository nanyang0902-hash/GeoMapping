"""
地质填图系统 - 数据库模块
Geological Mapping System - Database Module
使用SQLite存储空间数据和属性数据
"""

import sqlite3
import json
import os
from config import DATABASE_PATH, UPLOAD_FOLDER, PHOTO_FOLDER, ATTACHMENT_FOLDER

def get_db():
    """获取数据库连接"""
    conn = sqlite3.connect(DATABASE_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA foreign_keys=ON")
    return conn

def init_db():
    """初始化数据库表结构"""
    os.makedirs(os.path.dirname(DATABASE_PATH), exist_ok=True)
    os.makedirs(UPLOAD_FOLDER, exist_ok=True)
    os.makedirs(PHOTO_FOLDER, exist_ok=True)
    os.makedirs(ATTACHMENT_FOLDER, exist_ok=True)

    conn = get_db()
    cursor = conn.cursor()

    # 项目表
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS projects (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            description TEXT,
            region TEXT,
            crs TEXT DEFAULT 'EPSG:4326',
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    ''')

    # 野外路线表
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS field_routes (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            project_id INTEGER NOT NULL,
            name TEXT NOT NULL,
            route_date DATE,
            surveyor TEXT,
            description TEXT,
            weather TEXT,
            start_time TIMESTAMP,
            end_time TIMESTAMP,
            total_distance REAL,
            route_geom TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
        )
    ''')

    # 路线轨迹点表
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS route_trackpoints (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            route_id INTEGER NOT NULL,
            latitude REAL NOT NULL,
            longitude REAL NOT NULL,
            elevation REAL,
            accuracy REAL,
            speed REAL,
            bearing REAL,
            timestamp TIMESTAMP,
            FOREIGN KEY (route_id) REFERENCES field_routes(id) ON DELETE CASCADE
        )
    ''')

    # 地质点表（核心表）
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS geological_points (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            project_id INTEGER NOT NULL,
            route_id INTEGER,
            point_number TEXT NOT NULL,
            point_type TEXT NOT NULL,
            latitude REAL NOT NULL,
            longitude REAL NOT NULL,
            elevation REAL,
            accuracy REAL,
            location_method TEXT DEFAULT 'GPS',
            description TEXT,
            rock_type TEXT,
            stratum_age TEXT,
            stratum_name TEXT,
            occurrence_type TEXT,
            strike REAL,
            dip REAL,
            dip_direction REAL,
            sample_number TEXT,
            sample_type TEXT,
            photo_count INTEGER DEFAULT 0,
            sketch_path TEXT,
            is_checked INTEGER DEFAULT 0,
            is_corrected INTEGER DEFAULT 0,
            corrected_lat REAL,
            corrected_lon REAL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
            FOREIGN KEY (route_id) REFERENCES field_routes(id) ON DELETE SET NULL
        )
    ''')

    # 照片表
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS photos (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            point_id INTEGER,
            route_id INTEGER,
            project_id INTEGER NOT NULL,
            filename TEXT NOT NULL,
            filepath TEXT NOT NULL,
            photo_type TEXT,
            latitude REAL,
            longitude REAL,
            elevation REAL,
            direction REAL,
            description TEXT,
            taken_at TIMESTAMP,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (point_id) REFERENCES geological_points(id) ON DELETE SET NULL,
            FOREIGN KEY (route_id) REFERENCES field_routes(id) ON DELETE SET NULL,
            FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
        )
    ''')

    # 附件表
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS attachments (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            point_id INTEGER,
            route_id INTEGER,
            project_id INTEGER NOT NULL,
            filename TEXT NOT NULL,
            filepath TEXT NOT NULL,
            file_type TEXT,
            file_size INTEGER,
            description TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (point_id) REFERENCES geological_points(id) ON DELETE SET NULL,
            FOREIGN KEY (route_id) REFERENCES field_routes(id) ON DELETE SET NULL,
            FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
        )
    ''')

    # 样品台账表
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS sample_ledger (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            project_id INTEGER NOT NULL,
            sample_number TEXT UNIQUE NOT NULL,
            sample_type TEXT,
            point_id INTEGER,
            latitude REAL,
            longitude REAL,
            elevation REAL,
            rock_type TEXT,
            stratum_age TEXT,
            description TEXT,
            collection_date DATE,
            collector TEXT,
            storage_location TEXT,
            is_analyzed INTEGER DEFAULT 0,
            analysis_result TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
            FOREIGN KEY (point_id) REFERENCES geological_points(id) ON DELETE SET NULL
        )
    ''')

    # 地质界线表
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS geological_boundaries (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            project_id INTEGER NOT NULL,
            name TEXT NOT NULL,
            boundary_type TEXT,
            description TEXT,
            geom_wkt TEXT,
            left_unit TEXT,
            right_unit TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
        )
    ''')

    # 断层表
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS faults (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            project_id INTEGER NOT NULL,
            name TEXT NOT NULL,
            fault_type TEXT,
            dip REAL,
            dip_direction REAL,
            throw REAL,
            description TEXT,
            geom_wkt TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
        )
    ''')

    # 地层面表
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS geological_areas (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            project_id INTEGER NOT NULL,
            name TEXT NOT NULL,
            area_type TEXT,
            rock_type TEXT,
            stratum_age TEXT,
            description TEXT,
            fill_pattern TEXT,
            fill_color TEXT,
            geom_wkt TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
        )
    ''')

    # 数据版本表
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS data_versions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            project_id INTEGER NOT NULL,
            table_name TEXT NOT NULL,
            record_id INTEGER NOT NULL,
            change_type TEXT,
            old_data TEXT,
            new_data TEXT,
            changed_by TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
        )
    ''')

    # 符号库表
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS symbol_library (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            symbol_type TEXT,
            category TEXT,
            svg_path TEXT,
            description TEXT
        )
    ''')

    # 地层单元表
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS stratum_units (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            project_id INTEGER NOT NULL,
            code TEXT NOT NULL,
            name TEXT NOT NULL,
            stratigraphic_age TEXT,
            lithology TEXT,
            description TEXT,
            color TEXT DEFAULT '#808080',
            fill_pattern TEXT,
            thickness_min REAL,
            thickness_max REAL,
            contact_type TEXT,
            remarks TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
        )
    ''')

    conn.commit()
    conn.close()

    # 数据库迁移 — symbol 字段
    _migrate_add_symbol()

    # 数据库迁移 — 修复 point_number 唯一约束
    _migrate_fix_point_number_constraint()

    # 数据库迁移 — 添加 route_trackpoints.sequence 字段
    _migrate_add_sequence_column()

    print("数据库初始化完成！")

def _migrate_add_symbol():
    """迁移：为 geological_points 表添加 symbol 字段（幂等）"""
    conn = get_db()
    try:
        conn.execute("ALTER TABLE geological_points ADD COLUMN symbol TEXT DEFAULT NULL")
        conn.commit()
        print("数据库迁移: 已添加 geological_points.symbol 字段")
    except Exception:
        pass  # 字段已存在
    finally:
        conn.close()


def _migrate_fix_point_number_constraint():
    """迁移：将 point_number 的单独 UNIQUE 约束改为 (project_id, point_number) 组合唯一约束"""
    conn = get_db()
    try:
        conn.execute("PRAGMA foreign_keys=OFF")

        # 检查是否已有组合唯一约束
        cursor = conn.execute(
            "SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='geological_points' AND name='idx_project_point_number'"
        )
        if cursor.fetchone():
            conn.execute("PRAGMA foreign_keys=ON")
            return

        # 检查 point_number 是否有单独 UNIQUE 约束
        single_unique_idx = None
        for row in conn.execute("PRAGMA index_list('geological_points')").fetchall():
            if row['origin'] == 'u':
                info = conn.execute("PRAGMA index_info('{}')".format(row['name'])).fetchall()
                cols = [r['name'] for r in info]
                if cols == ['point_number']:
                    single_unique_idx = row['name']
                    break

        if not single_unique_idx:
            # 没有单独 UNIQUE，只需创建组合唯一索引
            conn.execute(
                'CREATE UNIQUE INDEX IF NOT EXISTS idx_project_point_number ON geological_points(project_id, point_number)'
            )
            conn.commit()
            print("数据库迁移: 已创建 (project_id, point_number) 组合唯一索引")
            conn.execute("PRAGMA foreign_keys=ON")
            return

        # 有单独 UNIQUE，需要完整迁移（重命名旧表 → 创建新表 → 复制数据 → 删除旧表）
        conn.execute("ALTER TABLE geological_points RENAME TO geological_points_old")

        # 获取旧表列名，确保 INSERT 列对齐
        cols = [r['name'] for r in conn.execute("PRAGMA table_info('geological_points_old')").fetchall()]
        col_str = ', '.join(cols)

        conn.execute('''
            CREATE TABLE geological_points (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                project_id INTEGER NOT NULL,
                route_id INTEGER,
                point_number TEXT NOT NULL,
                point_type TEXT NOT NULL,
                latitude REAL NOT NULL,
                longitude REAL NOT NULL,
                elevation REAL,
                accuracy REAL,
                location_method TEXT DEFAULT 'GPS',
                description TEXT,
                rock_type TEXT,
                stratum_age TEXT,
                stratum_name TEXT,
                occurrence_type TEXT,
                strike REAL,
                dip REAL,
                dip_direction REAL,
                sample_number TEXT,
                sample_type TEXT,
                photo_count INTEGER DEFAULT 0,
                sketch_path TEXT,
                is_checked INTEGER DEFAULT 0,
                is_corrected INTEGER DEFAULT 0,
                corrected_lat REAL,
                corrected_lon REAL,
                symbol TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
                FOREIGN KEY (route_id) REFERENCES field_routes(id) ON DELETE SET NULL,
                UNIQUE (project_id, point_number)
            )
        ''')
        conn.execute('INSERT INTO geological_points ({0}) SELECT {0} FROM geological_points_old'.format(col_str))
        conn.execute('DROP TABLE geological_points_old')
        conn.execute("PRAGMA foreign_keys=ON")
        conn.commit()
        print("数据库迁移: 已修复 point_number 唯一约束为 (project_id, point_number)")
    except Exception as e:
        print("数据库迁移 (point_number 约束) 警告: {}".format(e))
        conn.execute("PRAGMA foreign_keys=ON")
    finally:
        conn.close()


def _migrate_add_sequence_column():
    """迁移：为 route_trackpoints 表添加 sequence 字段"""
    conn = get_db()
    try:
        conn.execute("ALTER TABLE route_trackpoints ADD COLUMN sequence INTEGER DEFAULT 0")
        conn.commit()
        print("数据库迁移: 已添加 route_trackpoints.sequence 字段")
    except Exception:
        pass  # 字段已存在
    finally:
        conn.close()


if __name__ == '__main__':
    init_db()
