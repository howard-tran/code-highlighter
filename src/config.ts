
import * as vscode from 'vscode';
import {log} from './logger';

export interface Color {
    /** 可选的颜色名（来自配置项，例如 "red-1"） */
    name?: string;
    light: string;
    dark: string;
}

export class Config {
    constructor() {
        let config = vscode.workspace.getConfiguration('');
        const wholeWordConfig = config.get<boolean>('highlight.configuration.wholeWord');
        this.wholeWord = wholeWordConfig === undefined ? true : wholeWordConfig;

        const ignoreCaseConfig = config.get<boolean>('highlight.configuration.ignoreCase');
        this.ignoreCase = ignoreCaseConfig === undefined ? true : ignoreCaseConfig;

        const isBoldConfig = config.get<boolean>('highlight.configuration.Bold');
        this.isBold = isBoldConfig === undefined ? true : isBoldConfig;

        const borderRadiusConfig = config.get<string>('highlight.configuration.borderRadius');
        this.borderRadius = borderRadiusConfig === undefined ? '5px' : borderRadiusConfig;

        const onlyOccurrenceConfig = config.get<boolean>('highlight.configuration.onlySelectedOccurrence');
        this.onlySelectedOccurrence = onlyOccurrenceConfig === undefined ? false : onlyOccurrenceConfig;

        // when true nothing is drawn; flipped by the highlight.toggleHighlight command
        const disableConfig = config.get<boolean>('highlight.configuration.disableHighlight');
        this.disableHighlight = disableConfig === undefined ? false : disableConfig;

        // 获取所有颜色
        this.decorationTypes = [];
        const colors = config.get<Color[]>('highlight.configuration.colors');
        this.colors = colors ? colors : [];

        if (colors) {
            colors.forEach((color: Color) => {
                let decorationType = vscode.window.createTextEditorDecorationType({
                    overviewRulerLane: vscode.OverviewRulerLane.Right,
                    light: {
                        overviewRulerColor: color.light,
                        backgroundColor: color.light,
                        fontWeight: this.isBold ? 'bold' : 'normal',
                        borderRadius: this.borderRadius
                    },
                    dark: {
                        overviewRulerColor: color.dark,
                        backgroundColor: color.dark,
                        color: '#ffffff',
                        fontWeight: this.isBold ? 'bold' : 'normal',
                        borderRadius: this.borderRadius
                    }
                });
                this.decorationTypes.push(decorationType);
            });
        }

        log.Info(`Config loaded: wholeWord=${this.wholeWord} ignoreCase=${this.ignoreCase} ` +
            `bold=${this.isBold} borderRadius=${this.borderRadius} ` +
            `onlySelectedOccurrence=${this.onlySelectedOccurrence} disableHighlight=${this.disableHighlight} colors=${this.decorationTypes.length}`);
    }

    public IsIgnoreCase(): boolean {
        return this.ignoreCase;
    }

    public IsWholeWord(): boolean {
        return this.wholeWord;
    }

    public IsOnlySelectedOccurrence(): boolean {
        return this.onlySelectedOccurrence;
    }

    /** Highlighting is off (`highlight.configuration.disableHighlight`). */
    public IsHighlightDisabled(): boolean {
        return this.disableHighlight;
    }

    public GetDecorationTypes(): vscode.TextEditorDecorationType[] {
        // 只高亮选中处时也需要全部颜色（用户可以挑一个），所以始终返回全部
        return this.decorationTypes;
    }

    public GetColors(): Color[] {
        return this.colors;
    }

    private wholeWord: boolean;
    private ignoreCase: boolean;
    private isBold: boolean;
    private borderRadius: string;
    private onlySelectedOccurrence: boolean;
    private disableHighlight: boolean;
    private decorationTypes: vscode.TextEditorDecorationType[];
    private colors: Color[];
}
