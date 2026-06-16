# openvox-gui [VERSION] -- Announcement Copy (TEMPLATE)

> **Release:** v[VERSION] (current download) -- [one-sentence summary of what this stable release delivers].
> **Generated:** [YYYY-MM-DD]
> **Canonical URLs:**
> - Repo: https://github.com/cvquesty/openvox-gui
> - Latest release: https://github.com/cvquesty/openvox-gui/releases/latest
> - v[VERSION] release notes (current): https://github.com/cvquesty/openvox-gui/releases/tag/v[VERSION]
> - [Link to any dedicated feature doc if the release has one, e.g. INSTALLER.md]
> - Upgrade note: https://github.com/cvquesty/openvox-gui/blob/main/UPDATE.md

## How to use this file

Each section below is calibrated to one platform's voice, length limits, and markdown dialect. Copy the contents of the fenced code block under each heading and paste into the target surface.

The internal pre-release train details (e.g. vX.Y.Z-dev.N) are intentionally **not** mentioned in any of the public copy -- the CHANGELOG carries the full audit trail for anyone who looks; community announcements lead with the feature and user story.

| # | Platform | Length | Tone | Markdown? |
|---|----------|--------|------|-----------|
| 1 | GitHub Discussions (canonical) | Long | Formal, polished | Yes (GFM) |
| 2 | VoxPupuli Connect (Discourse) | Medium | Conversational | Yes |
| 3 | VoxPupuli Slack | Short | Casual, link-heavy | Slack syntax |
| 4 | Reddit r/sysadmin / r/Puppet | Medium | "I built this" | Yes |
| 5 | Mastodon (Fosstodon, hachyderm) | 1 toot, ~470 chars | Factual + hashtags | Plain |
| 6 | X / Twitter | 3-tweet thread, ~270 chars each | Punchy | Plain |
| 7 | LinkedIn | Medium, story-shaped | Professional | Plain |
| 8 | Hacker News (Show HN) | Title + first comment | Technical, no marketing | Plain |

---

## 1. GitHub Discussions -- Announcement post

Best home for the canonical announcement. Pin it.

### Title

```
openvox-gui [VERSION] -- [Short headline, e.g. Live Inventory Reporting]
```

### Body

````markdown
# openvox-gui [VERSION] is out

[Opening paragraph introducing the release and the main user benefit. Mention current download v[VERSION] and link to Releases page.]

## [Headline Feature Name] (the headline)

[Detailed but accessible explanation of the new capability. Include code examples, before/after, or key UI/behavior points. Quote exact columns, commands, or important details from the CHANGELOG/feature work.]

[Call out any major bug fixes, security items, or polish that landed with the release.]

## Upgrading

```bash
sudo /opt/openvox-gui/scripts/update_local.sh
```

[Or note the normal remote deploy process. Mention any special notes from UPDATE.md.]

