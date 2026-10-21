# Change Log

All notable changes to the "highlight" extension will be documented in this file.

Check [Keep a Changelog](http://keepachangelog.com/) for recommendations on how to structure this file.

## [Unreleased]

-   **Command**: Added `highlight.toggleHighlight` (ctrl+alt+F8) to turn highlighting on/off; the highlighted words are kept and come back when re-enabling.
-   **Command**: Added `highlight.toggleOnlySelectedOccurrence` to switch `highlight.configuration.onlySelectedOccurrence` between "every match" and "only the selected occurrence".
-   **Configuration**: Added `highlight.configuration.disableHighlight` (boolean, default `false`), flipped by the toggle command.

## [1.0.0] - 2025-09-27 (Forked)

Forked from [https://github.com/debugpig/vscode-extension-highlight](https://github.com/debugpig/vscode-extension-highlight)

-   **Dependencies**: Updated and fixed outdated project development dependencies.
-   **Configuration**: Added configurations for "whether to bold" (`highlight.configuration.Bold`) and "border radius" (`highlight.configuration.borderRadius`).
-   **Highlighting**: Implemented a highlighting method that maintains visual consistency in dark mode.


