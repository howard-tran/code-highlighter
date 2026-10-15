
import * as vscode from 'vscode';
import {Config} from './config';
import {log} from './logger';

export class Highlight {
    constructor() {
        this.selectedWords = [];
        this.selectedRanges = [];
        this.decorators = [];
        this.config = new Config();
        this.decorators = this.config.GetDecorationTypes();
    }

    public ClearWords(): void {
        log.Info('ClearWords: clearing all highlighted words');
        this.selectedWords = [];
        this.selectedRanges = [];
        this.DecorateSelectedWords();
    }

    public SelectedWords(): void {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            return;
        }
        let selectedWord = this.GetSelectedWord(editor);
        log.Info(`SelectedWords: word="${selectedWord}" file=${editor.document.uri.toString()}`);
        if (selectedWord === "") {
            return;
        }

        // 记录选中位置，用于只高亮选中处的场景
        const selectedRange = editor.selection;

        // find exist in words
        let idx = this.selectedWords.findIndex((word) => {
            return word === selectedWord;
        });
        if (idx === -1) {
            // 加入列表，先找等于''的位置
            idx = this.selectedWords.findIndex((word) => {
                return word === '';
            });
            if (idx === -1) {
                this.selectedWords.push(selectedWord);
                this.selectedRanges.push(selectedRange);
            } else {
                this.selectedWords[idx] = selectedWord;
                this.selectedRanges[idx] = selectedRange;
            }
        } else {
            // 不真正删除，赋值为''就表示删除；原因：如果删除会导致数组中位置混乱，从而导致重新着色
            this.selectedWords[idx] = '';
            this.selectedRanges[idx] = undefined;
        }

        this.DecorateSelectedWords();
    }

    public RefeshSelectedWords(): void {
        if (this.timeout) {
            clearTimeout(this.timeout);
        }
        this.timeout = setTimeout(() => {
            this.DecorateSelectedWords();
        }, 500);
    }

    public DecorateSelectedWords(): void {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            return;
        }

        let decorations: vscode.DecorationOptions[][] = [];
        this.decorators.forEach(() => {
            let decoration: vscode.DecorationOptions[] = [];
            decorations.push(decoration);
        });

        const text = editor.document.getText();
        const flags = this.config.IsIgnoreCase() ? 'gi' : 'g';
        // log.Info(`DecorateSelectedWords: file=${editor.document.uri.toString()} ` +
        //     `words=[${this.selectedWords.filter(w => w !== '').join(', ')}] ` +
        //     `wholeWord=${this.config.IsWholeWord()} ignoreCase=${this.config.IsIgnoreCase()} ` +
        //     `onlyOccurrence=${this.config.IsOnlySelectedOccurrence()} decorators=${this.decorators.length}`);
        this.selectedWords.forEach((selectedWord: string, idx: number) => {
            if (selectedWord === '') {
                return;
            }

            // 只高亮当初选中的那一处
            if (this.config.IsOnlySelectedOccurrence()) {
                const range = this.ResolveRange(editor.document, selectedWord, this.selectedRanges[idx]);
                if (range) {
                    decorations[idx % decorations.length].push({ range: range });
                }
                return;
            }

            const pattern = this.config.IsWholeWord() ? '\\b' + selectedWord + '\\b' : selectedWord;

            let matchCount = 0;
            const regEx = new RegExp(pattern, flags);
            let execArray = regEx.exec(text);
            while (execArray !== null) {
                matchCount++;
                const startPos = editor.document.positionAt(execArray.index);
                const endPos = editor.document.positionAt(execArray.index + execArray[0].length);
                const decorationPos = { range: new vscode.Range(startPos, endPos) };
                decorations[idx % decorations.length].push(decorationPos);

                execArray = regEx.exec(text);
            }
            // log.Info(`  "${selectedWord}" -> pattern="${pattern}" flags=${flags}, ${matchCount} match(es)`);
        });

        this.decorators.forEach((decorator: vscode.TextEditorDecorationType, idx: number) => {
            // log.Info(`  decorator[${idx}]: ${decorations[idx].length} range(s)`);
            editor.setDecorations(decorator, decorations[idx]);
        });
    }

    public UpdateConfig(): void {
        log.Info(`UpdateConfig: disposing ${this.decorators.length} decorator(s), reloading config`);
        this.decorators.forEach(decorator => decorator.dispose());
        this.config = new Config();
        this.decorators = this.config.GetDecorationTypes();
    }

    /**
     * 找回当初选中的范围（文本被编辑后位置可能已经变化）。
     * 返回 undefined 表示该处已不再是这个单词，跳过高亮。
     */
    private ResolveRange(document: vscode.TextDocument, escapedWord: string, range?: vscode.Range): vscode.Range | undefined {
        if (!range) {
            return undefined;
        }
        // GetSelectedWord 对正则特殊字符做了转义，这里还原成原始文本
        const rawWord = escapedWord.replace(/\\(.)/g, '$1');
        const safeRange = this.ClampRange(document, range);

        if (document.getText(safeRange) === rawWord) {
            return safeRange;
        }
        // 位置失效时，尝试取该位置上的单词范围
        const wordRange = document.getWordRangeAtPosition(safeRange.start);
        if (wordRange && document.getText(wordRange) === rawWord) {
            return wordRange;
        }
        return undefined;
    }

    private ClampRange(document: vscode.TextDocument, range: vscode.Range): vscode.Range {
        const length = document.getText().length;
        const start = Math.max(0, Math.min(document.offsetAt(range.start), length));
        const end = Math.max(start, Math.min(document.offsetAt(range.end), length));
        return new vscode.Range(document.positionAt(start), document.positionAt(end));
    }

    private GetSelectedWord(editor: vscode.TextEditor) : string {
        const select = editor.selection;
        let selectedWord = editor.document.getText(select);
        if (!selectedWord) {
            const range = editor.document.getWordRangeAtPosition(select.start);
            if (range) {
                selectedWord = editor.document.getText(range);
            }
        }

        if (!selectedWord) {
            return "";
        }

        return selectedWord.replace(/([.*+?^=!:${}()|\[\]\/\\])/g, "\\$1");
    }

    private decorators: vscode.TextEditorDecorationType[];
    private selectedWords: string[];
    private selectedRanges: (vscode.Range | undefined)[];
    private config: Config;
    private timeout: any;
}
