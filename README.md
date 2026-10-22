# README

This extension highlights selected words.

## Features

-   Supports highlighting/unhighlighting selected words (shift+F8)

    ![Supports highlighting/unhighlighting selected words](./resource/highlight_add_remove.gif)

-   Supports clearing all highlighted words (ctrl+shift+F8)

    ![Supports clearing all highlighted words](./resource/highlight_remove_all.gif)

-   Supports toggling highlighting on/off without losing the highlighted words (ctrl+alt+F8)

-   Supports toggling "only selected occurrence" mode (command: Highlight: Toggle Only Selected Occurrence)

-   Supports saving the highlighted words to `.vscode/highlight.words.json` and reloading them later
    (commands: Highlight: Save Highlighted Words to File / Highlight: Load Highlighted Words from File)

## Extension Settings

*   `highlight.configuration.wholeWord`: Whether to highlight whole words only. (boolean, default: `true`)
*   `highlight.configuration.ignoreCase`: Whether to ignore case when highlighting. (boolean, default: `false`)
*   `highlight.configuration.Bold`: Whether the highlighted text should be bold. (boolean, default: `true`)
*   `highlight.configuration.borderRadius`: Border radius of the highlight. (string, default: `"5px"`)
*   `highlight.configuration.onlySelectedOccurrence`: Highlight only the occurrence you selected instead of every match in the document. (boolean, default: `false`)
*   `highlight.configuration.colors`: Colors used for highlighting. (array)
*   `highlight.configuration.disableHighlight`: Turn highlighting off without losing the highlighted words. (boolean, default: `false`)

## Known Issues

N/A

## Release Notes

### 1.0.0 (Forked)

-   **Dependencies**: Updated and fixed outdated project development dependencies.
-   **Configuration**: Added configurations for "whether to bold" (`highlight.configuration.Bold`) and "border radius" (`highlight.configuration.borderRadius`).
-   **Highlighting**: Implemented a highlighting method that maintains visual consistency in dark mode.

## Reference

Reference list:
- https://github.com/debugpig/vscode-extension-highlight
- https://github.com/rsbondi/highlight-words

**Enjoy!**
