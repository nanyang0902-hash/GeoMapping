# 地质填图系统 GeoMapping

> 一个面向野外地质填图（Geological Field Mapping）的一体化系统：从**野外 GPS 采集**、**数据管理**，到 **QGIS 专业成图**，覆盖地质填图全流程。

**Geological Mapping System** — an integrated field geological mapping system covering the full workflow: GPS-based field data collection, data management, and professional map compilation in QGIS.

---

## ✨ 功能特性

| 模块 | 功能 |
|---|---|
| **移动端采集** | GPS 实时定位、地质点/路线/样品采集、现场拍照、轨迹记录、离线缓存（PWA） |
| **桌面端工作台** | Leaflet 在线地图 + 图层编辑、地质点/界线/断层/地层编绘、产状标注、数据审核 |
| **数据管理** | SQLite 存储、多项目隔离、数据版本记录、完整性检查 |
| **数据同步** | 移动端 JSON 同步、Shapefile / GeoJSON / CSV / KML / GPX 批量导入 |
| **数据导出** | GeoJSON / CSV / KML / Shapefile(ZIP) 导出，CGCS2000↔WGS84↔Web Mercator 坐标转换 |
| **QGIS 插件** | 地质符号库、岩性花纹填充、地层界线/断层绘制、拓扑检查、QField 野外项目一键导出 |
| **原生客户端** | .NET MAUI 桌面端（WebView2）+ Android（WebView）壳，加载 Web 前端 |
| **高德导航** | 野外点位一键导航（高德地图 Web 服务） |

## 🏗 系统架构

采用「**后端 API + Web 前端 + 原生壳 + QGIS 插件**」的架构，前端为核心交互层，MAUI 客户端作为原生壳加载 Web 界面，QGIS 插件承担专业成图：

```
┌─────────────────────────────── 客户端层 ───────────────────────────────┐
│  ┌──────────────┐  ┌──────────────┐  ┌───────────────────────────┐   │
│  │  桌面端 Web   │  │  移动端 PWA   │  │   .NET MAUI 壳            │   │
│  │ (Leaflet 编辑)│  │ (GPS 采集)    │  │  桌面 WebView2 / Android  │   │
│  └──────┬───────┘  └──────┬───────┘  └─────────────┬─────────────┘   │
└─────────┴──────────────────┴────────────────────────┴─────────────────┘
                           │ HTTP REST API
                           ▼
              ┌──────────────────────────┐
              │   Flask 后端（端口 5050）  │
              │   REST API + SQLite 数据库 │
              └────────────┬─────────────┘
                           │
        ┌──────────────────┼──────────────────┐
        ▼                  ▼                  ▼
  ┌───────────┐      ┌───────────┐      ┌────────────┐
  │  SQLite    │      │ 文件存储    │      │  QGIS 插件  │
  │  空间+属性 │      │ 照片/附件   │      │ 成图/QField  │
  └───────────┘      └───────────┘      └────────────┘
```

## 🧰 技术栈

- **后端**：Python 3 · Flask · Flask-CORS · SQLite（空间数据用 WKT/GeoJSON 存储）
- **地理处理**：Shapely · PyProj · PyShp · Pandas
- **前端**：原生 JavaScript · Leaflet · Leaflet.draw · PWA（Service Worker + Manifest）
- **QGIS 插件**：PyQGIS（QGIS 3.22+）
- **原生客户端**：.NET MAUI（net10.0）· WebView2（桌面）· Android WebView
- **地图服务**：高德地图（在线底图 / Web 服务 API）

## 📁 目录结构

