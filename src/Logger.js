class Logger {
    constructor(options = {}) {
        const defaultOptions = {
            level: 'info',   // debug | info | warn | error
            console: true
        };
        this.options = Object.assign(defaultOptions, options);
        this.levels = ['debug', 'info', 'warn', 'error'];
        this.logs = [];
    }

    get count() {
        return this.logs.length;
    }

    get entries() {
        return this.logs;
    }

    clear() {
        this.logs = [];
    }

    shouldLog(level) {
        const currentIdx = this.levels.indexOf(this.options.level);
        const levelIdx = this.levels.indexOf(level);
        return levelIdx >= currentIdx;
    }

    formatTimestamp() {
        return new Date().toLocaleString('sv');
    }

    getFileInfoFromStack() {
        const stack = new Error().stack || '';
        const parts = stack.split('\n');
        if (parts.length >= 3) {
            const match = parts[2].match(/\((.+?):(\d+):\d+\)$/);
            if (match) {
                const [, filePath, lineNumber] = match;
                return `\x1b[2m(${filePath.split(/[/\\]/).pop() + ':' + lineNumber})\x1b[0m`;
            }
        }
        return '';
    }

    log(level, message) {
        if (!this.shouldLog(level)) return;

        const timestamp = this.formatTimestamp();
        const entry = { level, message, timestamp };
        this.logs.push(entry);

        const fileInfo = this.getFileInfoFromStack();
        const consoleLine = `[${timestamp}] ${this.getLevelColor(level)}[${level.toUpperCase()}]\x1b[0m ${message} ${fileInfo}`;

        if (this.options.console) {
            console.log(consoleLine);
        }
    }

    getLevelColor(level) {
        switch (level) {
            case 'debug': return '\x1b[34m'; // blue
            case 'info': return '\x1b[36m';  // cyan
            case 'warn': return '\x1b[33m';  // yellow
            case 'error': return '\x1b[31m'; // red
            default: return '\x1b[37m';
        }
    }

    info(message) {
        this.log('info', message);
    }

    warn(message) {
        this.log('warn', message);
    }

    error(...args) {
        const message = args.map(arg => {
            if (arg instanceof Error) {
                return `${arg.message}\n${arg.stack}`;
            } else if (typeof arg === 'object') {
                try { return JSON.stringify(arg, null, 2); } catch { return String(arg); }
            } else {
                return String(arg);
            }
        }).join(' ');
        this.log('error', message);
    }

    debug(message) {
        this.log('debug', message);
    }
}

module.exports = new Logger();