Full release notes: [v[VERSION]](https://github.com/cvquesty/openvox-gui/releases/tag/v[VERSION]).

Issues / feedback / PRs all welcome.
````

---

## 2. VoxPupuli Connect (Discourse forum)

Slightly less formal than the GitHub post, conversational opener.

### Title

```
[Release] openvox-gui [VERSION] -- [concise headline]
```

### Body

````markdown
Just shipped openvox-gui [VERSION]. [One or two sentences on the big thing(s) in this release.]

**1. [Headline feature].** [Short description + key benefits + one-line example if applicable. Link to any dedicated docs.]

**2. [Secondary items if space: fixes, prior train work, etc.]**

Repo + release notes: https://github.com/cvquesty/openvox-gui/releases/latest
[Link to feature docs if relevant]

Feedback welcome -- happy to iterate based on what folks need.
````

---

## 3. VoxPupuli Slack (any open channel -- `#openvox`, `#general`, `#announcements`)

Slack syntax (`*bold*`, `_italic_`).

````
*openvox-gui [VERSION] is out* -- [punchy one-liner on the main feature].

[One or two more lines with the essential details or commands.]

Releases: https://github.com/cvquesty/openvox-gui/releases/latest
[Feature docs link if any]
````

---

## 4. Reddit r/sysadmin and/or r/Puppet

Reddit favors honest, "I built this and here's what changed" framing. Avoid marketing-speak.

### Title (works for r/Puppet, r/sysadmin, r/devops)

```
[Release] openvox-gui [VERSION] -- [descriptive title for the new audience]
```

### Body

````markdown
Maintainer here. Just cut the [VERSION] release of [openvox-gui](https://github.com/cvquesty/openvox-gui) -- the open-source web GUI for managing an OpenVox (the open-source Puppet fork) installation. [Brief context sentence].

**[Headline feature].** [Explain the value and the implementation highlights in plain language. Include a code block for the key example or describe the UI precisely.]

[Call out fixes or other notable items.]

Apache-2.0 licensed. Repo: https://github.com/cvquesty/openvox-gui

Happy to answer questions or take feedback in the thread.
````

---

## 5. Mastodon (sysadmin / DevOps community -- Fosstodon, hachyderm.io)

Single toot, ~470 chars, hashtags at the end.

````
openvox-gui [VERSION] just shipped. [Concise description of the headline feature and key behaviors or benefits.]

[One supporting sentence about polish, fixes, or related work.]

https://github.com/cvquesty/openvox-gui/releases/latest

#OpenVox #Puppet #DevOps #SysAdmin
````

---

## 6. X / Twitter (3-tweet thread, ~270 chars each)

### Tweet 1 (anchor)

````
openvox-gui [VERSION] just shipped -- [core promise of the release].

[Key example or behavior in 1-2 lines.]
````

### Tweet 2

````
[Supporting details: columns, technical approach, illustration name if relevant, fixes, etc.]
````

### Tweet 3 (CTA)

````
[Call to action + links. Mention license or compatibility.]

Releases: https://github.com/cvquesty/openvox-gui/releases/latest
[Docs link]
````

---

## 7. LinkedIn

Professional, story-shaped. Good fit for the SS Consulting Group identity.

````
Shipped openvox-gui [VERSION] today.

[One paragraph introducing openvox-gui for readers who may not know it, tying it to OpenVox / community Puppet.]

[Paragraph on the headline feature and why it matters to ops teams. Mention specific capabilities, UI touches, and any fixes.]

[Short closing on licensing and availability.]

Repo: https://github.com/cvquesty/openvox-gui
Release: https://github.com/cvquesty/openvox-gui/releases/latest

#OpenVox #Puppet #DevOps #InfrastructureAsCode #OpenSource
````

---

## 8. Hacker News (Show HN -- optional)

If you want to test community reception there. HN audience is harsher but if it lands it'll drive real eyeballs to the repo. Title <80 chars, no emoji, no marketing-speak.

### Title

```
Show HN: openvox-gui [VERSION] -- [short technical description]
```

### First comment (post immediately after submission so it appears at top)

````
Maintainer here. openvox-gui is an Apache-2.0 web GUI for OpenVox, the community-led continuation of Puppet open-source. It gives you [list 4-6 core capabilities].

[VERSION] [briefly describe what the release focused on and the technical approach].

[1-2 paragraphs on implementation highlights, design choices, or fixes. Be factual.]

Stack is FastAPI + React/TypeScript/Mantine, SQLite via SQLAlchemy. Runs as a systemd unit, deploys via a single install.sh...

Happy to dig into any of the design choices.

https://github.com/cvquesty/openvox-gui
````

---

## Notes

- Each section's body is in a fenced code block so you can triple-click + copy without picking up surrounding text.
- The Reddit and HN posts mention features that predate this release; they're useful context for new audiences. If you'd rather scope strictly to "what's new in [VERSION]," delete those clauses.
- LinkedIn copy uses your SS Consulting Group voice -- adjust the first paragraph if you want it framed as personal vs. company.
- For the X thread, post tweets 2 and 3 as replies to tweet 1 (not standalone posts), so they thread properly.
- The Mastodon toot fits in a default 500-char instance; if you're on an instance with a higher limit you have room to add a sentence.
- Update the "How to use this file" table and the internal-churn note at the top for each new release.
- This template was extracted from press_3.6.2.md and press_3.9.2.md to make future press documents consistent and fast to produce.
- **Process note:** Creating this document is now a standard step when performing an official GitHub Release (see AGENTS.md "Release Process" and "Press release / announcement document").