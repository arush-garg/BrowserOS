<div align="center">
<img width="693" height="415" alt="BrowserOS neo: the missing browser for your AI agents" src="https://github.com/user-attachments/assets/8129f9c8-e8f4-4afe-834a-91397121d833" />
<br></br>
<a href="https://discord.gg/YKwjt5vuKr"><img src="https://img.shields.io/badge/Discord-555?logo=discord" alt="Discord" /></a>
<a href="https://dub.sh/browserOS-slack"><img src="https://img.shields.io/badge/Slack-555?logo=slack" alt="Slack" /></a>
<a href="https://x.com/browserOS_ai"><img src="https://img.shields.io/badge/@browserOS__ai-555?logo=x" alt="X / Twitter" /></a>
<a href="https://github.com/browseros-ai/BrowserOS"><img src="https://img.shields.io/github/stars/browseros-ai/BrowserOS?style=flat&logo=github&label=stars&color=4c71f2" alt="GitHub stars" /></a>
<a href="LICENSE"><img src="https://img.shields.io/badge/license-AGPL--3.0-555" alt="AGPL-3.0" /></a>
<br></br>

<a href="https://www.producthunt.com/products/browseros_ai?embed=true&utm_source=badge-featured&utm_medium=badge&utm_campaign=badge-browseros-neo" target="_blank" rel="noopener noreferrer"><picture><source media="(prefers-color-scheme: dark)" srcset="https://api.producthunt.com/widgets/embed-image/v1/featured.svg?post_id=1031913&theme=dark&t=1786088428884" /><img alt="BrowserOS neo - The Missing Browser for Claude, Cowork & Codex | Product Hunt" width="250" height="54" src="https://api.producthunt.com/widgets/embed-image/v1/featured.svg?post_id=1031913&theme=light&t=1786088428884" /></picture></a>
<a href="https://trendshift.io/repositories/16468?utm_source=trendshift-badge&utm_medium=badge&utm_campaign=badge-trendshift-16468" target="_blank" rel="noopener noreferrer"><img src="https://trendshift.io/api/badge/trendshift/repositories/16468/daily?language=TypeScript" alt="browseros-ai%2FBrowserOS | Trendshift" /></a>
</div>

## What is BrowserOS?

**BrowserOS neo** — the agentic browser built for AI agents (TypeScript, React, Rust). It runs locally, exposes a clean MCP tool surface, and ships a first-party dashboard to watch, replay, and manage agent sessions.

**BrowserOS** — the Chromium fork (C++) that powers neo, with privacy patches, deterministic builds, and signed releases.

---

## Quick Start

```bash
# BrowserOS neo (agents & dashboard)
git clone https://github.com/browseros-ai/BrowserOS.git
cd BrowserOS/packages/browseros-agent
bun install
bun run dev           # starts the Bun server + Vite dashboard on :9005
```

```bash
# BrowserOS (the Chromium fork) — requires ~100 GB disk
cd packages/browseros
./scripts/bootstrap.sh
./scripts/build.sh
```

---

## Repository Layout

```
BrowserOS/
├── packages/
│   ├── browseros/                   # Chromium fork: patches, build, signing
│   ├── browseros-agent/             # BrowserOS neo (TypeScript + Rust)
│   │   ├── apps/
│   │   │   ├── app/                 # BrowserOS extension: new tab, side panel, onboarding, settings
│   │   │   ├── app-onboard/         # BrowserOS first-run onboarding
│   │   │   ├── claw-app/            # BrowserOS neo new-tab dashboard
│   │   │   ├── claw-onboard/        # BrowserOS neo first-run onboarding
│   │   │   ├── claw-server/         # BrowserOS neo backend: MCP endpoint + dashboard API
│   │   │   └── server/              # Bun server exposing browser MCP tools + AI agent loop
│   │   ├── packages/
│   │   │   ├── agent-cursor/        # Cursor handling
│   │   │   ├── agent-mcp-manager/   # Add, link and unlink MCP servers
│   │   │   ├── browser-core/        # Core browser control primitives
│   │   │   ├── browser-mcp/         # Browser MCP tool surface
│   │   │   ├── build-server-tools/  # Shared build tooling
│   │   │   ├── cdp-protocol/        # CDP type bindings
│   │   │   ├── claw-api/            # Generated BrowserOS neo wire types
│   │   │   ├── claw-api-client/     # Contract-typed HTTP client
│   │   │   ├── onboarding-video/    # Remotion compositions
│   │   │   └── shared/              # Shared constants
│   │   └── crates/
│   │       ├── browseros-cdp/       # CDP bindings
│   │       ├── browseros-core/      # Core primitives
│   │       ├── browseros-mcp/       # MCP server implementation
│   │       ├── claw-api/            # Wire types (shared with TS)
│   │       └── harness-integrations/# Managed integrations for AI coding harnesses
```

