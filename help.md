Here are the exact local dev instructions for the agent monorepo based on the BrowserOS repo plus the `browseros-agent/README.md` you pasted. The BrowserOS repo explicitly says agent development lives in `packages/browseros-agent`, while browser development is the separate Chromium-side path. [github](https://github.com/browseros-ai/BrowserOS)

## Quick path

From the root of your cloned BrowserOS repo, run the agent monorepo setup and watch command inside `packages/browseros-agent`: [github](https://github.com/browseros-ai/BrowserOS)

```bash
cd packages/browseros-agent

cp apps/server/.env.example apps/server/.env.development
cp apps/agent/.env.example apps/agent/.env.development
cp apps/server/.env.production.example apps/server/.env.production

bun run dev:setup
bun run dev:watch
```

According to the `browseros-agent` README, `dev:setup` installs deps and generates agent code, and `dev:watch` starts the full dev environment with the server starting immediately. [github](https://github.com/browseros-ai/BrowserOS)

## If you only want pieces

The monorepo README also lists the individual start commands: `bun run start:server` for the Bun MCP/agent server and `bun run start:agent` for the extension in dev mode. [github](https://github.com/browseros-ai/BrowserOS)

```bash
cd packages/browseros-agent

bun run start:server
# in another terminal
bun run start:agent
```

That means your local extension changes in `apps/agent` should be exercised through `start:agent` or `dev:watch`, not through the already-installed `.dmg` app by itself. The BrowserOS architecture docs identify `apps/agent` as the browser extension UI and `apps/server` as the local Bun backend it talks to. [github](https://github.com/browseros-ai/BrowserOS)

## Important env values

Your local dev setup depends on the server and agent agreeing on ports, and the README says those duplicated port variables must stay in sync across `apps/server/.env.development` and `apps/agent/.env.development`. [github](https://github.com/browseros-ai/BrowserOS)

Use these defaults unless you have a conflict: [github](https://github.com/browseros-ai/BrowserOS)

- `BROWSEROS_SERVER_PORT=9100`
- `BROWSEROS_CDP_PORT=9000`
- `BROWSEROS_EXTENSION_PORT=9300`
- `VITE_BROWSEROS_SERVER_PORT=9100`

For the agent side, the relevant launch behavior is also controlled by: [github](https://github.com/browseros-ai/BrowserOS)

- `BROWSEROS_BINARY` = path to the BrowserOS binary.
- `USE_BROWSEROS_BINARY=true` = tells the agent flow to use BrowserOS instead of default Chrome.

## How this maps to your installed `.dmg`

If you installed BrowserOS from the `.dmg`, the cleanest local test path is to point `BROWSEROS_BINARY` at that installed app binary in `apps/agent/.env.development`, then run `bun run start:agent` or `bun run dev:watch` from the monorepo so the dev extension/UI code launches against your local BrowserOS binary. The README explicitly defines `BROWSEROS_BINARY` for that purpose and says `USE_BROWSEROS_BINARY=true` uses BrowserOS instead of default Chrome. [github](https://github.com/browseros-ai/BrowserOS)

On macOS, that path is typically something like:

```bash
BROWSEROS_BINARY="/Applications/BrowserOS.app/Contents/MacOS/BrowserOS"
USE_BROWSEROS_BINARY=true
```

That exact path format is the standard executable location inside a macOS `.app` bundle, and the repo’s env var naming indicates that this is the binary path the dev agent launcher expects. [github](https://github.com/browseros-ai/BrowserOS)

## Recommended workflow

For your case, where you changed the extension, I’d use this flow: [github](https://github.com/browseros-ai/BrowserOS)

1. Set `BROWSEROS_BINARY` in `packages/browseros-agent/apps/agent/.env.development` to your installed BrowserOS binary. [github](https://github.com/browseros-ai/BrowserOS)
2. Keep `USE_BROWSEROS_BINARY=true`. [github](https://github.com/browseros-ai/BrowserOS)
3. Run `bun run dev:setup` once. [github](https://github.com/browseros-ai/BrowserOS)
4. Run `bun run dev:watch` for the full environment, or `bun run start:server` plus `bun run start:agent` in two terminals if you want more control. [github](https://github.com/browseros-ai/BrowserOS)
5. Test your UI changes in the dev-launched BrowserOS session, not the standalone packaged app session you opened manually. [github](https://github.com/browseros-ai/BrowserOS)

## If something fails

A few likely failure points from the documented setup are: [github](https://github.com/browseros-ai/BrowserOS)

- Missing `.env.development` files.
- Port collisions on 9000 or 9100.
- `BROWSEROS_BINARY` not pointing to a valid executable.
- Running only the extension without the Bun server, even though the agent UI connects to the local server on `VITE_BROWSEROS_SERVER_PORT`. [github](https://github.com/browseros-ai/BrowserOS)
- `run.sh` hangs waiting on `/health`: don’t add custom tools that reference non-existent approval category constants (for example `ToolApprovalCategoryId.LOW_RISK`). Use `defineToolWithCategory('assistant')` or another valid ID from `TOOL_APPROVAL_CATEGORY_IDS`, or the server will crash before `/health` comes up.

If you want, paste your `packages/browseros-agent/package.json` and I can turn this into the exact one-command workflow and tell you what `dev:watch` actually runs under the hood. [github](https://github.com/browseros-ai/BrowserOS)