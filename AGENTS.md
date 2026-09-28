# Project instructions

- Apply DRY, KISS, SOLID, YAGNI, and BDUF pragmatically. Establish the design, then deliver working vertical slices.
- Keep README.md and all project documentation in English and update them with application changes.
- Ask questions when a requirement needs clarification.
- Follow TDD for new behavior and fixes: establish a failing behavioral test first, implement the smallest complete change, then refactor with green tests. Cover relevant boundaries, invalid inputs, cancellation, partial failure and recovery; document untested hardware behavior explicitly.
- Commit and push completed, verified changes.
- Use the latest LTS release where one exists; otherwise use the latest stable release. Check the matching official documentation before adopting APIs. Document compatibility exceptions.
- Use a very compact, dark minimalist interface with Gunmetal as the primary color. Keep it distinctive but restrained, with clear selected, hover, focus and disabled states. Avoid blue chromatic accents. All primary screens and actions must fit the window without scrolling; use nested tabs and pagination for long content.
- Generate modern minimalist raster application and navigation icons. The application icon must have an opaque background; internal icons must have transparent backgrounds. Do not ship vector icons. Enable antialiasing in graphical applications. Avoid distracting backgrounds, neon effects and excessive decoration.
- Support Russian, English, Ukrainian, Korean, Japanese and Chinese localization.
- Generate original illustrations to give the interface a distinctive identity; keep production assets in the repository.
- Generate images for application and navigation icons.
- Build executable artifacts and publish versioned GitHub releases. On Windows, missing build tools may be installed with winget.
- Treat maintenance operations as explicit user actions. Do not run cleanup, registry edits, service changes, process closure, or clock writes against a developer's real machine as a test.
- Validate renderer requests in Electron and enforce target restrictions again in the Windows agent. Back up registry values and service startup modes before writes.
