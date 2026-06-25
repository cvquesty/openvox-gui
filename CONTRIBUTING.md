# Contributing to OpenVox GUI
We welcome community contributions to the OpenVox GUI project. You can help by reporting errors and typos, or by contributing new or updated features. This document describes the two main ways to contribute to the project.

## Lodging Issues
If you run into issues with the openvox-gui project, simply open an issue. We will triage issues as they come in, and attempt to fix, modify, or change the issue found, correct it and cut a release as soon as is possible. This is the best way to report issues you find.

## Opening a Pull Request
The best thing about Open Source software is you can fix it yourself and contribute it to the project. We welcome PRs from anyone interested in contributing to the project, whether it be to fix a bug or add a new feature. This is the best way to get involved with the project.

### How to Contribute
1. Fork the [openvox-gui](https://github.com/cvquesty/openvox-gui) repository.
2. Clone the repository to your local machine.
3. Create a new branch for your changes (base branch is **`main`** — there is no long-lived `staging` branch).
4. Make your changes. Prefer the friendly, beginner-readable tone used in README / INSTALL / UPDATE if you touch docs.
5. Update **CHANGELOG.md** when the change is user-visible; keep **VERSION** in sync only when maintainers cut a release (single source of truth: root `VERSION`; `scripts/bump-version.sh` propagates to frontend + ovox).
6. Commit your changes with a clear conventional-style message when possible (`fix:`, `feat:`, `docs:`).
7. Push your changes to your forked repository.
8. Open a pull request **into `main`**.

We will review the PR and merge it as soon as possible. It's that simple!

**Current stable** for comparison: see the version badge on the [README](README.md) and [Releases](https://github.com/cvquesty/openvox-gui/releases) (e.g. **3.10.2**). Report bugs with version number from the GUI footer or `curl -k https://your-server:4567/api/health`.

> If you like our project but don't have the time to contribute, that's just fine. There are other easy ways to support us and show your appreciation.
> - Star the project on GitHub
> - Tweet about the project to get the word out.
> - Refer to our project in your own project's README.
> - Mention us at local meetups, on chat boards, Slack Channels, and IRC.

---

<div align="center">

<sub>This document was created with the assistance of AI (Grok, xAI). All technical content has been reviewed and verified by human contributors.</sub>

</div>
