# Bundled Answer Studio

This directory is a locally maintained fork of `@petechu/pi-answer-studio` 0.1.2. It is bundled into `herdr-answer-studio`; the repository no longer depends on the npm package.

Local behavior differences:

- A single visible question stays in Pi's normal conversation/editor flow and does not invoke the extraction model; Answer Studio renders only for questionnaire-like prompts.
- Herdr's blocked notification for a questionnaire is delayed until extraction has produced the questions and the Studio UI is ready.
- While the custom text editor is active, unmodified left/right arrows move the text cursor.
- While choices are active instead of the text editor, left/right arrows still change questions.
- `Tab` and `Shift+Tab` continue to change questions.
- The AI compatibility import targets `@earendil-works/pi-ai/compat` for the Pi version used by this package.

See `../answer-studio.LICENSE` for source attribution and license terms.
