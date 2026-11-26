
import * as vscode from 'vscode';
import {Highlight} from './highlight';
import {log} from './logger';

export function activate(context: vscode.ExtensionContext) {

	log.Init(context);
	log.Info('=== extension "highlight" activated ===');
	log.Info(`vscode ${vscode.version}, storage: ${context.globalStorageUri.fsPath}`);

	let highlight: Highlight = new Highlight();

	let disposable = vscode.commands.registerCommand('highlight.selectedWords', async () => {
		log.Info('command: highlight.selectedWords');
		try {
			await highlight.SelectedWords();
		} catch (e) {
			log.Exception('highlight.selectedWords failed', e);
			throw e;
		}
	});
	context.subscriptions.push(disposable);

	disposable = vscode.commands.registerCommand('highlight.clearWords', () => {
		log.Info('command: highlight.clearWords');
		try {
			highlight.ClearWords();
		} catch (e) {
			log.Exception('highlight.clearWords failed', e);
			throw e;
		}
	});
	context.subscriptions.push(disposable);

	disposable = vscode.commands.registerCommand('highlight.toggleHighlight', async () => {
		log.Info('command: highlight.toggleHighlight');
		try {
			await highlight.ToggleHighlight();
		} catch (e) {
			log.Exception('highlight.toggleHighlight failed', e);
			throw e;
		}
	});
	context.subscriptions.push(disposable);

	disposable = vscode.commands.registerCommand('highlight.toggleOnlySelectedOccurrence', async () => {
		log.Info('command: highlight.toggleOnlySelectedOccurrence');
		try {
			await highlight.ToggleOnlySelectedOccurrence();
		} catch (e) {
			log.Exception('highlight.toggleOnlySelectedOccurrence failed', e);
			throw e;
		}
	});
	context.subscriptions.push(disposable);

	disposable = vscode.commands.registerCommand('highlight.toggleRenderStyle', async () => {
		log.Info('command: highlight.toggleRenderStyle');
		try {
			await highlight.ToggleRenderStyle();
		} catch (e) {
			log.Exception('highlight.toggleRenderStyle failed', e);
			throw e;
		}
	});
	context.subscriptions.push(disposable);

	// time of the last highlight.saveHighlights write: the file watcher must not
	// reload the file we just wrote ourselves
	let lastOwnSaveAt = 0;

	disposable = vscode.commands.registerCommand('highlight.saveHighlights', async () => {
		log.Info('command: highlight.saveHighlights');
		try {
			await highlight.SaveHighlights();
			lastOwnSaveAt = Date.now();
		} catch (e) {
			log.Exception('highlight.saveHighlights failed', e);
			throw e;
		}
	});
	context.subscriptions.push(disposable);

	disposable = vscode.commands.registerCommand('highlight.loadHighlights', async () => {
		log.Info('command: highlight.loadHighlights');
		try {
			await highlight.LoadHighlights();
		} catch (e) {
			log.Exception('highlight.loadHighlights failed', e);
			throw e;
		}
	});
	context.subscriptions.push(disposable);

	disposable = vscode.commands.registerCommand('highlight.showLog', () => {
		const filePath = log.GetFilePath();
		vscode.window.showInformationMessage(`Highlight log file: ${filePath}`);
		log.Info('command: highlight.showLog');
		// try to open the file in an editor so the user can see it immediately
		vscode.workspace.openTextDocument(filePath).then(doc => {
			vscode.window.showTextDocument(doc, {preview: false});
		}, () => { /* file may not exist yet */ });
	});
	context.subscriptions.push(disposable);

	vscode.workspace.onDidChangeTextDocument(e => {
		// log.Info(`onDidChangeTextDocument: ${e.document.uri.toString()} changes=${e.contentChanges.length}`);
		// keep the stored occurrence ranges in sync with the edit before redrawing
		
		const activeDocument = vscode.window.activeTextEditor?.document;

		if (!activeDocument || e.document !== activeDocument) return;
		
		highlight.UpdateRanges(e);
		highlight.RefreshSelectedWords(false);

		if (e.contentChanges.length <= 0) return;

		log.Info(`onDidChangeTextDocument: ${e.document.uri.toString()} changes=${e.contentChanges.length}`);
		e.contentChanges.forEach((c, i) => {
			const s = `${c.range.start.line}:${c.range.start.character}`;
			const t = `${c.range.end.line}:${c.range.end.character}`;
			const kind = c.range.isEmpty ? 'insert' : (c.text === '' ? 'delete' : 'replace');
			log.Info(`  [${i}] ${kind} (${s})-(${t}) rangeLength=${c.rangeLength}`);
			log.Info(`    text=${JSON.stringify(c.text)}`);
			const lastNl = c.text.lastIndexOf('\n');
			log.Info(`    lastNl=${lastNl}`);
			log.Info(`    lastLineLen=${c.text.length - lastNl - 1}`);
			log.Info(`    lineCount=${c.text.split('\n').length}`);
		});

	});

	vscode.window.onDidChangeActiveTextEditor(_ => {
		// log.Info(`onDidChangeActiveTextEditor: ${editor ? editor.document.uri.toString() : '<none>'}`);
		highlight.RefreshSelectedWords(false);
	});

	vscode.window.onDidChangeTextEditorSelection(_ => {
		// e.textEditor, e.selections, e.kind
		// Only background highlights need this redraw: it splits the highlight around
		// the selection so it does not cover VS Code's selection color. In "text" mode
		// there is no background, so the colored text is left untouched (and every
		// caret move does not trigger a full re-decoration).
		if (highlight.GetRenderStyle() === 'highlight') {
			highlight.RefreshSelectedWords(true);
		} else {
			highlight.RefreshSelectedWords(false);
		}
		// updateDecorations(e.textEditor); // re-apply highlight so it skips selected ranges
	});

	vscode.workspace.onDidChangeConfiguration(e => {
		if (e.affectsConfiguration('highlight.configuration')) {
			log.Info('configuration changed, reloading decorators');
			highlight.UpdateConfig();
			highlight.DecorateSelectedWords();
		}
	});

	// light themes paint the background behind the match, dark themes color the text
	// itself, so the render style follows the active theme. The write goes back to the
	// target that already defines the setting (workspace folder > workspace > global),
	// otherwise it would be shadowed; the config-change handler above then rebuilds the
	// decorators and redraws, the refresh below covers the "already set" case.
	// vscode.window.onDidChangeActiveColorTheme(async theme => {
	// 	const style = theme.kind === vscode.ColorThemeKind.Light ? 'highlight' : 'text';
	// 	log.Info(`color theme changed: kind=${theme.kind} -> renderStyle=${style}`);
	//
	// 	const section = vscode.workspace.getConfiguration('highlight');
	// 	const inspect = section.inspect<string>('configuration.renderStyle');
	// 	const current = inspect?.workspaceFolderValue ?? inspect?.workspaceValue ??
	// 		inspect?.globalValue ?? inspect?.defaultValue;
	// 	if (current !== style) {
	// 		const target = inspect?.workspaceFolderValue !== undefined ? vscode.ConfigurationTarget.WorkspaceFolder
	// 			: inspect?.workspaceValue !== undefined ? vscode.ConfigurationTarget.Workspace
	// 				: vscode.ConfigurationTarget.Global;
	// 		log.Info(`renderStyle: ${current} -> ${style} target=${vscode.ConfigurationTarget[target]}`);
	// 		try {
	// 			await section.update('configuration.renderStyle', style, target);
	// 		} catch (e) {
	// 			log.Exception('failed to update highlight.configuration.renderStyle', e);
	// 		}
	// 	}
	// 	highlight.RefreshSelectedWords(false);
	// });

	// react to external writes of `.vscode/highlight.json` (hand edits, git checkout,
	// another window, sync tools) by reloading the saved highlights
	const highlightsWatcher = vscode.workspace.createFileSystemWatcher('**/.vscode/highlight.json');
	const reloadFromWatcher = (_uri: vscode.Uri, _event: string) => {
		
	};
	// highlightsWatcher.onDidCreate(uri => reloadFromWatcher(uri, 'create'));
	// highlightsWatcher.onDidChange(uri => reloadFromWatcher(uri, 'change'));
	// highlightsWatcher.onDidDelete(uri => {
	// 	log.Info(`file watcher: delete ${uri.fsPath}`);
	// });
	context.subscriptions.push(highlightsWatcher);
	
}

// this method is called when your extension is deactivated
export function deactivate() {
	log.Info('=== extension "highlight" deactivated ===');
	log.Dispose();
}
