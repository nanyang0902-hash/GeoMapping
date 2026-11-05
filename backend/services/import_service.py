"""
多格式数据导入服务
支持: Shapefile (.shp)、GeoJSON、CSV、KML、GPX
"""
import os
import json
import csv
import tempfile
import zipfile
import xml.etree.ElementTree as ET
from io import StringIO

from config import MAX_UPLOAD_SIZE, MAX_UPLOAD_FILES

# ── CSV 智能列别名 ──────────────────────────────────────────
LAT_ALIASES = {'latitude', 'lat', 'y', '纬度', 'Y坐标'}
LNG_ALIASES = {'longitude', 'lng', 'lon', 'x', '经度', 'X坐标'}
NAME_ALIASES = {'name', '名称', '编号', 'id', 'number', 'point_number'}
TYPE_ALIASES = {'type', '类型', 'point_type', 'category'}

# ── 格式检测 ────────────────────────────────────────────────

def detect_format(files):
    """根据文件扩展名检测导入格式"""
    def _get_filename(f):
        """安全获取文件名，处理空字符串和None"""
        fname = getattr(f, 'filename', None)
        if fname and str(fname).strip():
            return str(fname).strip()
        # 尝试其他属性
        for attr in ['name', 'raw_filename', 'file_name']:
            val = getattr(f, attr, None)
            if val and str(val).strip():
                return str(val).strip()
        return ''

    exts = set()
    for f in files:
        fname = _get_filename(f)
        if fname:
            ext = os.path.splitext(fname)[1].lower()
            if ext:
                exts.add(ext)
    
    if '.shp' in exts or '.dbf' in exts:
        return 'shapefile'
    if '.geojson' in exts or '.json' in exts:
        return 'geojson'
    if '.csv' in exts:
        return 'csv'
    if '.kml' in exts or '.kmz' in exts:
        return 'kml'
    if '.gpx' in exts:
        return 'gpx'
    
    # fallback: 逐个检查文件名后缀
    for f in files:
        fname = _get_filename(f).lower()
        if fname.endswith('.shp') or fname.endswith('.dbf'):
            return 'shapefile'
        if fname.endswith('.geojson') or fname.endswith('.json'):
            return 'geojson'
        if fname.endswith('.csv'):
            return 'csv'
        if fname.endswith('.kml') or fname.endswith('.kmz'):
            return 'kml'
        if fname.endswith('.gpx'):
            return 'gpx'
    
    return 'unknown'

# ── 解析器 ──────────────────────────────────────────────────

