"""
路径导航 API — 高德 Web API 代理
Route Navigation API — Amap Web API Proxy
"""
import re
import requests
from flask import Blueprint, request, jsonify
from config import AMAP_API_KEY

navigation_bp = Blueprint('navigation', __name__)

# 高德路径规划 API 基础 URL
# driving/walking: v3, bicycling(骑行): v4
AMAP_DIRECTION_V3 = 'https://restapi.amap.com/v3/direction'
AMAP_DIRECTION_V4 = 'https://restapi.amap.com/v4/direction'

# 前端 mode → (高德 API 版本, 高德路径名)
MODE_MAP = {
    'driving':  ('v3', 'driving'),
    'walking':  ('v3', 'walking'),
    'riding':   ('v4', 'bicycling'),   # 骑行 = bicycling, v4
}

ALLOWED_MODES = set(MODE_MAP.keys())

# 坐标格式校验：必须是 "经度,纬度"（两个浮点数，用逗号分隔）
COORD_PATTERN = re.compile(r'^[\s]*[-]?\d{1,3}\.\d+[\s]*,[\s]*[-]?\d{1,3}\.\d+[\s]*$')


def _validate_coord(val, label='坐标'):
    """校验单个坐标字符串"""
    if not val or not isinstance(val, str):
        return False, f'{label}格式错误：需要"经度,纬度"字符串'
    if not COORD_PATTERN.match(val):
        return False, f'{label}格式错误：示例 "116.397428,39.908799"'
    return True, None


def _parse_plain_polyline(encoded):
    """
    解析高德 v3 API 返回的明文坐标 polyline。
    格式: "lng,lat;lng,lat;..."
    返回: [[lat, lng], ...]
    """
    points = []
    for seg in encoded.split(';'):
        seg = seg.strip()
        if not seg or ',' not in seg:
            continue
        parts = seg.split(',')
        if len(parts) < 2:
            continue
        try:
            # 高德格式是 "经度,纬度"
            lng = float(parts[0])
            lat = float(parts[1])
        except ValueError:
            continue

        # 验证坐标范围（地球范围）
        if not (-180 <= lng <= 180 and -90 <= lat <= 90):
            continue
        points.append([lat, lng])

    return points


def _decode_google_polyline(encoded):
    """
    Google polyline 编码解码（offset = 63）。
    返回: [[lat, lng], ...]
    """
    if not encoded:
        return []

    result = []
    i = 0
    n = len(encoded)
    prev_lat = 0
    prev_lng = 0

    while i < n:
        # 解码纬度
        shift = 0
        result_int = 0
        while i < n:
            byte = ord(encoded[i]) - 63
            i += 1
            result_int |= (byte & 0x1f) << shift
            shift += 5
            if byte < 0x20:
                break
        else:
            break   # 字符串意外结束

        d_lat = ~(result_int >> 1) if (result_int & 1) else (result_int >> 1)

        # 解码经度
        shift = 0
        result_int = 0
        while i < n:
            byte = ord(encoded[i]) - 63
            i += 1
            result_int |= (byte & 0x1f) << shift
            shift += 5
            if byte < 0x20:
                break
        else:
            break

        d_lng = ~(result_int >> 1) if (result_int & 1) else (result_int >> 1)

        prev_lat += d_lat
        prev_lng += d_lng
        lat = prev_lat / 1e6
        lng = prev_lng / 1e6

        # 范围校验
        if -90 <= lat <= 90 and -180 <= lng <= 180:
            result.append([lat, lng])
        elif len(result) == 0:
            return []   # 第一个点就错了，说明格式不对
        else:
            break       # 后续点异常，停止

    return result


def _decode_amap_polyline(encoded):
    """
    解码高德 API 返回的 polyline 字符串。

    高德不同 API 版本的 polyline 格式不同：
    - v3 API (driving/walking): "lng,lat;lng,lat" 明文坐标
    - v4 API (riding): Google polyline 编码
    - 个别情况: 高德自定义编码
    """
    if not encoded:
        return []

    # 策略 1：明文坐标（v3 API，最常见）
    if ';' in encoded and ',' in encoded:
        points = _parse_plain_polyline(encoded)
        if len(points) >= 2:
            print(f'[Navigation] Parsed {len(points)} points from plain format')
            return points

    # 策略 2：Google polyline 编码（v4 API）
    points = _decode_google_polyline(encoded)
    if len(points) >= 2:
        print(f'[Navigation] Decoded {len(points)} points from Google polyline')
        return points

    # 策略 3：尝试高德自定义编码（offset=64，罕见）
    # 简单替换 offset 重试
    try:
        modified = ''.join(chr(ord(c) - 1) for c in encoded)   # offset 63→64 的差异
        points = _decode_google_polyline(modified)
        if len(points) >= 2:
            print(f'[Navigation] Decoded {len(points)} points from AMap custom polyline')
            return points
    except Exception:
        pass

    print(f'[Navigation] WARN: All polyline parse methods failed. '
          f'Preview: "{encoded[:100]}..."')
    return []