```
实习四/
├── backend/                  # Flask 后端
│   ├── app.py                # 应用入口（REST API）
│   ├── config.py             # 配置（端口/密钥/坐标系统/点类型）
│   ├── database.py           # SQLite 建表与迁移
│   ├── routes/               # 各资源路由（points/routes/photos/...）
│   ├── services/             # 导入解析、PyQGIS 服务
│   └── data/                 # 数据库 geo_mapping.db + 照片/附件/瓦片
├── frontend/
│   ├── index.html            # 系统首页
│   ├── desktop/              # 桌面端（Leaflet 地图编辑）
│   └── mobile/               # 移动端（PWA 野外采集）
├── qgis-plugin/              # QGIS 插件（地质填图工具）
│   ├── geo_mapping_plugin.py
│   ├── geo_mapping_dockwidget.py
│   ├── qfield_export.py      # QField 项目导出
│   └── topology_check.py     # 拓扑检查
├── vs-solution/              # .NET MAUI 解决方案
│   ├── GeoMapping.Desktop/   # Windows 桌面端（WebView2）
│   ├── GeoMapping.Android/   # Android 客户端（WebView）
│   ├── GeoMapping.Backend/   # 后端 Python 工程引用
│   └── GeoMapping.sln
└── 测试数据/               # 野外成果数据（Shapefile 等）
    └── A组电子成图数据/       # 产状点/地层界限/地层面/等高线/奥维点
```

## 📦 环境依赖

| 依赖 | 版本 | 用途 |
|---|---|---|
| Python | 3.9+ | 后端运行 |
| pip 依赖 | `pip install -r backend/requirements.txt` | Flask / Shapely / PyProj 等 |
| QGIS | 3.22+ | QGIS 插件 + 后端 PyQGIS 服务 |
| .NET SDK | 10.0 | 编译 MAUI 桌面/Android 客户端 |
| WebView2 运行时 | 最新 | MAUI 桌面端加载页面（Win11 已内置） |

## 🚀 快速开始

### 1. 启动后端

```bash
cd backend
pip install -r requirements.txt
python app.py
```

启动后访问健康检查接口，确认服务正常：

```bash
curl http://localhost:5050/api/health
```

预期返回：

```json
{"status": "ok", "service": "地质填图系统 API", "version": "1.0.0"}
```

### 2. 打开前端

| 界面 | 地址 |
|---|---|
| 系统首页 | http://localhost:5050/ |
| 桌面工作台 | http://localhost:5050/desktop/ |
| 移动端（建议 F12 手机模拟） | http://localhost:5050/mobile/ |

### 3. 安装 QGIS 插件

将 `qgis-plugin/` 文件夹复制到 QGIS 插件目录：

```
%APPDATA%/QGIS/QGIS3/profiles/default/python/plugins/geomapping/
```

然后在 QGIS 菜单：**插件 → 管理并安装插件 → 勾选启用**，工具栏出现「地质填图」按钮。

### 4. 编译 MAUI 客户端（可选）

用 Visual Studio 打开 `vs-solution/GeoMapping.sln`，选择 `GeoMapping.Desktop`（Windows）或 `GeoMapping.Android`（Android）构建运行。客户端启动时会自动检测后端 `http://localhost:5050`。

> ⚠️ 高德地图功能需在 `backend/config.py` 中配置 `AMAP_API_KEY`（默认占位符 `your_amap_key_here`，未配置时导航功能不可用，其余功能不受影响）。

## 📖 详细操作流程

完整的「野外采集 → 数据同步 → 入库 → QGIS 成图 → QField 导出」操作指南见 **[docs/操作流程.md](docs/操作流程.md)**。

## 📸 界面展示

> 将截图放入 `docs/images/` 目录后，取消对应行注释即可展示。

| 界面 | 截图路径 |
|---|---|
| 桌面端地图编辑 | `docs/images/desktop-editor.png` |
| 移动端野外采集 | `docs/images/mobile-field.png` |
| QGIS 成图成果 | `docs/images/qgis-map.png` |
| 后端 API 健康检查 | `docs/images/api-health.png` |

## 📄 License

本项目采用 [MIT License](LICENSE)。

---

*项目数据为野外实习成果，仅作学习与作品展示用途。*