def parse_shapefile(files, tmpdir=None):
    """解析 Shapefile（从 multipart 文件或临时目录）"""
    try:
        import shapefile as pyshp
    except ImportError:
        raise ImportError('需要安装 pyshp: pip install pyshp')

    own_tmpdir = None
    if tmpdir is None:
        own_tmpdir = tempfile.mkdtemp()
        tmpdir = own_tmpdir

    try:
        # 文件已由 sync.py 保存到 tmpdir，这里不再重复保存
        shp_files = []
        for root, dirs, fs in os.walk(tmpdir):
            for name in fs:
                if name.lower().endswith('.shp'):
                    shp_files.append(os.path.join(root, name))

        if not shp_files:
            raise ValueError('未找到 .shp 文件')

        all_points, all_lines, all_polygons = [], [], []

        for shp_file in shp_files:
            try:
                reader = pyshp.Reader(shp_file)
            except Exception as e:
                raise ValueError('无法打开 Shapefile {}: {}'.format(shp_file, str(e)))
            
            # 兼容 pyshp 1.x 和 2.x 的 fields 格式
            try:
                fields = [f[0] for f in reader.fields[1:]]
            except Exception:
                fields = []

            # 兼容不同版本的 iterShapeRecords / iterRecords / shapeRecords
            records = []
            try:
                if hasattr(reader, 'iterShapeRecords'):
                    records = list(reader.iterShapeRecords())
                elif hasattr(reader, 'shapeRecords'):
                    records = reader.shapeRecords()
                elif hasattr(reader, 'iterRecords') and hasattr(reader, 'iterShapes'):
                    recs = list(reader.iterRecords())
                    shapes = list(reader.iterShapes())
                    records = list(zip(recs, shapes))
            except Exception as e:
                reader.close()
                raise ValueError('读取 Shapefile 记录失败: {}'.format(str(e)))

            for idx, rec in enumerate(records):
                try:
                    # 兼容 pyshp 1.x (ShapeRecord 对象) 和 2.x (namedtuple 或 tuple)
                    if hasattr(rec, 'record') and hasattr(rec, 'shape'):
                        props = dict(zip(fields, rec.record))
                        geom = rec.shape
                    elif isinstance(rec, tuple) and len(rec) >= 2:
                        props = dict(zip(fields, rec[0]))
                        geom = rec[1]
                    else:
                        continue
                    
                    # 安全获取 shapeTypeName / shapeType
                    shape_type_name = None
                    shape_type_code = None
                    if hasattr(geom, 'shapeTypeName'):
                        shape_type_name = geom.shapeTypeName
                    if hasattr(geom, 'shapeType'):
                        shape_type_code = geom.shapeType
                    
                    # 通过 shapeType 编码判断类型（更兼容）
                    is_point = shape_type_name in ('POINT', 'POINTZ', 'POINTM', 'MULTIPOINT', 'MULTIPOINTZ', 'MULTIPOINTM') or (shape_type_code in (1, 11, 21, 8, 18, 28))
                    is_polyline = shape_type_name in ('POLYLINE', 'POLYLINEZ', 'POLYLINEM', 'MULTIPATCH') or (shape_type_code in (3, 13, 23, 31))
                    is_polygon = shape_type_name in ('POLYGON', 'POLYGONZ', 'POLYGONM') or (shape_type_code in (5, 15, 25))
                    
                    if is_point:
                        pt = _map_shp_point(props, geom, shp_file, idx)
                        all_points.append(pt)
                    elif is_polyline:
                        wkt = _geom_to_wkt_linestring(geom)
                        name = _extract_name(props, shp_file)
                        all_lines.append({'name': name, 'geom_wkt': wkt, 'props': props})
                    elif is_polygon:
                        wkt = _geom_to_wkt_polygon(geom)
                        name = _extract_name(props, shp_file)
                        all_polygons.append({'name': name, 'geom_wkt': wkt, 'props': props})
                    elif shape_type_name == 'NULL' or shape_type_code == 0:
                        # 跳过空几何
                        pass
                    else:
                        # 未知类型，尝试通过 points 判断
                        if hasattr(geom, 'points') and len(geom.points) == 1:
                            pt = _map_shp_point(props, geom, shp_file, idx)
                            all_points.append(pt)
                        elif hasattr(geom, 'points') and len(geom.points) > 1:
                            if geom.points[0] == geom.points[-1]:
                                wkt = _geom_to_wkt_polygon(geom)
                                all_polygons.append({'name': _extract_name(props, shp_file), 'geom_wkt': wkt, 'props': props})
                            else:
                                wkt = _geom_to_wkt_linestring(geom)
                                all_lines.append({'name': _extract_name(props, shp_file), 'geom_wkt': wkt, 'props': props})
                except Exception as e:
                    # 单条记录失败不中断整个导入
                    print('Shapefile 记录 {} 解析失败: {}'.format(idx, str(e)))
                    continue

            reader.close()

        return {
            'points': all_points,
            'lines': all_lines,
            'polygons': all_polygons,
            'format': 'shapefile'
        }
    finally:
        if own_tmpdir:
            import shutil
            shutil.rmtree(own_tmpdir, ignore_errors=True)


