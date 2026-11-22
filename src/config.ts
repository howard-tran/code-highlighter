
import * as vscode from 'vscode';
import {log} from './logger';

export interface Color {
    /** 可选的颜色名（来自配置项，例如 "red-1"） */
    name?: string;
    light: string;
    dark: string;
    /** renderStyle === "text" 时 light 主题用的颜色，省略则回退到 light */
    textLight?: string;
    /** renderStyle === "text" 时 dark 主题用的颜色，省略则回退到 dark */
    textDark?: string;
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

        // "highlight": background color behind the text; "text": color the text itself
        const renderStyleConfig = config.get<string>('highlight.configuration.renderStyle');
        this.renderStyle = renderStyleConfig === 'text' ? 'text' : 'highlight';

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
            const textOnly = this.renderStyle === 'text';
            colors.forEach((color: Color) => {
                const fontWeight = this.isBold ? 'bold' : 'normal';
                // text mode may carry its own (usually darker/more readable) colors,
                // falling back to the background-mode pair when none are configured
                const lightValue = textOnly ? (color.textLight ?? color.light) : color.light;
                const darkValue = textOnly ? (color.textDark ?? color.dark) : color.dark;
                const light: vscode.ThemableDecorationRenderOptions = {
                    overviewRulerColor: lightValue,
                    fontWeight: fontWeight
                };
                const dark: vscode.ThemableDecorationRenderOptions = {
                    overviewRulerColor: darkValue,
                    fontWeight: fontWeight
                };
                if (textOnly) {
                    // color the text itself, no background
                    light.color = lightValue;
                    dark.color = darkValue;
                } else {
                    light.backgroundColor = color.light;
                    light.borderRadius = this.borderRadius;
                    light.color = "#000000";
                    dark.backgroundColor = color.dark;
                    dark.borderRadius = this.borderRadius;
                    // keep the text readable on top of the dark background color
                    dark.color = '#ffffff';
                }
                let decorationType = vscode.window.createTextEditorDecorationType({
                    overviewRulerLane: vscode.OverviewRulerLane.Right,
                    light: light,
                    dark: dark
                });
                this.decorationTypes.push(decorationType);
            });
        }

        log.Info(`Config loaded: wholeWord=${this.wholeWord} ignoreCase=${this.ignoreCase} ` +
            `bold=${this.isBold} borderRadius=${this.borderRadius} renderStyle=${this.renderStyle} ` +
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

    /**
     * How matches are drawn: `'text'` colors the text itself, `'highlight'`
     * (default) paints a background color behind it.
     */
    public GetRenderStyle(): string {
        return this.renderStyle;
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
    private renderStyle: string;
    private onlySelectedOccurrence: boolean;
    private disableHighlight: boolean;
    private decorationTypes: vscode.TextEditorDecorationType[];
    private colors: Color[];
}
