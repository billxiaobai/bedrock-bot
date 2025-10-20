const fs = require('fs');
const path = require('path');

class ConfigManager {
    constructor(configPath = './config.json') {
        this.configPath = configPath;
        this.config = null;
        this.watchers = [];
        
        this.loadConfig();
        this.setupConfigWatcher();
    }

    loadConfig() {
        try {
            if (!fs.existsSync(this.configPath)) {
                throw new Error(`Configuration file not found: ${this.configPath}`);
            }

            const configData = fs.readFileSync(this.configPath, 'utf8');
            this.config = JSON.parse(configData);
            this.validateConfig();
        } catch (error) {
            throw new Error(`Failed to load configuration: ${error.message}`);
        }
    }

    validateConfig() {
        const required = ['bot', 'features', 'logging'];
        const missing = required.filter(key => !this.config[key]);
        
        if (missing.length > 0) {
            throw new Error(`Missing required configuration sections: ${missing.join(', ')}`);
        }
        if (!this.config.bot.host || !this.config.bot.username) {
            throw new Error('Bot configuration must include host and username');
        }
    }

    setupConfigWatcher() {
        if (fs.existsSync(this.configPath)) {
            fs.watchFile(this.configPath, (curr, prev) => {
                if (curr.mtime !== prev.mtime) {
                    try {
                        this.loadConfig();
                        this.notifyWatchers('config_reloaded', this.config);
                    } catch (error) {
                        this.notifyWatchers('config_error', error);
                    }
                }
            });
        }
    }
    get(path, defaultValue = null) {
        const keys = path.split('.');
        let value = this.config;

        for (const key of keys) {
            if (value && typeof value === 'object' && key in value) {
                value = value[key];
            } else {
                return defaultValue;
            }
        }

        return value;
    }

    set(path, value) {
        const keys = path.split('.');
        const lastKey = keys.pop();
        let target = this.config;

        for (const key of keys) {
            if (!(key in target) || typeof target[key] !== 'object') {
                target[key] = {};
            }
            target = target[key];
        }

        target[lastKey] = value;
    }

    save() {
        try {
            const configData = JSON.stringify(this.config, null, 2);
            fs.writeFileSync(this.configPath, configData, 'utf8');
        } catch (error) {
            throw new Error(`Failed to save configuration: ${error.message}`);
        }
    }

    addWatcher(callback) {
        this.watchers.push(callback);
    }

    removeWatcher(callback) {
        const index = this.watchers.indexOf(callback);
        if (index !== -1) {
            this.watchers.splice(index, 1);
        }
    }

    notifyWatchers(event, data) {
        this.watchers.forEach(watcher => {
            try {
                watcher(event, data);
            } catch (error) {
                console.error('Error in config watcher:', error);
            }
        });
    }

    getAll() {
        return { ...this.config };
    }

    isFeatureEnabled(featureName) {
        return this.get(`features.${featureName}.enabled`, false);
    }
}

module.exports = ConfigManager;