def parse_geojson(file):
    """解析 GeoJSON 文件 → [{lat, lng, props}], [{geom_wkt, props}]"""
    data = json.loads(file.read())
    features = data.get('features', [data] if data.get('type') else [])

    points, lines, polygons = [], [], []
    for feat in features:
        geom = feat.get('geometry', {})
        coords = geom.get('coordinates', [])
        props = feat.get('properties', {})

        if geom.get('type') == 'Point':
            points.append({
                'longitude': coords[0], 'latitude': coords[1],
                'point_type': _find_prop(props, TYPE_ALIASES, '地质观察点'),
                'point_number': _find_prop(props, NAME_ALIASES, ''),
                'elevation': coords[2] if len(coords) > 2 else props.get('elevation'),
                'description': props.get('description', props.get('描述', '')),
            })

        elif geom.get('type') == 'LineString':
            wkt = 'LINESTRING({})'.format(
                ', '.join('{} {}'.format(c[0], c[1]) for c in coords))
            lines.append({
                'name': _find_prop(props, NAME_ALIASES, '线要素'),
                'geom_wkt': wkt, 'props': props
            })

        elif geom.get('type') == 'Polygon':
            ring = ', '.join('{} {}'.format(c[0], c[1]) for c in coords[0])
            wkt = 'POLYGON(({}))'.format(ring)
            polygons.append({
                'name': _find_prop(props, NAME_ALIASES, '面要素'),
                'geom_wkt': wkt, 'props': props
            })

    return {'points': points, 'lines': lines, 'polygons': polygons, 'format': 'geojson'}


def parse_csv(file):
    """解析 CSV 文件 — 智能列映射"""
    # 尝试检测编码
    text = file.read()
    try:
        text = text.decode('utf-8')
    except (UnicodeDecodeError, AttributeError):
        try:
            text = text.decode('gbk')
        except Exception:
            text = text.decode('utf-8', errors='replace')

    reader = csv.DictReader(StringIO(text))
    if not reader.fieldnames:
        raise ValueError('CSV 无表头行')

    # 智能列映射
    col_map = _detect_csv_columns(reader.fieldnames)
    if not col_map['lat'] or not col_map['lng']:
        raise ValueError(
            '无法识别经纬度列。可用列: {}。请确保包含 latitude/lat/纬度 和 longitude/lng/经度 列。'
            .format(', '.join(reader.fieldnames))
        )

    points = []
    for row in reader:
        try:
            lat = float(row[col_map['lat']])
            lng = float(row[col_map['lng']])
        except (ValueError, TypeError):
            continue

        points.append({
            'longitude': lng,
            'latitude': lat,
            'point_type': _find_csv_prop(row, col_map, 'type', '地质观察点'),
            'point_number': _find_csv_prop(row, col_map, 'name', ''),
            'elevation': _safe_float(row.get(col_map.get('elevation', ''))),
            'description': row.get(col_map.get('description', '')) or '',
        })

    return {
        'points': points, 'lines': [], 'polygons': [],
        'format': 'csv',
        'column_mapping': {k: v for k, v in col_map.items() if v}
    }


def parse_kml(file):
    """解析 KML 文件"""
    text = file.read()
    try:
        text = text.decode('utf-8')
    except (UnicodeDecodeError, AttributeError):
        try:
            text = text.decode('gbk')
        except Exception:
            text = text.decode('utf-8', errors='replace')

    # 安全 XML 解析（禁用 DTD/实体）
    try:
        from defusedxml import ElementTree as SafeET
    except ImportError:
        SafeET = ET

    root = SafeET.fromstring(text)
    ns = {'kml': 'http://www.opengis.net/kml/2.2'}

    points, lines, polygons = [], [], []

    for pm in root.iter('{http://www.opengis.net/kml/2.2}Placemark'):
        name = pm.findtext('kml:name', namespaces=ns) or 'KML要素'

        # Point
        coord_el = pm.find('.//kml:Point/kml:coordinates', namespaces=ns)
        if coord_el is not None and coord_el.text:
            coords = coord_el.text.strip().split(',')
            points.append({
                'longitude': float(coords[0]), 'latitude': float(coords[1]),
                'point_type': '地质观察点',
                'point_number': name,
                'elevation': float(coords[2]) if len(coords) > 2 else None,
                'description': (pm.findtext('kml:description', namespaces=ns) or '').strip(),
            })

        # LineString
        line_el = pm.find('.//kml:LineString/kml:coordinates', namespaces=ns)
        if line_el is not None and line_el.text:
            wkt = _kml_coords_to_wkt_line(line_el.text)
            lines.append({'name': name, 'geom_wkt': wkt, 'props': {}})

        # Polygon
        poly_el = pm.find('.//kml:Polygon/kml:outerBoundaryIs/kml:LinearRing/kml:coordinates', namespaces=ns)
        if poly_el is not None and poly_el.text:
            wkt = _kml_coords_to_wkt_polygon(poly_el.text)
            polygons.append({'name': name, 'geom_wkt': wkt, 'props': {}})

    return {'points': points, 'lines': lines, 'polygons': polygons, 'format': 'kml'}


