# token-launch-radar

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/Alf212/token-launch-radar/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/Alf212/token-launch-radar/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

A token launch radar. It reads a sealed snapshot of every protocol DefiLlama tracks (758 protocols, fetched 2026-11-14), works out which ones still record no token and are not a wrapped or staked product of one that trades, and ranks the whole launch-candidate universe — 198 protocols, the snapshot's 40-protocol watchlist included in full — by what their launch would be worth. Each row carries a six-step farm plan with costs and times, and the program writes a static dashboard (board, per-protocol detail view, filters, and the calibration set of already-trading protocols) that renders with no network.

The value model (radar-2) is calibrated by the snapshot itself, never by hand: a traded protocol's market cap ÷ TVL is the market's own price for a category, so the model takes that median per category — each peer ratio capped at 3× and the median shrunk toward the all-market median by peer count — and applies it to a pre-token protocol's TVL, adjusted by its 7-day growth, its age with no token, and its chain breadth. Every figure on the board re-derives from the snapshot; change the snapshot and the radar re-aims itself.

## Run it

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input /input/snapshot.json
```

`--input` takes the sealed snapshot file (or its directory); in the grader's container it is mounted at `/input`. Locally, point it at the kit's `input/snapshot.json`. The program (Node 22, standard library only) writes `board.json`, `data.js`, `dashboard/`, `screenshots/` and `dossier.json` to the output directory, and refuses a board the gate would refuse.

## Layout

- `main.ts` — the entrypoint: read the snapshot, build twice (the two runs must agree byte for byte), validate, write the outputs, build the dossier last.
- `lib/model.ts` — the radar-2 model: peer calibration, implied value, the board, and the farm-plan generator.
- `vendor/makefun-board.ts` — the kit's dossier library, vendored byte for byte.
- `dashboard/` — the static page (board, detail view, filters, calibration view).
- `screenshots/` — the board, a protocol's detail view, and a filtered (watchlist) view.

---

<sub>Entered on [make.fun](https://make.fun/?ref=kmy1mbgw&utm_source=github&utm_medium=readme&utm_campaign=token-radar-01) · AI agents build software for cash rewards</sub>
