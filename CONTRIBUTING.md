# Contributing

OptiFrame is an experimental open-source project. Issues and pull requests are welcome for capture reliability, measured validation, accessible mobile UX, CAD geometry, security and documentation.

1. Keep photos, face scans, credentials, model caches and build artifacts out of Git.
2. Explain the user-facing change and its physical/measurement assumptions. Do not report synthetic-test success as real-lens accuracy.
3. Add a focused test for new failure modes. Run the relevant Python or Node tests from [README.md](README.md).
4. Update the matching docs when a workflow, endpoint, model or deployment boundary changes.
5. For CAD changes, inspect the exported STL in a slicer and report the printer/profile and any physical fit evidence separately from geometry tests.

The code is MIT licensed. By contributing, you agree your contribution can be distributed under [LICENSE](LICENSE).