def parse_gpx(file):
    """解析 GPX 文件 → 路线 + 轨迹点"""
    text = file.read()
    try:
        text = text.decode('utf-8')
    except (UnicodeDecodeError, AttributeError):
        text = text.decode('utf-8', errors='replace')

    try:
        from defusedxml import ElementTree as SafeET
    except ImportError:
        SafeET = ET

    root = SafeET.fromstring(text)
    ns = {'gpx': 'http://www.topografix.com/GPX/1/1'}

    routes = []
    tracks = []

    # <trk> — 含 <trkseg> → <trkpt lat="..." lon="...">
    for trk in root.iter('{http://www.topografix.com/GPX/1/1}trk'):
        name = trk.findtext('{http://www.topografix.com/GPX/1/1}name') or 'GPX轨迹'
        trackpoints = []
        for trkpt in trk.iter('{http://www.topografix.com/GPX/1/1}trkpt'):
            lat = float(trkpt.attrib['lat'])
            lon = float(trkpt.attrib['lon'])
            ele = trkpt.findtext('{http://www.topografix.com/GPX/1/1}ele')
            trackpoints.append({
                'latitude': lat, 'longitude': lon,
                'elevation': float(ele) if ele else None,
            })
        if trackpoints:
            track_geom = json.dumps([[tp['latitude'], tp['longitude']] for tp in trackpoints])
            routes.append({
                'name': name,
                'route_geom': track_geom,
                'trackpoints': trackpoints,
            })

    # <wpt> — 独立航点
    waypoints = []
    for wpt in root.iter('{http://www.topografix.com/GPX/1/1}wpt'):
        name = wpt.findtext('{http://www.topografix.com/GPX/1/1}name') or 'GPX航点'
        lat = float(wpt.attrib['lat'])
        lon = float(wpt.attrib['lon'])
        ele = wpt.findtext('{http://www.topografix.com/GPX/1/1}ele')
        waypoints.append({
            'point_number': name,
            'point_type': '地质观察点',
            'latitude': lat, 'longitude': lon,
            'elevation': float(ele) if ele else None,
        })

    return {
        'points': waypoints, 'routes': routes,
        'lines': [], 'polygons': [],
        'format': 'gpx'
    }


# ── 统一写入 ────────────────────────────────────────────────

# 导入目标类型 → 写入函数映射
TARGET_HANDLERS = {
    'geo_points': '_write_points',
    'routes': '_write_routes',
    'boundaries': '_write_lines',
    'faults': '_write_faults',
    'areas': '_write_polygons',
}


def import_to_db(conn, parsed, target_type, project_id):
    """将解析结果写入数据库对应表（单条失败 ROLLBACK 整批）"""
    if target_type not in TARGET_HANDLERS:
        raise ValueError('无效的导入目标类型: {}。有效值: {}'.format(
            target_type, ', '.join(TARGET_HANDLERS.keys())))

    conn.execute('BEGIN TRANSACTION')
    try:
        if target_type == 'geo_points':
            count = _write_points(conn, parsed, project_id)
        elif target_type == 'routes':
            count = _write_routes(conn, parsed, project_id)
        elif target_type == 'boundaries':
            count = _write_lines(conn, parsed, project_id, 'boundary')
        elif target_type == 'faults':
            count = _write_lines(conn, parsed, project_id, 'fault')
        elif target_type == 'areas':
            count = _write_polygons(conn, parsed, project_id)
        else:
            count = 0
        conn.commit()
        return count
    except Exception:
        conn.execute('ROLLBACK')
        raise


# ── 内部辅助函数 ─────────────────────────────────────────────

