import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';

/**
 * Simple file logger for debugging the extension.
 *
 * Log file location (open with `tail -f <path>`):
 *   - Linux:   ~/.config/Code/logs/<YYYYMMDDHHMMSS>/exthost/highlight.log  (VS Code)
 *   - or the path printed on activation (also shown via the "Highlight" output channel)
 *
 * Set "highlight.configuration.debug": false to silence logging.
 */
export class Logger {
    private static instance: Logger | undefined;
    private stream: fs.WriteStream | undefined;
    private outputChannel: vscode.OutputChannel | undefined;
    private enabled: boolean = true;
    public filePath: string = '';

    public static Get(): Logger {
        if (!Logger.instance) {
            Logger.instance = new Logger();
        }
        return Logger.instance;
    }

    /** Call once from activate() with context.globalStorageUri so the file lives in a stable, findable place. */
    public Init(context: vscode.ExtensionContext): void {
        try {
            const dir = context.globalStorageUri.fsPath;
            fs.mkdirSync(dir, {recursive: true});
            this.filePath = path.join(dir, 'highlight.log');
            // append: true keeps history between VS Code restarts
            this.stream = fs.createWriteStream(this.filePath, {flags: 'a'});
        } catch (e) {
            // fall back to tmp
            this.filePath = path.join(require('os').tmpdir(), 'highlight-extension.log');
            try {
                this.stream = fs.createWriteStream(this.filePath, {flags: 'a'});
            } catch {
                /* give up on file logging */
            }
        }

        this.outputChannel = vscode.window.createOutputChannel('Highlight');
        this.outputChannel.appendLine(`[logger] file: ${this.filePath}`);

        vscode.workspace.onDidChangeConfiguration(e => {
            if (e.affectsConfiguration('highlight.configuration.debug')) {
                this.enabled = vscode.workspace.getConfiguration('')
                    .get<boolean>('highlight.configuration.debug', true);
                this.Info(`debug logging is now ${this.enabled ? 'ON' : 'OFF'}`);
            }
        });
    }

    public Info(message: string, ...args: unknown[]): void {
        this.Write('INFO', message, args);
    }

    public Warn(message: string, ...args: unknown[]): void {
        this.Write('WARN', message, args);
    }

    public Error(message: string, ...args: unknown[]): void {
        this.Write('ERROR', message, args);
    }

    /** Log an exception with stack trace. */
    public Exception(message: string, err: unknown): void {
        const stack = err instanceof Error ? err.stack : String(err);
        this.Write('ERROR', message, [stack]);
    }

    private Write(level: string, message: string, args: unknown[]): void {
        if (!this.enabled) {
            return;
        }
        const time = new Date().toISOString();
        const extras = args.length ? ' ' + args.map(a => {
            try {
                return typeof a === 'string' ? a : JSON.stringify(a);
            } catch {
                return String(a);
            }
        }).join(' ') : '';
        const line = `${time} [${level}] ${message}${extras}\n`;
        try {
            this.stream?.write(line);
        } catch {
            /* ignore */
        }
        this.outputChannel?.append(line);
    }

    public GetFilePath(): string {
        return this.filePath;
    }

    public Dispose(): void {
        this.stream?.end();
    }
}

export const log = Logger.Get();
