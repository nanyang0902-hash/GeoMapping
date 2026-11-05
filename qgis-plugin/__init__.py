"""
地质填图工具 QGIS Plugin
GeoMapping Tools for QGIS

安装方法:
  1. 将此文件夹复制到 QGIS 插件目录:
     %APPDATA%/QGIS/QGIS3/profiles/default/python/plugins/geomapping/
  2. 在 QGIS 菜单: 插件 → 管理并安装插件 → 勾选启用
  3. 工具栏出现"地质填图"按钮
"""


def classFactory(iface):
    """QGIS 插件入口"""
    from .geo_mapping_plugin import GeoMappingPlugin
    return GeoMappingPlugin(iface)