def _detect_csv_columns(fieldnames):
    """匹配 CSV 列名到标准字段"""
    col_map = {'lat': None, 'lng': None, 'name': None, 'type': None,
               'elevation': None, 'description': None}

    for col in fieldnames:
        clean = col.strip().lower()
        if clean in LAT_ALIASES or col.strip() in {'纬度', 'Y坐标'}:
            col_map['lat'] = col
        elif clean in LNG_ALIASES or col.strip() in {'经度', 'X坐标'}:
            col_map['lng'] = col
        elif clean in NAME_ALIASES or col.strip() in {'名称', '编号'}:
            col_map['name'] = col
        elif clean in TYPE_ALIASES or col.strip() == '类型':
            col_map['type'] = col
        elif clean in {'elevation', 'ele', '高程', 'altitude'}:
            col_map['elevation'] = col
        elif clean in {'description', 'desc', '描述', '备注', 'note'}:
            col_map['description'] = col
    return col_map


def _find_csv_prop(row, col_map, key, default=''):
    key_name = col_map.get(key)
    if key_name and key_name in row:
        return row[key_name]
    return default


def _find_prop(props, aliases, default=''):
    for alias in aliases:
        val = props.get(alias)
        if val:
            return str(val)
    return default


def _extract_name(props, shp_file):
    name = str(props.get('name', props.get('名称', ''))).strip()
    if not name:
        name = os.path.basename(shp_file).replace('.shp', '')
    return name


def _geom_to_wkt_linestring(geom):
    coords = ', '.join('{} {}'.format(p[0], p[1]) for p in geom.points)
    return 'LINESTRING({})'.format(coords)


def _geom_to_wkt_polygon(geom):
    coords = ', '.join('{} {}'.format(p[0], p[1]) for p in geom.points)
    return 'POLYGON(({}))'.format(coords)


def _kml_coords_to_wkt_line(text):
    coords = text.strip().split()
    pts = [c.split(',') for c in coords]
    wkt_coords = ', '.join('{} {}'.format(p[0], p[1]) for p in pts)
    return 'LINESTRING({})'.format(wkt_coords)


def _kml_coords_to_wkt_polygon(text):
    coords = text.strip().split()
    pts = [c.split(',') for c in coords]
    wkt_coords = ', '.join('{} {}'.format(p[0], p[1]) for p in pts)
    return 'POLYGON(({}))'.format(wkt_coords)


def _safe_float(v):
    try:
        return float(v) if v not in (None, '') else None
    except (ValueError, TypeError):
        return None


def _shp_safe_float(v):
    return _safe_float(v)


def _map_shp_point(props, geom, shp_file, idx=0):
    name = str(props.get('point_number', props.get('name', props.get('编号', '')))).strip()
    if not name:
        base = os.path.basename(shp_file).replace('.shp', '')
        name = '{}_{:04d}'.format(base, idx + 1)
    return {
        'point_number': name,
        'point_type': str(props.get('point_type', props.get('类型', '地质观察点'))),
        'longitude': geom.points[0][0], 'latitude': geom.points[0][1],
        'elevation': _shp_safe_float(props.get('elevation', props.get('高程'))),
        'description': str(props.get('descriptio', props.get('描述', ''))),
        'rock_type': str(props.get('rock_type', props.get('岩石类型', ''))),
        'stratum_age': str(props.get('stratum_ag', props.get('地层时代', ''))),
        'occurrence_type': str(props.get('occurrenc', props.get('构造类型', ''))),
        'strike': _shp_safe_float(props.get('strike', props.get('走向'))),
        'dip': _shp_safe_float(props.get('dip', props.get('倾角'))),
        'dip_direction': _shp_safe_float(props.get('dip_direc', props.get('倾向'))),
    }


# ── 写入数据库 ──────────────────────────────────────────────