@navigation_bp.route('/route', methods=['POST'])
def plan_route():
    """
    路径规划代理

    POST /api/navigation/route
    Body: {"origin": "116.397,39.908", "destination": "116.481,39.996", "mode": "driving"}
    """
    # 检查 API Key 是否配置
    if not AMAP_API_KEY or AMAP_API_KEY == 'your_amap_key_here':
        return jsonify({
            'error': 'AMAP_API_KEY 未配置',
            'detail': '请在 backend/config.py 中配置高德地图 Web 服务 API Key',
            'hint': '注册地址: https://console.amap.com/'
        }), 500

    data = request.get_json(silent=True)
    if not data:
        return jsonify({'error': '请求体不能为空', 'detail': '需要 JSON body'}), 400

    origin = data.get('origin', '').strip()
    destination = data.get('destination', '').strip()
    mode = data.get('mode', 'driving').strip()

    ok, err = _validate_coord(origin, '起点')
    if not ok:
        return jsonify({'error': 'INVALID_ORIGIN', 'detail': err}), 400

    ok, err = _validate_coord(destination, '终点')
    if not ok:
        return jsonify({'error': 'INVALID_DESTINATION', 'detail': err}), 400

    if mode not in ALLOWED_MODES:
        return jsonify({
            'error': 'INVALID_MODE',
            'detail': f'交通方式必须是 {", ".join(sorted(ALLOWED_MODES))} 之一'
        }), 400

    api_version, amap_mode = MODE_MAP[mode]
    base_url = AMAP_DIRECTION_V3 if api_version == 'v3' else AMAP_DIRECTION_V4
    params = {
        'key': AMAP_API_KEY,
        'origin': origin,
        'destination': destination,
        'extensions': 'all',
        'output': 'JSON',
    }

    try:
        url = f'{base_url}/{amap_mode}'
        resp = requests.get(url, params=params, timeout=10)
        resp.raise_for_status()
        amap_result = resp.json()
    except requests.exceptions.Timeout:
        return jsonify({'error': 'TIMEOUT', 'detail': '高德地图 API 请求超时'}), 504
    except requests.exceptions.ConnectionError:
        return jsonify({'error': 'CONNECTION_ERROR', 'detail': '无法连接高德地图服务器'}), 502
    except Exception as e:
        return jsonify({'error': 'UPSTREAM_ERROR', 'detail': f'调用高德 API 失败: {str(e)}'}), 502

    # 检查高德返回状态
    amap_status = amap_result.get('status')
    amap_errcode = amap_result.get('errcode')

    if amap_status != '1' and amap_errcode != 0:
        info = amap_result.get('info', amap_result.get('errmsg', '未知错误'))
        infocode = amap_result.get('infocode', amap_result.get('errcode', ''))
        return jsonify({
            'error': 'AMAP_ERROR',
            'detail': f'高德 API 返回错误 [{infocode}]: {info}',
            'amap_info': info,
            'amap_infocode': infocode
        }), 502

    # v4 API 的数据在 data 字段里
    if 'data' in amap_result and 'route' in amap_result.get('data', {}):
        route_data = amap_result['data']['route']
    else:
        route_data = amap_result.get('route', {})

    paths = route_data.get('paths', [])
    if not paths:
        return jsonify({
            'error': 'NO_ROUTE',
            'detail': '未找到可行路线，请检查起终点位置是否可达'
        }), 200

    best_path = paths[0]

    # ---- 解码 polyline ----
    # v3 API: polyline 在 path 层级，格式为 "lng,lat;lng,lat"
    # v4 API: polyline 可能分散在每个 step 中
    polyline_encoded = best_path.get('polyline', '')
    polyline_coords = _decode_amap_polyline(polyline_encoded)

    # 如果 path 层级没有 polyline，尝试从 steps 中聚合（v4 API）
    if not polyline_coords:
        steps_raw = best_path.get('steps', [])
        all_coords = []
        for idx, s in enumerate(steps_raw):
            step_polyline = s.get('polyline', '')
            if step_polyline:
                try:
                    coords = _decode_amap_polyline(step_polyline)
                    all_coords.extend(coords)
                except Exception as e:
                    print(f'[Navigation] Step {idx} polyline parse failed: {e}')
        polyline_coords = all_coords
        if polyline_coords:
            print(f'[Navigation] v4 API: 从 {len(steps_raw)} 个 steps 聚合了 {len(polyline_coords)} 个坐标点')

    print(f'[Navigation] Final polyline: {len(polyline_coords)} points')

    # 提取步骤信息
    steps_raw = best_path.get('steps', [])
    steps = []
    for s in steps_raw:
        step = {
            'instruction': s.get('instruction', ''),
            'distance': int(s.get('distance', 0)),
            'duration': int(s.get('duration', 0)),
            'road': s.get('road', ''),
        }
        if mode == 'driving':
            step['orientation'] = s.get('orientation', '')
            step['action'] = s.get('action', '')
        steps.append(step)

    total_distance = int(best_path.get('distance', 0))
    total_duration = int(best_path.get('duration', 0))

    if not total_distance and steps:
        total_distance = sum(s['distance'] for s in steps)
    if not total_duration and steps:
        total_duration = sum(s['duration'] for s in steps)

    return jsonify({
        'mode': mode,
        'distance': total_distance,
        'duration': total_duration,
        'polyline': polyline_coords,
        'steps': steps,
        'origin': origin,
        'destination': destination,
    })
