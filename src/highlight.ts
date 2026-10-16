
import * as vscode from 'vscode';
import {Color, Config} from './config';
import {log} from './logger';

export class Highlight {
    constructor() {
        this.selectedWords = [];
        this.selectedRanges = [];
        this.selectedColorIdx = undefined;
        this.decorators = [];
        this.config = new Config();
        this.decorators = this.config.GetDecorationTypes();
    }

    public ClearWords(): void {
        log.Info('ClearWords: clearing all highlighted words');
        this.selectedWords = [];
        this.selectedRanges = [];
        this.selectedColorIdx = undefined;
        this.DecorateSelectedWords();
    }

    public async SelectedWords(): Promise<void> {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            return;
        }
        let selectedWord = this.GetSelectedWord(editor);
        log.Info(`SelectedWords: word="${selectedWord}" file=${editor.document.uri.toString()}`);
        if (selectedWord === "") {
            return;
        }

        // Record the selected range, used by the highlight-only-selected-occurrence mode
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
            if (this.config.IsOnlySelectedOccurrence()) {
                // Ask the user for a color index on every command trigger; on cancel fall back to the first color
                this.selectedColorIdx = await this.PickColor();
            }
        } else {
            // 不真正删除，赋值为''就表示删除；原因：如果删除会导致数组中位置混乱，从而导致重新着色
            this.selectedWords[idx] = '';
            this.selectedRanges[idx] = undefined;
        }

        this.DecorateSelectedWords();
        this.DecorateSelectedWords_02();
    }

    public RefeshSelectedWords(): void {
        if (this.timeout) {
            clearTimeout(this.timeout);
        }
        this.timeout = setTimeout(() => {
            this.DecorateSelectedWords();
        }, 500);
    }

    // For debugging
    public DecorateSelectedWords_02(): void {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            return;
        }
        if (this.decorators.length === 0) {
            return;
        }

        let decorations: vscode.DecorationOptions[][] = [];
        this.decorators.forEach(() => {
            let decoration: vscode.DecorationOptions[] = [];
            decorations.push(decoration);
        });

        const text = editor.document.getText();
        const flags = this.config.IsIgnoreCase() ? 'giu' : 'gu';
        // log.Info(`DecorateSelectedWords: file=${editor.document.uri.toString()} ` +
        //     `words=[${this.selectedWords.filter(w => w !== '').join(', ')}] ` +
        //     `wholeWord=${this.config.IsWholeWord()} ignoreCase=${this.config.IsIgnoreCase()} ` +
        //     `onlyOccurrence=${this.config.IsOnlySelectedOccurrence()} decorators=${this.decorators.length}`);
        this.selectedWords.forEach((selectedWord: string, idx: number) => {
            if (selectedWord === '') {
                return;
            }

            // Highlight only the originally selected occurrence
            if (this.config.IsOnlySelectedOccurrence()) {
                const range = this.ResolveRange(editor.document, selectedWord, this.selectedRanges[idx], text.length);
                if (range) {
                    // Default to the first color; the index the user picked in highlight.selectedWords takes precedence
                    const colorIdx = this.selectedColorIdx;
                    if (colorIdx !== undefined && colorIdx >= 0 && colorIdx < decorations.length) {
                        decorations[colorIdx].push({ range: range });
                    } else {
                        decorations[0].push({ range: range });
                    }
                }
                return;
            }

            // \b is based on ASCII \w, so non-ASCII letters (e.g. Vietnamese Đ) are not word characters and \bĐảng\b would fail; use Unicode-aware lookaround instead
            const pattern = this.config.IsWholeWord()
                ? '(?<![\\p{L}\\p{N}_])' + selectedWord + '(?![\\p{L}\\p{N}_])'
                : selectedWord;

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
            log.Info(`  "${selectedWord}" -> pattern="${pattern}" flags=${flags}, ${matchCount} match(es)`);
        });

        this.decorators.forEach((decorator: vscode.TextEditorDecorationType, idx: number) => {
            log.Info(`  decorator[${idx}]: ${decorations[idx].length} range(s)`);
            editor.setDecorations(decorator, decorations[idx]);
        });
    }

    public DecorateSelectedWords(): void {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            return;
        }
        if (this.decorators.length === 0) {
            return;
        }

        let decorations: vscode.DecorationOptions[][] = [];
        this.decorators.forEach(() => {
            let decoration: vscode.DecorationOptions[] = [];
            decorations.push(decoration);
        });

        const text = editor.document.getText();
        const flags = this.config.IsIgnoreCase() ? 'giu' : 'gu';
        // log.Info(`DecorateSelectedWords: file=${editor.document.uri.toString()} ` +
        //     `words=[${this.selectedWords.filter(w => w !== '').join(', ')}] ` +
        //     `wholeWord=${this.config.IsWholeWord()} ignoreCase=${this.config.IsIgnoreCase()} ` +
        //     `onlyOccurrence=${this.config.IsOnlySelectedOccurrence()} decorators=${this.decorators.length}`);
        this.selectedWords.forEach((selectedWord: string, idx: number) => {
            if (selectedWord === '') {
                return;
            }

            // Highlight only the originally selected occurrence
            if (this.config.IsOnlySelectedOccurrence()) {
                const range = this.ResolveRange(editor.document, selectedWord, this.selectedRanges[idx], text.length);
                if (range) {
                    // Default to the first color; the index the user picked in highlight.selectedWords takes precedence
                    const colorIdx = this.selectedColorIdx;
                    if (colorIdx !== undefined && colorIdx >= 0 && colorIdx < decorations.length) {
                        decorations[colorIdx].push({ range: range });
                    } else {
                        decorations[0].push({ range: range });
                    }
                }
                return;
            }

            // \b is based on ASCII \w, so non-ASCII letters (e.g. Vietnamese Đ) are not word characters and \bĐảng\b would fail; use Unicode-aware lookaround instead
            const pattern = this.config.IsWholeWord()
                ? '(?<![\\p{L}\\p{N}_])' + selectedWord + '(?![\\p{L}\\p{N}_])'
                : selectedWord;

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
        this.selectedWords = [];
        this.selectedRanges = [];
        this.selectedColorIdx = undefined;
        this.decorators.forEach(decorator => decorator.dispose());
        this.config = new Config();
        this.decorators = this.config.GetDecorationTypes();
    }

    /**
     * Recover the originally selected range (positions may have shifted after edits).
     * Returns undefined when that spot no longer holds the word, skipping the highlight.
     */
    private ResolveRange(document: vscode.TextDocument, escapedWord: string, range: vscode.Range | undefined, textLength: number): vscode.Range | undefined {
        if (!range) {
            return undefined;
        }
        // GetSelectedWord escaped the regex special characters; restore the raw text here
        const rawWord = escapedWord.replace(/\\(.)/g, '$1');
        const safeRange = this.ClampRange(document, range, textLength);

        if (document.getText(safeRange) === rawWord) {
            return safeRange;
        }
        // Position is stale; try the word range at that position
        const wordRange = document.getWordRangeAtPosition(safeRange.start);
        if (wordRange && document.getText(wordRange) === rawWord) {
            return wordRange;
        }
        return undefined;
    }

    // textLength is passed in by the caller (which already has text) to avoid getText() copying the whole document every call
    private ClampRange(document: vscode.TextDocument, range: vscode.Range, textLength: number): vscode.Range {
        const start = Math.max(0, Math.min(document.offsetAt(range.start), textLength));
        const end = Math.max(start, Math.min(document.offsetAt(range.end), textLength));
        return new vscode.Range(document.positionAt(start), document.positionAt(end));
    }

    /**
     * In highlight-only-selected-occurrence mode, let the user pick a color for this word
     * (asked every time highlight.selectedWords is triggered).
     * Returns undefined when cancelled, using the default first color.
     */
    private async PickColor(): Promise<number | undefined> {
        if (!this.config.IsOnlySelectedOccurrence()) {
            return undefined;
        }
        const colors = this.config.GetColors();
        if (colors.length === 0) {
            return undefined;
        }

        const items: vscode.QuickPickItem[] = colors.map((color: Color, i: number) => ({
            label: color.name ? `${color.name}` : `Color ${i + 1}`,
            description: `${color.light} / ${color.dark}`
        }));
        const picked = await vscode.window.showQuickPick(items, { placeHolder: 'Pick a highlight color' });
        if (!picked) {
            return undefined;
        }
        const idx = items.indexOf(picked);
        return idx >= 0 ? idx : undefined;
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
    private selectedColorIdx: number | undefined;
    private config: Config;
    private timeout: any;
}