def _write_points(conn, parsed, project_id):
    count = 0
    points = parsed.get('points', [])
    for pt in points:
        lat = pt.get('latitude')
        lng = pt.get('longitude')
        if lat is None or lng is None:
            continue
        # 坐标验证
        if not (-90 <= lat <= 90) or not (-180 <= lng <= 180):
            continue
        # 去重检查（6 位小数）
        rlat, rlng = round(lat, 6), round(lng, 6)
        exist = conn.execute(
            'SELECT id FROM geological_points WHERE project_id=? AND ROUND(latitude,6)=? AND ROUND(longitude,6)=? AND point_type=?',
            (project_id, rlat, rlng, pt.get('point_type', '地质观察点'))
        ).fetchone()
        if exist:
            continue

        conn.execute(
            '''INSERT INTO geological_points
               (project_id, point_number, point_type, latitude, longitude,
                elevation, accuracy, location_method, description, rock_type,
                stratum_age, stratum_name, occurrence_type, strike, dip, dip_direction,
                sample_number, sample_type, symbol)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)''',
            (project_id,
             pt.get('point_number') or 'IMP_{:04d}'.format(count + 1),
             pt.get('point_type', '地质观察点'),
             lat, lng,
             pt.get('elevation'), pt.get('accuracy'),
             pt.get('location_method', 'GPS'), pt.get('description', ''),
             pt.get('rock_type', ''), pt.get('stratum_age', ''), pt.get('stratum_name', ''),
             pt.get('occurrence_type', ''),
             pt.get('strike'), pt.get('dip'), pt.get('dip_direction'),
             pt.get('sample_number', ''), pt.get('sample_type', ''),
             pt.get('symbol', None))
        )
        count += 1
    return count


def _write_routes(conn, parsed, project_id):
    count = 0
    for route in parsed.get('routes', []):
        name = route.get('name', '路线{}'.format(count + 1))
        route_geom = route.get('route_geom')
        if route_geom:
            if isinstance(route_geom, (list, dict)):
                route_geom = json.dumps(route_geom)
        cursor = conn.execute(
            '''INSERT INTO field_routes (project_id, name, route_geom)
               VALUES (?, ?, ?)''',
            (project_id, name, route_geom or ''))
        route_id = cursor.lastrowid
        # 写入轨迹点
        for tp in route.get('trackpoints', []):
            conn.execute(
                '''INSERT INTO route_trackpoints (route_id, latitude, longitude, elevation)
                   VALUES (?, ?, ?, ?)''',
                (route_id, tp.get('latitude', 0), tp.get('longitude', 0), tp.get('elevation')))
        count += 1
    return count


def _write_lines(conn, parsed, project_id, line_type='boundary'):
    count = 0
    for line in parsed.get('lines', []):
        name = line.get('name', '线要素{}'.format(count + 1))
        wkt = line.get('geom_wkt')
        if not wkt:
            continue
        if line_type == 'fault':
            conn.execute(
                '''INSERT INTO faults (project_id, name, fault_type, geom_wkt, description)
                   VALUES (?, ?, ?, ?, ?)''',
                (project_id, name, line.get('props', {}).get('fault_type', ''), wkt,
                 line.get('props', {}).get('description', '')))
        else:
            conn.execute(
                '''INSERT INTO geological_boundaries (project_id, name, boundary_type, geom_wkt, description)
                   VALUES (?, ?, ?, ?, ?)''',
                (project_id, name, line.get('props', {}).get('boundary_type', ''), wkt,
                 line.get('props', {}).get('description', '')))
        count += 1
    return count


def _write_polygons(conn, parsed, project_id):
    count = 0
    pal = ['#fff2cc', '#d9ead3', '#cfe2f3', '#fce5cd', '#ead1dc', '#d0e0e3',
           '#e6d5c3', '#c9daf8', '#f4cccc', '#d9d2e9', '#b6d7a8', '#ffe599']
    polygons = parsed.get('polygons', [])
    # 先建 name→color 映射（同名同色）
    name_colors = {}
    for poly in polygons:
        name = poly.get('name', '')
        if name and name not in name_colors:
            name_colors[name] = poly.get('props', {}).get('fill_color') or pal[len(name_colors) % len(pal)]
    for poly in polygons:
        name = poly.get('name', '面要素{}'.format(count + 1))
        wkt = poly.get('geom_wkt')
        if not wkt:
            continue
        color = name_colors.get(name) if name in name_colors else pal[count % len(pal)]
        conn.execute(
            '''INSERT INTO geological_areas (project_id, name, area_type, geom_wkt, fill_color, description)
               VALUES (?, ?, ?, ?, ?, ?)''',
            (project_id, name, poly.get('props', {}).get('area_type', ''),
             wkt, poly.get('props', {}).get('fill_color', color),
             poly.get('props', {}).get('description', '')))
        count += 1
    return count
