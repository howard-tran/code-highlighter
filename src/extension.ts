
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
		highlight.RefreshSelectedWords(true);
		// updateDecorations(e.textEditor); // re-apply highlight so it skips selected ranges
	});

	vscode.workspace.onDidChangeConfiguration(e => {
		if (e.affectsConfiguration('highlight.configuration')) {
			log.Info('configuration changed, reloading decorators');
			highlight.UpdateConfig();
			highlight.DecorateSelectedWords();
		}
	});
}

// this method is called when your extension is deactivated
export function deactivate() {
	log.Info('=== extension "highlight" deactivated ===');
	log.Dispose();
}
