
import * as vscode from 'vscode';
import {Color, Config} from './config';
import {log} from './logger';

/** Debounce delay before re-decorating after a change (ms). */
const REFRESH_TIMEOUT_MS = 50;

/** Highlight only the selected occurrence (entry keyed by its range). */
const MODE_ONLY_SELECTED_OCCURRENCE = 1;
/** Highlight every match of the word in the document (entry keyed by its word). */
const MODE_ALL_MATCHES = 2;

/**
 * One highlighted word inside one file.
 * `word` is regex-escaped; `word === ''` means the slot was deleted
 * (kept in place so the remaining words don't change their color index).
 */
interface HighlightEntry {
    word: string;
    range: vscode.Range | undefined;
    // if colorIdx is undefined, colorIdx = index of entry
    colorIdx: number | undefined;
    mode: number; // MODE_ONLY_SELECTED_OCCURRENCE or MODE_ALL_MATCHES
}

/**
 * An entry together with its index inside the file's entry list.
 * The index is kept as the fallback color index for MODE_ALL_MATCHES entries
 * (empty slots are skipped but still consume their index, so colors don't shift).
 */
interface IndexedEntry {
    entry: HighlightEntry;
    idx: number;
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
        const uri = this.KeyFor(editor.document);
        log.Info(`ClearWords: clearing highlighted words of ${uri}`);
        this.selectedByUri.delete(uri);
        this.DecorateSelectedWords();
    }

    public async SelectedWords(): Promise<void> {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            return;
        }
        // HERE
        if (this.config.IsHighlightDisabled()) {
            log.Info('SelectedWords: highlighting is disabled, enable it with highlight.toggleHighlight');
            vscode.window.showInformationMessage('Highlight: highlighting is disabled, run "Highlight: Toggle Highlighting" to enable it');
            return;
        }
        editor.selections.forEach((sel) => {
            const s = `${sel.start.line}:${sel.start.character}`;
            const t = `${sel.end.line}:${sel.end.character}`;
            log.Info(`Selected:  (${s})-(${t})`);
        });
        // const uri = editor.document.uri.toString();
        const onlyOccurrence = this.config.IsOnlySelectedOccurrence();

        // Collect the (word, range) of every cursor in one pass.
        // - occurrence mode: one pick per cursor (keyed by range), so several cursors on
        //   the same word highlight several occurrences;
        // - word mode: deduped by word, so a word picked by many cursors toggles only once.
        const picks: { word: string; range: vscode.Selection; mode: number }[] = [];
        const seenWords = new Set<string>();
        for (const sel of editor.selections) {
            const word = this.GetSelectedWord(editor.document, sel);
            if (word === "") {
                continue;
            }
            if (onlyOccurrence) {
                picks.push({ word, range: sel, mode: MODE_ONLY_SELECTED_OCCURRENCE });
            } else if (!seenWords.has(word)) {
                seenWords.add(word);
                picks.push({ word, range: sel, mode: MODE_ALL_MATCHES });
            }
        }
        if (picks.length === 0) {
            return;
        }
        log.Info(`SelectedWords: words=[${picks.map(p => p.word).join(', ')}] cursors=${picks.length} mode=${onlyOccurrence ? 'occurrence' : 'word'} file=${this.KeyFor(editor.document)}`);

        const entries = this.EntriesFor(editor.document);
        let colorIdx: number | undefined = undefined;
        if (onlyOccurrence) {
            // Ask the user for a color index once per command trigger
            // Only fired when at least in selected range do not exist in the entry list
            if (picks.some(p => this.FindEntryByRange(entries, p.range) === -1)) {
                colorIdx = await this.PickColor();
            }
        } else {
            colorIdx = entries.length;
        }

        for (const { word, range, mode } of picks) {
            this.EntryHandle(entries, word, range, colorIdx, mode);
        }

        this.DecorateSelectedWords();
        // this.DecorateSelectedWords_02();
    }

    /**
     * Flip a boolean `highlight.configuration.*` setting. The effective value comes from the
     * most specific target that defines it (workspace folder > workspace > global), so the
     * new value is written back to that same target, otherwise it would be ignored.
     * @returns the new value of the setting.
     */
    private async ToggleSetting(key: string): Promise<boolean> {
        const section = vscode.workspace.getConfiguration('highlight');
        const inspect = section.inspect<boolean>(key);
        const value = !(inspect?.workspaceFolderValue ?? inspect?.workspaceValue ??
            inspect?.globalValue ?? inspect?.defaultValue ?? false);
        const target = inspect?.workspaceFolderValue !== undefined ? vscode.ConfigurationTarget.WorkspaceFolder
            : inspect?.workspaceValue !== undefined ? vscode.ConfigurationTarget.Workspace
                : vscode.ConfigurationTarget.Global;

        log.Info(`ToggleSetting: highlight.${key}=${value} target=${vscode.ConfigurationTarget[target]}`);
        await section.update(key, value, target);
        return value;
    }

    /**
     * Turn highlighting on/off by flipping the persisted `highlight.configuration.disableHighlight`
     * setting. The setting change is picked up by onDidChangeConfiguration, which reloads the
     * config: disposing the decoration types clears what is on screen while disabled, and
     * redrawing restores the highlighted words when re-enabled (the words themselves are kept,
     * see UpdateConfig).
     * @returns true when highlighting is now disabled.
     */
    public async ToggleHighlight(): Promise<boolean> {
        const disabled = await this.ToggleSetting('configuration.disableHighlight');
        vscode.window.showInformationMessage(disabled
            ? 'Highlight: highlighting disabled'
            : 'Highlight: highlighting enabled');
        return disabled;
    }

    /**
     * Switch between highlighting every match in the document and highlighting only the
     * occurrence you selected, by flipping `highlight.configuration.onlySelectedOccurrence`;
     * the redraw is done by the configuration-change handler.
     * @returns true when only-selected-occurrence mode is now on.
     */
    public async ToggleOnlySelectedOccurrence(): Promise<boolean> {
        const onlyOccurrence = await this.ToggleSetting('configuration.onlySelectedOccurrence');
        log.Info(`ToggleOnlySelectedOccurrence: onlySelectedOccurrence=${onlyOccurrence}`);
        vscode.window.showInformationMessage(onlyOccurrence
            ? 'Highlight: now highlighting only the selected occurrence'
            : 'Highlight: now highlighting every match in the document');
        return onlyOccurrence;
    }

    /**
     * Toggle one (word, range) pick: add it when it is not highlighted yet,
     * empty its slot otherwise (see EmptyEntry for why slots are kept).
     */
    private EntryHandle(entries: HighlightEntry[], word: string, range: vscode.Range, colorIdx: number | undefined, mode: number): void {
        let idx: number;
        if (mode === MODE_ONLY_SELECTED_OCCURRENCE) {
            // One highlight per cursor: entries are keyed by their original range
            idx = this.FindEntryByRange(entries, range);
            if (idx === -1) {
                this.UpdateEntry(entries, { word: word, range: range, colorIdx: colorIdx, mode: mode });
                return;
            }
        } else {
            // find exist in words per entry
            idx = entries.findIndex(entry => entry.word === word);
            if (idx === -1) {
                this.UpdateEntry(entries, { word: word, range: range, colorIdx: colorIdx, mode: mode });
                return;
            }
        }
        // handle the else
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

    /**
     * Add the new entry, reusing a deleted slot when there is one, otherwise append.
     *
     * - highlight-only-selected-occurrence mode: a slot is reusable when its range is
     *   empty (undefined, or start === end), because the range is the identity here.
     * - otherwise: a slot is reusable when its word was emptied ('').
     */
    private UpdateEntry(entries: HighlightEntry[], entry: HighlightEntry): void {
        const idx = entry.mode === MODE_ONLY_SELECTED_OCCURRENCE
            ? entries.findIndex(e => e.range === undefined || e.range.start.isEqual(e.range.end))
            : entries.findIndex(e => e.word === '');
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

    /**
     * Invalidate the stored occurrence ranges that an edit intersects, so the remaining
     * ones still point at the originally highlighted text. Only needed in
     * highlight-only-selected-occurrence mode, where the entry's range *is* the identity
     * of the highlight.
     *
     * `change.range` is where the edit happened in the document *before* this change.
     */
    public UpdateRanges(e: vscode.TextDocumentChangeEvent): void {
        if (!this.config.IsOnlySelectedOccurrence()) {
            return;
        }
        if (e.contentChanges.length === 0) {
            return;
        }
        const entries = this.EntriesFor(e.document);
        if (!entries || entries.every(entry => entry.range === undefined)) {
            return;
        }

        // Multi-line changes shift later lines, so changes are applied from the bottom of
        // the file upwards to keep the coordinates of the not-yet-processed ones valid.
        const changes = e.contentChanges.slice().sort((a, b) =>
            b.range.start.line - a.range.start.line || b.range.start.character - a.range.start.character);

        for (const entry of entries) {
            if (entry.range === undefined) {
                continue;
            }
            let range: vscode.Range | undefined = entry.range;
            for (const change of changes) {
                range = Highlight.ShiftRange(range, change);
                if (range === undefined) {
                    break;
                }
            }
            entry.range = range;
        }
    }

    /**
     * Check one content change against the stored range:
     * let the range be (s1, e1) and the edit range be (s2, e2).
     * - s2 >= e1 (edit fully after the range) -> range unchanged
     * - e2 <= s1 (edit fully before the range) -> range shifted by the edit delta
     *   (vscode does not move stored ranges, the coordinates must be recalculated)
     * - otherwise the edit intersects the range -> undefined (the highlighted text changed)
     */
    private static ShiftRange(range: vscode.Range, change: vscode.TextDocumentContentChangeEvent): vscode.Range | undefined {
        const editStart = change.range.start;
        const editEnd = change.range.end;
        if (editStart.isAfterOrEqual(range.end)) {
            return range;
        }
        if (editEnd.isBeforeOrEqual(range.start)) {
            return new vscode.Range(
                Highlight.ShiftPosition(range.start, change),
                Highlight.ShiftPosition(range.end, change));
        }
        return undefined;
    }

    /**
     * - Given a vscode range(start, end)
     * - start, end = vscode position(line, char). line = row number, char = column number
     * - calculate the delta and update the range according to the change.
     * - 2 case covered
     *      + edit line at the same line of range's line
     *          + formula = insLine, insChar + deltaChar
     *      + edit line before range's line
     *          + formula = pos.line + deltaLine, pos.char
     */
    private static ShiftPosition(pos: vscode.Position, change: vscode.TextDocumentContentChangeEvent): vscode.Position {
        const editStart = change.range.start;
        const editEnd = change.range.end;

        const text = change.text;
        // end position of a multiline change text
        const lastNl = text.lastIndexOf('\n');
        const lineCount = text.split('\n').length - 1; // "abcd\n".split("\n") = 2;
        const leftOverNL = text.length - lastNl - 1; // leftOver("0123456\n12") = 2
        const newLine = editStart.line + lineCount;
        const newChar = editStart.character + text.length;

        const insLine = lastNl === -1 ? editStart.line : newLine;
        const insChar = lastNl === -1 ? newChar : leftOverNL;
        const deltaChar = pos.character - editEnd.character;
        const deltaLine = insLine - editEnd.line;

        if (pos.line === editEnd.line) {
            return new vscode.Position(insLine, insChar + deltaChar);
        }
        return new vscode.Position(pos.line + deltaLine, pos.character);
    }

    /**
     * Debounced redraw.
     * @param selectionRedraw true (default): highlight ranges are split around the
     *   current selections (ExcludeSelectionOffset); false: ranges are drawn as-is.
     */
    public RefreshSelectedWords(selectionRedraw: boolean = true): void {
        if (this.timeout) {
            clearTimeout(this.timeout);
        }
        this.timeout = setTimeout(() => {
            this.DecorateSelectedWords(selectionRedraw);
        }, REFRESH_TIMEOUT_MS);
    }

    /**
     * Entries of the given file that the current `highlight.configuration.onlySelectedOccurrence`
     * setting decides to draw: non-empty words whose own mode matches it, paired with their
     * index in the entry list (kept as the fallback color index, see IndexedEntry).
     * Entries of the other mode are skipped so nothing leaks in from the other setting.
     */
    private DecorableEntries(document: vscode.TextDocument): IndexedEntry[] {
        const mode = this.config.IsOnlySelectedOccurrence()
            ? MODE_ONLY_SELECTED_OCCURRENCE
            : MODE_ALL_MATCHES;
        return this.EntriesFor(document)
            .map((entry, idx) => ({ entry, idx }))
            .filter(({ entry }) => entry.word !== '' && entry.mode === mode);
    }

    /**
     * Fill `decorations` for MODE_ONLY_SELECTED_OCCURRENCE entries: the stored range *is*
     * the identity of the highlight, so it is drawn directly. ResolveRange only recovers it
     * when later edits shifted the positions (Not needed since we have UpdateRanges, but the
     * clamp does not cost much performance).
     */
    private DecorateOnlySelectedOccurrences(
        editor: vscode.TextEditor,
        entries: IndexedEntry[],
        decorations: vscode.DecorationOptions[][],
        text: string): void {
        for (const { entry } of entries) {
            const range = this.ResolveRange(editor.document, entry.word, entry.range, text.length);
            if (!range) {
                continue;
            }
            // Default to the first color; the index the user picked in highlight.selectedWords takes precedence
            const colorIdx = entry.colorIdx;
            const color = colorIdx !== undefined && colorIdx >= 0 && colorIdx < decorations.length
                ? colorIdx
                : 0;
            decorations[color].push({ range: range });
        }
    }

    /**
     * Fill `decorations` for MODE_ALL_MATCHES entries: every occurrence of the word in the
     * document is decorated.
     * @param preferEntryColor true (DecorateSelectedWords_02): use the entry's picked color
     *   when set, falling back to the entry index; false (DecorateSelectedWords): always the
     *   entry index.
     */
    private DecorateAllMatches(
        editor: vscode.TextEditor,
        entries: IndexedEntry[],
        decorations: vscode.DecorationOptions[][],
        text: string,
        preferEntryColor: boolean = false): void {
        const flags = this.config.IsIgnoreCase() ? 'giu' : 'gu';
        for (const { entry, idx } of entries) {
            // \b is based on ASCII \w, so non-ASCII letters (e.g. Vietnamese Đ) are not word characters and \bĐảng\b would fail; use Unicode-aware lookaround instead
            const pattern = this.config.IsWholeWord()
                ? '(?<![\\p{L}\\p{N}_])' + entry.word + '(?![\\p{L}\\p{N}_])'
                : entry.word;
            const color = preferEntryColor ? (entry.colorIdx ?? idx) : idx;

            const regEx = new RegExp(pattern, flags);
            let execArray = regEx.exec(text);
            while (execArray !== null) {
                const startPos = editor.document.positionAt(execArray.index);
                const endPos = editor.document.positionAt(execArray.index + execArray[0].length);
                decorations[color % decorations.length].push({ range: new vscode.Range(startPos, endPos) });

                execArray = regEx.exec(text);
            }
        }
    }

    /**
     * For debugging.
     * @param selectionRedraw same meaning as in DecorateSelectedWords.
     */
    public DecorateSelectedWords_02(selectionRedraw: boolean = true): void {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            return;
        }
        // nothing is drawn while highlighting is disabled
        if (this.decorators.length === 0 || this.config.IsHighlightDisabled()) {
            return;
        }

        let decorations: vscode.DecorationOptions[][] = [];
        this.decorators.forEach(() => {
            let decoration: vscode.DecorationOptions[] = [];
            decorations.push(decoration);
        });

        const text = editor.document.getText();
        const entries = this.DecorableEntries(editor.document);
        if (this.config.IsOnlySelectedOccurrence()) {
            this.DecorateOnlySelectedOccurrences(editor, entries, decorations, text);
        } else {
            // _02 prefers the color picked by the user over the entry index
            this.DecorateAllMatches(editor, entries, decorations, text, true);
        }

        this.decorators.forEach((decorator: vscode.TextEditorDecorationType, idx: number) => {
            // log.Info(`  decorator[${idx}]: ${decorations[idx].length} range(s)`);
            if (selectionRedraw) {
                editor.setDecorations(decorator, this.ExcludeSelectionOffset(editor, decorations[idx]));
            } else {
                editor.setDecorations(decorator, decorations[idx]);
            }
        });
    }

    /**
     * @param selectionRedraw true (default): highlight ranges are split around the
     *   current selections (ExcludeSelectionOffset) so they don't interfere with the
     *   default selection color; false: ranges are drawn as-is.
     */
    public DecorateSelectedWords(selectionRedraw: boolean = true): void {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            return;
        }
        // nothing is drawn while highlighting is disabled
        if (this.decorators.length === 0 || this.config.IsHighlightDisabled()) {
            return;
        }

        let decorations: vscode.DecorationOptions[][] = [];
        this.decorators.forEach(() => {
            let decoration: vscode.DecorationOptions[] = [];
            decorations.push(decoration);
        });

        const text = editor.document.getText();
        const entries = this.DecorableEntries(editor.document);
        // log.Info(`DecorateSelectedWords: file=${editor.document.uri.toString()} ` +
        //     `words=[${entries.map(e => e.entry.word).join(', ')}] ` +
        //     `wholeWord=${this.config.IsWholeWord()} ignoreCase=${this.config.IsIgnoreCase()} ` +
        //     `onlyOccurrence=${this.config.IsOnlySelectedOccurrence()} decorators=${this.decorators.length}`);
        if (this.config.IsOnlySelectedOccurrence()) {
            this.DecorateOnlySelectedOccurrences(editor, entries, decorations, text);
        } else {
            this.DecorateAllMatches(editor, entries, decorations, text);
        }

        this.decorators.forEach((decorator: vscode.TextEditorDecorationType, idx: number) => {
            // log.Info(`  decorator[${idx}]: ${decorations[idx].length} range(s)`);
            if (selectionRedraw) {
                editor.setDecorations(decorator, this.ExcludeSelectionOffset(editor, decorations[idx]));
            } else {
                editor.setDecorations(decorator, decorations[idx]);
            }
        });
    }

    public UpdateConfig(): void {
        log.Info(`UpdateConfig: disposing ${this.decorators.length} decorator(s), reloading config`);
        // this.selectedByUri.clear();
        this.decorators.forEach(decorator => decorator.dispose());
        this.config = new Config();
        this.decorators = this.config.GetDecorationTypes();
    }

    /**
     * Map key for `selectedByUri`: the path relative to the workspace folder
     * (e.g. `Untitled-2.ini` for a file at the workspace root, no parent folder
     * prefixed), falling back to the full path for files outside the workspace.
     */
    private KeyFor(document: vscode.TextDocument): string {
        return vscode.workspace.asRelativePath(document.uri, false);
    }

    /** Words highlighted in the given file, keyed by document URI. */
    private EntriesFor(document: vscode.TextDocument): HighlightEntry[] {
        const key = this.KeyFor(document);
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

    /**
     * Rebuild decoration ranges so none of them overlaps the current selection(s),
     * which would be hidden behind VS Code's default selection color.
     * Done as interval subtraction on document offsets: every decoration range is
     * split around the selections it intersects, keeping only the non-empty forward
     * pieces before/between/after them.
     */
    private ExcludeSelectionOffset(editor: vscode.TextEditor, decorations: vscode.DecorationOptions[]): vscode.DecorationOptions[] {
        const document = editor.document;
        // Empty selections are just a caret; they never cover any text, so skip them
        const excluded = editor.selections
            .filter(sel => !sel.isEmpty)
            .map(sel => [document.offsetAt(sel.start), document.offsetAt(sel.end)] as [number, number]);
        if (excluded.length === 0) {
            return decorations;
        }

        const result: vscode.DecorationOptions[] = [];
        for (const decoration of decorations) {
            const start = document.offsetAt(decoration.range.start);
            const end = document.offsetAt(decoration.range.end);
            if (start >= end) {
                continue; // empty range, nothing to draw anyway
            }

            // Selections intersecting this range, sorted and clipped to it
            const cuts = excluded
                .map(([selStart, selEnd]): [number, number] => [Math.max(selStart, start), Math.min(selEnd, end)])
                .filter(([selStart, selEnd]) => selStart < selEnd)
                .sort((a, b) => a[0] - b[0]);

            let cursor = start;
            for (const [selStart, selEnd] of cuts) {
                if (selStart > cursor) {
                    result.push({
                        ...decoration,
                        range: new vscode.Range(document.positionAt(cursor), document.positionAt(selStart))
                    });
                }
                cursor = Math.max(cursor, selEnd);
            }
            if (cursor < end) {
                result.push({
                    ...decoration,
                    range: new vscode.Range(document.positionAt(cursor), document.positionAt(end))
                });
            }
        }
        return result;
    }

    /**
     * Same goal as ExcludeSelectionOffset, but implemented by splitting the range
     * around each intersecting selection: [sel.end -> range.end] and
     * [range.start -> sel.start]. A piece that would be backward (the selection
     * covers or extends past that side) is skipped instead of being pushed.
     */
    private ExcludeSelectionRange(editor: vscode.TextEditor, decorations: vscode.DecorationOptions[]): vscode.DecorationOptions[] {
        const result: vscode.DecorationOptions[] = [];
        for (const decoration of decorations) {
            const range = decoration.range;
            let split = false;
            editor.selections.forEach((sel) => {
                if (this.IsIntersect(range, sel)) {
                    split = true;
                    if (sel.end.isBefore(range.end)) {
                        result.push({ ...decoration, range: new vscode.Range(sel.end, range.end) });
                    }
                    if (range.start.isBefore(sel.start)) {
                        result.push({ ...decoration, range: new vscode.Range(range.start, sel.start) });
                    }
                }
            });
            if (!split) {
                result.push(decoration);
            }
        }
        return result;
    }

    private IsIntersect(range1: vscode.Range, range2: vscode.Range): boolean {
        return range1.start.isBeforeOrEqual(range2.end) && range2.start.isBeforeOrEqual(range1.end);
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
