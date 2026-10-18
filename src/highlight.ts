
import * as vscode from 'vscode';
import {Color, Config} from './config';
import {log} from './logger';

/**
 * One highlighted word inside one file.
 * `word` is regex-escaped; `word === ''` means the slot was deleted
 * (kept in place so the remaining words don't change their color index).
 */
interface HighlightEntry {
    word: string;
    range: vscode.Range | undefined;
    colorIdx: number | undefined;
}

export class Highlight {
    constructor() {
        this.selectedByUri = new Map();
        this.decorators = [];
        this.config = new Config();
        this.decorators = this.config.GetDecorationTypes();
    }

    public ClearWords(): void {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            log.Info('ClearWords: no active editor, nothing to clear');
            return;
        }
        const uri = editor.document.uri.toString();
        log.Info(`ClearWords: clearing highlighted words of ${uri}`);
        this.selectedByUri.delete(uri);
        this.DecorateSelectedWords();
    }

    public async SelectedWords(): Promise<void> {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            return;
        }
        const uri = editor.document.uri.toString();
        const onlyOccurrence = this.config.IsOnlySelectedOccurrence();

        // Collect the (word, range) of every cursor in one pass.
        // - occurrence mode: one pick per cursor (keyed by range), so several cursors on
        //   the same word highlight several occurrences;
        // - word mode: deduped by word, so a word picked by many cursors toggles only once.
        const picks: { word: string; range: vscode.Selection }[] = [];
        const seenWords = new Set<string>();
        for (const sel of editor.selections) {
            const word = this.GetSelectedWord(editor.document, sel);
            if (word === "") {
                continue;
            }
            if (onlyOccurrence) {
                picks.push({ word, range: sel });
            } else if (!seenWords.has(word)) {
                seenWords.add(word);
                picks.push({ word, range: sel });
            }
        }
        if (picks.length === 0) {
            return;
        }
        log.Info(`SelectedWords: words=[${picks.map(p => p.word).join(', ')}] cursors=${picks.length} mode=${onlyOccurrence ? 'occurrence' : 'word'} file=${uri}`);

        const entries = this.EntriesFor(editor.document);
        let colorIdx: number | undefined = undefined;
        if (onlyOccurrence && picks.some(p => this.FindEntryByRange(entries, p.range) === -1)) {
            // Ask the user for a color index once per command trigger, and only when at
            // least one cursor actually adds a highlight; on cancel fall back to the first color
            colorIdx = await this.PickColor();
        }
        for (const { word, range } of picks) {
            this.EntryHandle(entries, word, range, colorIdx);
        }

        this.DecorateSelectedWords();
        this.DecorateSelectedWords_02();
    }

    /**
     * Toggle one (word, range) pick: add it when it is not highlighted yet,
     * empty its slot otherwise (see EmptyEntry for why slots are kept).
     */
    private EntryHandle(entries: HighlightEntry[], word: string, range: vscode.Range, colorIdx: number | undefined): void {
        let idx: number;
        if (this.config.IsOnlySelectedOccurrence()) {
            // One highlight per cursor: entries are keyed by their original range
            idx = this.FindEntryByRange(entries, range);
            if (idx === -1) {
                this.AddEntry(entries, { word: word, range: range, colorIdx: colorIdx });
                return;
            }
        } else {
            // find exist in words per entry
            idx = entries.findIndex(entry => entry.word === word);
            if (idx === -1) {
                this.AddEntry(entries, { word: word, range: range, colorIdx: undefined });
                return;
            }
        }
        this.EmptyEntry(entries, idx);
    }

    /**
     * 不真正删除，赋值为''就表示删除；原因：如果删除会导致数组中位置混乱，从而导致重新着色
     * (keep the slot so the remaining words don't change their color index).
     */
    private EmptyEntry(entries: HighlightEntry[], idx: number): void {
        entries[idx].word = '';
        entries[idx].range = undefined;
        entries[idx].colorIdx = undefined;
    }

    /** Reuse a deleted slot (word === '') when there is one, otherwise append. */
    private AddEntry(entries: HighlightEntry[], entry: HighlightEntry): void {
        const idx = entries.findIndex(e => e.word === '');
        if (idx === -1) {
            entries.push(entry);
        } else {
            entries[idx] = entry;
        }
    }

    /** Index of the entry holding exactly this range (vscode.Range.isEqual compares both positions). */
    private FindEntryByRange(entries: HighlightEntry[], range: vscode.Range): number {
        return entries.findIndex(e => e.range !== undefined && e.range.isEqual(range));
    }

    public RefreshSelectedWords(): void {
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
        const entries = this.EntriesFor(editor.document);
        entries.forEach((entry, idx: number) => {
            const selectedWord = entry.word;
            if (selectedWord === '') {
                return;
            }

            // Highlight only the originally selected occurrence
            if (this.config.IsOnlySelectedOccurrence()) {
                const range = this.ResolveRange(editor.document, selectedWord, entry.range, text.length);
                if (range) {
                    // Default to the first color; the index the user picked in highlight.selectedWords takes precedence
                    const colorIdx = entry.colorIdx;
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
        // Only the words highlighted in *this* file are decorated; every decorator is
        // overwritten below, so words of other files never leak into this editor.
        const entries = this.EntriesFor(editor.document);
        // log.Info(`DecorateSelectedWords: file=${editor.document.uri.toString()} ` +
        //     `words=[${entries.filter(e => e.word !== '').map(e => e.word).join(', ')}] ` +
        //     `wholeWord=${this.config.IsWholeWord()} ignoreCase=${this.config.IsIgnoreCase()} ` +
        //     `onlyOccurrence=${this.config.IsOnlySelectedOccurrence()} decorators=${this.decorators.length}`);
        entries.forEach((entry, idx: number) => {
            const selectedWord = entry.word;
            if (selectedWord === '') {
                return;
            }

            // Highlight only the originally selected occurrence
            if (this.config.IsOnlySelectedOccurrence()) {
                const range = this.ResolveRange(editor.document, selectedWord, entry.range, text.length);
                if (range) {
                    // Default to the first color; the index the user picked in highlight.selectedWords takes precedence
                    const colorIdx = entry.colorIdx;
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
        this.selectedByUri.clear();
        this.decorators.forEach(decorator => decorator.dispose());
        this.config = new Config();
        this.decorators = this.config.GetDecorationTypes();
    }

    /** Words highlighted in the given file, keyed by document URI. */
    private EntriesFor(document: vscode.TextDocument): HighlightEntry[] {
        const key = document.uri.toString();
        let entries = this.selectedByUri.get(key);
        if (!entries) {
            entries = [];
            this.selectedByUri.set(key, entries);
        }
        return entries;
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

    /**
     * Word of one selection (empty selection falls back to the word at its start),
     * regex-escaped. "" when there is nothing to highlight.
     */
    private GetSelectedWord(document: vscode.TextDocument, selection: vscode.Selection): string {
        let selectedWord = document.getText(selection);
        if (!selectedWord) {
            const range = document.getWordRangeAtPosition(selection.start);
            if (range) {
                selectedWord = document.getText(range);
            }
        }

        if (!selectedWord) {
            return "";
        }

        return selectedWord.replace(/([.*+?^=!:${}()|\[\]\/\\])/g, "\\$1");
    }

    // Highlight state is per file URI; the decoration types themselves are shared
    private selectedByUri: Map<string, HighlightEntry[]>;
    private decorators: vscode.TextEditorDecorationType[];
    private config: Config;
    private timeout: any;
}
