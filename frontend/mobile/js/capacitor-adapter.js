/**
 * Capacitor 原生功能适配器
 * 在 Capacitor 环境中使用原生插件，在浏览器中回退到 Web API
 */
const NativeBridge = {
    isNative: false,

    async init() {
        // 检测是否运行在 Capacitor 原生环境中
        try {
            this.isNative = !!(window.Capacitor && window.Capacitor.isNativePlatform());
            console.log(`[NativeBridge] 运行环境: ${this.isNative ? '原生APP' : '浏览器'}`);
        } catch (e) {
            this.isNative = false;
            console.log('[NativeBridge] 运行环境: 浏览器 (PWA模式)');
        }
    },

    /**
     * GPS 定位 - 使用原生 Geolocation 插件
     */
    async getCurrentPosition() {
        if (this.isNative) {
            try {
                const { Geolocation } = await import('@capacitor/geolocation');
                const pos = await Geolocation.getCurrentPosition({
                    enableHighAccuracy: true,
                    timeout: 10000,
                });
                return {
                    latitude: pos.coords.latitude,
                    longitude: pos.coords.longitude,
                    elevation: pos.coords.altitude,
                    accuracy: pos.coords.accuracy,
                    speed: pos.coords.speed,
                    heading: pos.coords.heading,
                    timestamp: new Date(pos.timestamp).toISOString(),
                };
            } catch (e) {
                console.warn('[NativeBridge] 原生GPS失败，回退到Web API:', e.message);
            }
        }

        // 回退到浏览器 Geolocation API
        return new Promise((resolve, reject) => {
            navigator.geolocation.getCurrentPosition(
                (pos) => {
                    resolve({
                        latitude: pos.coords.latitude,
                        longitude: pos.coords.longitude,
                        elevation: pos.coords.altitude,
                        accuracy: pos.coords.accuracy,
                        speed: pos.coords.speed,
                        heading: pos.coords.heading,
                        timestamp: new Date(pos.timestamp).toISOString(),
                    });
                },
                reject,
                { enableHighAccuracy: true, timeout: 10000, maximumAge: 1000 }
            );
        });
    },

    /**
     * GPS 持续监听
     */
    async watchPosition(callback, onError) {
        if (this.isNative) {
            try {
                const { Geolocation } = await import('@capacitor/geolocation');
                return Geolocation.watchPosition(
                    { enableHighAccuracy: true, timeout: 15000 },
                    (pos, err) => {
                        if (err) {
                            onError?.(err);
                            return;
                        }
                        callback({
                            latitude: pos.coords.latitude,
                            longitude: pos.coords.longitude,
                            elevation: pos.coords.altitude,
                            accuracy: pos.coords.accuracy,
                            speed: pos.coords.speed,
                            heading: pos.coords.heading,
                            timestamp: new Date(pos.timestamp).toISOString(),
                        });
                    }
                );
            } catch (e) {
                console.warn('[NativeBridge] 原生Watch失败，回退到Web API');
            }
        }

        // 回退到浏览器 API
        return navigator.geolocation.watchPosition(
            (pos) => callback({
                latitude: pos.coords.latitude,
                longitude: pos.coords.longitude,
                elevation: pos.coords.altitude,
                accuracy: pos.coords.accuracy,
                speed: pos.coords.speed,
                heading: pos.coords.heading,
                timestamp: new Date(pos.timestamp).toISOString(),
            }),
            onError,
            { enableHighAccuracy: true, timeout: 15000, maximumAge: 1000 }
        );
    },

    /**
     * 拍照 - 使用原生 Camera 插件
     */
    async takePhoto() {
        if (this.isNative) {
            try {
                const { Camera, CameraResultType, CameraSource } = await import('@capacitor/camera');
                const photo = await Camera.getPhoto({
                    quality: 90,
                    allowEditing: false,
                    resultType: CameraResultType.DataUrl,
                    source: CameraSource.Camera,
                });
                return {
                    dataUrl: photo.dataUrl,
                    format: photo.format,
                    timestamp: new Date().toISOString(),
                };
            } catch (e) {
                console.warn('[NativeBridge] 原生相机失败:', e.message);
            }
        }

        // Web 端回退：触发文件选择
        return new Promise((resolve, reject) => {
            const input = document.createElement('input');
            input.type = 'file';
            input.accept = 'image/*';
            input.capture = 'environment';
            input.onchange = (e) => {
                const file = e.target.files[0];
                if (!file) { reject(new Error('未选择照片')); return; }
                const reader = new FileReader();
                reader.onload = (ev) => resolve({
                    dataUrl: ev.target.result,
                    format: file.type,
                    timestamp: new Date().toISOString(),
                });
                reader.onerror = reject;
                reader.readAsDataURL(file);
            };
            input.click();
        });
    },

    /**
     * 本地存储 - 使用原生 Preferences (Key-Value) + 文件系统
     */
    async setPreference(key, value) {
        if (this.isNative) {
            try {
                const { Preferences } = await import('@capacitor/preferences');
                await Preferences.set({ key, value: JSON.stringify(value) });
                return;
            } catch (e) {
                console.warn('[NativeBridge] Preferences 写入失败');
            }
        }
        localStorage.setItem(key, JSON.stringify(value));
    },

    async getPreference(key, defaultValue = null) {
        if (this.isNative) {
            try {
                const { Preferences } = await import('@capacitor/preferences');
                const result = await Preferences.get({ key });
                return result.value ? JSON.parse(result.value) : defaultValue;
            } catch (e) {
                console.warn('[NativeBridge] Preferences 读取失败');
            }
        }
        const val = localStorage.getItem(key);
        return val ? JSON.parse(val) : defaultValue;
    },

    /**
     * 文件系统 - 保存文件
     */
    async saveFile(filename, content) {
        if (this.isNative) {
            try {
                const { Filesystem, Directory } = await import('@capacitor/filesystem');
                await Filesystem.writeFile({
                    path: filename,
                    data: content,
                    directory: Directory.Data,
                });
                return true;
            } catch (e) {
                console.warn('[NativeBridge] 文件保存失败');
            }
        }
        return false;
    },

    /**
     * 分享功能
     */
    async shareFile(filename) {
        if (this.isNative) {
            try {
                const { Filesystem, Directory } = await import('@capacitor/filesystem');
                const { Share } = await import('@capacitor/share');
                const file = await Filesystem.getUri({
                    path: filename,
                    directory: Directory.Data,
                });
                await Share.share({
                    title: '地质填图数据',
                    text: '导出地质填图数据',
                    files: [file.uri],
                });
                return;
            } catch (e) {
                console.warn('[NativeBridge] 分享失败');
            }
        }
    },
};

// 自动初始化
NativeBridge.init();
