/**
 * 符号库模块 - 地质符号加载与使用
 */
const SymbolLib = {
    symbols: [],
    categories: [],
    pointTypeSymbols: {},  // {点类型: 符号名} 映射
    _loaded: false,

    async load() {
        try {
            // 加载配置（含 point_type_symbols 映射）
            const config = await api.config.get().catch(() => ({}));
            this.pointTypeSymbols = config.point_type_symbols || {};

            // 加载符号库
            this.symbols = await api.symbols.list();
            this.categories = [...new Set(this.symbols.map(s => s.category || s.symbol_type))];
            this._loaded = true;
            this.render();
        } catch (e) {
            console.warn('符号库加载失败:', e);
        }
    },

    render() {
        const container = document.getElementById('symbolCategories');
        if (!container) return;

        // 统计已匹配类型
        const matchedTypes = Object.keys(this.pointTypeSymbols);
        const allTypes = ['地质观察点','构造测量点','样品点','照片点','地貌点','水文点','工程地质点'];
        const directMatch = allTypes.filter(t => this.symbols.some(s => s.name === t));
        const totalMatched = new Set([...directMatch, ...matchedTypes]).size;

        container.innerHTML = ''
            + '<div style="font-size:10px;color:var(--fill-tertiary);margin-bottom:8px;text-align:center">'
            + '已匹配 ' + totalMatched + '/' + allTypes.length + ' 种点类型'
            + '</div>'
            + this.categories.map(cat => {
                const items = this.symbols.filter(s => (s.category || s.symbol_type) === cat);
                return `
                    <div class="symbol-category">
                        <h4>${cat}</h4>
                        <div class="symbol-grid">
                            ${items.map(s => {
                                const isMapped = directMatch.includes(s.name) || Object.values(this.pointTypeSymbols).includes(s.name);
                                return `
                                    <div class="symbol-item ${isMapped ? 'symbol-mapped' : ''}" draggable="true"
                                         data-symbol='${JSON.stringify(s).replace(/'/g, "&#39;")}'
                                         title="${s.name}${isMapped ? ' (已匹配)' : ''}">
                                        <svg width="24" height="24" viewBox="-16 -16 32 32">
                                            ${s.svg_path || s.svg || ''}
                                        </svg>
                                        <span>${s.name}</span>
                                        ${isMapped ? '<span class="symbol-check">✓</span>' : ''}
                                    </div>
                                `;
                            }).join('')}
                        </div>
                    </div>
                `;
            }).join('');

        // 拖拽事件
        container.querySelectorAll('.symbol-item').forEach(el => {
            el.addEventListener('dragstart', (e) => {
                e.dataTransfer.setData('application/json', el.dataset.symbol);
            });
        });
    },

    getSymbol(name) {
        if (!name) return null;
        return this.symbols.find(s => s.name === name);
    },

    getSymbolsByCategory(category) {
        return this.symbols.filter(s => (s.category || s.symbol_type) === category);
    },

    // 根据地质点类型解析默认符号
    getDefaultSymbolName(pointType) {
        // 1. 查配置映射
        if (this.pointTypeSymbols[pointType]) return this.pointTypeSymbols[pointType];
        // 2. 符号名 = 类型名（直接匹配）
        if (this.symbols.some(s => s.name === pointType)) return pointType;
        // 3. 回退
        return null;
    },

    // 为地质点获取 Leaflet 图标
    getIconForPoint(point) {
        // 1. 手动绑定的 symbol 字段优先
        if (point.symbol) {
            const icon = this.createLeafletIcon(point.symbol);
            if (icon) return icon;
        }
        // 2. 按点类型匹配默认符号
        const defaultName = this.getDefaultSymbolName(point.point_type);
        if (defaultName) {
            const icon = this.createLeafletIcon(defaultName);
            if (icon) return icon;
        }
        // 3. 无匹配 → null（调用方使用 fallback）
        return null;
    },

    // 创建 Leaflet 图标
    createLeafletIcon(symbolName) {
        const sym = this.getSymbol(symbolName);
        if (!sym) return null;

        return L.divIcon({
            className: 'geo-symbol-icon',
            html: '<svg width="24" height="24" viewBox="-16 -16 32 32">' + (sym.svg_path || sym.svg || '') + '</svg>',
            iconSize: [24, 24],
            iconAnchor: [12, 12],
            popupAnchor: [0, -12],
        });
    },
};

/* 符号相关样式 */
const symbolStyles = `
.symbol-category { margin-bottom: 16px; }
.symbol-category h4 {
    font-size: 0.8em; color: var(--text-muted);
    margin-bottom: 8px; padding: 4px 0; border-bottom: 1px solid var(--border);
}
.symbol-grid {
    display: grid; grid-template-columns: repeat(3, 1fr); gap: 6px;
}
.symbol-item {
    display: flex; flex-direction: column; align-items: center;
    padding: 8px 4px; border-radius: 6px;
    cursor: grab; transition: background 0.2s;
    border: 1px solid transparent; text-align: center;
}
.symbol-item:hover { background: rgba(255,255,255,0.08); border-color: var(--border); }
.symbol-item span { font-size: 0.7em; color: var(--text-secondary); margin-top: 4px; }
.symbol-item.symbol-mapped { border-color: var(--accent); background: rgba(0,122,255,0.08); }
.symbol-check { position: absolute; top: 2px; right: 2px; font-size: 10px; color: var(--accent); }
`;

// 动态注入样式 (DOM ready 后再执行)
(function injectStyles() {
    if (document.head) {
        var el = document.createElement('style');
        el.textContent = symbolStyles;
        document.head.appendChild(el);
    } else {
        document.addEventListener('DOMContentLoaded', function() {
            var el = document.createElement('style');
            el.textContent = symbolStyles;
            document.head.appendChild(el);
        });
    }
})();