---

## Contributing

| Package | What it does |
|---------|-------------|
| [`packages/browseros`](packages/browseros/) | Chromium fork: patches, build system, signing |
| [`apps/claw-server`](packages/browseros-agent/apps/claw-server/) | BrowserOS neo backend: MCP endpoint agents connect to, plus the API behind the dashboard |
| [`apps/claw-app`](packages/browseros-agent/apps/claw-app/) | BrowserOS neo new-tab dashboard: watch, replay, and manage agent sessions |
| [`apps/claw-onboard`](packages/browseros-agent/apps/claw-onboard/) | BrowserOS neo first-run onboarding |
| [`apps/server`](packages/browseros-agent/apps/server/) | Bun server exposing the browser MCP tools and running the BrowserOS AI agent loop |
| [`apps/app`](packages/browseros-agent/apps/app/) | BrowserOS extension: new tab, side panel chat, onboarding, settings |
| [`apps/app-onboard`](packages/browseros-agent/apps/app-onboard/) | BrowserOS first-run onboarding |

### Contributing

We'd love your help making BrowserOS neo and BrowserOS better. Start with the [Contributing Guide](CONTRIBUTING.md), which routes you to the right path.

- **BrowserOS neo** (TypeScript, React, Rust): [setup guide](packages/browseros-agent/CONTRIBUTING.md). Around 15 minutes.
- **BrowserOS** (TypeScript, React, Bun): [setup guide](packages/browseros-agent/CONTRIBUTING.BrowserOS.md). Around 15 minutes.
- **Browser** (C++, Python): requires ~100GB of disk. See the [root guide](CONTRIBUTING.md#browser-development).

## Credits

- [ungoogled-chromium](https://github.com/ungoogled-software/ungoogled-chromium): we use some of its patches for enhanced privacy. Thanks to everyone behind this project.
- [The Chromium Project](https://www.chromium.org/): at the core of both browsers, making it possible for them to exist in the first place.

## Citation

If you use BrowserOS or BrowserOS neo in your research or project, please cite:

```bibtex
@software{browseros2025,
  author = {Nithin Sonti and Nikhil Sonti and {BrowserOS-team}},
  title = {BrowserOS: The open-source Agentic browser},
  url = {https://github.com/browseros-ai/BrowserOS},
  year = {2025},
  publisher = {GitHub},
  license = {AGPL-3.0},
}
```

## License

BrowserOS neo and BrowserOS are open source under the [AGPL-3.0 license](LICENSE).

Copyright &copy; 2026 Felafax, Inc.

Watch the repo if you want to hear when agents can do something new.

## Stargazers

Thank you to all our supporters.

<table>
<tr>
<td align="center">Nikhil</td>
<td align="center">Nithin</td>
<td align="center">Dani</td>
</tr>
<tr>
<td align="center"><a href="https://x.com/intent/user?screen_name=nv_sonti"><img src="https://img.shields.io/twitter/follow/nv_sonti?style=social" alt="Follow Nikhil on X" /></a></td>
<td align="center"><a href="https://x.com/intent/user?screen_name=ThatNithin"><img src="https://img.shields.io/twitter/follow/ThatNithin?style=social" alt="Follow Nithin on X" /></a></td>
<td align="center"><a href="https://x.com/intent/user?screen_name=dani_akash_"><img src="https://img.shields.io/twitter/follow/dani_akash_?style=social" alt="Follow Dani on X" /></a></td>
</tr>
</table>

<p align="center">
Built with ❤️ from San Francisco
</p>