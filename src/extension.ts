
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

	vscode.workspace.onDidChangeTextDocument(_ => {
		// log.Info(`onDidChangeTextDocument: ${e.document.uri.toString()}`);
		highlight.RefreshSelectedWords();
	});

	vscode.window.onDidChangeActiveTextEditor(_ => {
		// log.Info(`onDidChangeActiveTextEditor: ${editor ? editor.document.uri.toString() : '<none>'}`);
		highlight.DecorateSelectedWords();
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
