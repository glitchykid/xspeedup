# Project instructions

- Apply DRY, KISS, SOLID, YAGNI, and BDUF pragmatically. Establish the design, then deliver working vertical slices.
- Keep README.md and all project documentation in English and update them with application changes.
- Ask questions when a requirement needs clarification.
- Commit and push completed, verified changes.
- Use the latest LTS release where one exists; otherwise use the latest stable release. Check the matching official documentation before adopting APIs. Document compatibility exceptions.
- Provide both light and dark interface themes, with a persistent user choice.
- Design the UI and UX in a brutalist style: strong typography, sharp geometry, bold borders, clear hierarchy, and direct controls.
- Build executable artifacts and publish versioned GitHub releases. On Windows, missing build tools may be installed with winget.
- Treat maintenance operations as explicit user actions. Do not run cleanup, registry edits, service changes, or process closure against a developer's real machine as a test.
- Validate renderer requests in Electron and enforce target restrictions again in the Windows agent. Back up registry values and service startup modes before writes.
