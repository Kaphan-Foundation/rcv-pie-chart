# rcv-pie-chart

An animated Ranked Choice Voting (RCV) pie chart web component. Visualizes round-by-round RCV election results with smooth d3-powered transitions showing vote transfers as candidates are eliminated or elected.

Built as a standalone `<pie-chart>` custom element that can be embedded in any web page.

## Custom element factory

This repo is also a general-purpose template for building standalone web components from Svelte 5 source. The pattern — a Vite library build with `customElement: true` in the Svelte compiler options — can be applied to any Svelte component to produce a self-contained ES module that works in any HTML page, regardless of framework. To build a different custom element, follow the same structure: create a Svelte component with `<svelte:options customElement="your-element-name" />`, add a JS entry point that imports it, and configure the Vite `lib` build entry.

## Demo

![Pie chart showing RCV rounds](https://img.shields.io/badge/status-working-green)

To see the full demo (pie chart + timeline slider) with a 7-round County Sheriff election:

```bash
npm run build
npm run preview
```

This opens the demo at `http://localhost:4173`.

## Installation

```bash
git clone https://github.com/Kaphan-Foundation/rcv-pie-chart.git
cd rcv-pie-chart
npm install
```

## Building

```bash
npm run build
```

This produces `dist/pie-chart.es.js` — a standalone ES module (~172KB, ~49KB gzipped) containing the web component with all dependencies (Svelte runtime and d3) bundled in.

## Development

```bash
npm run preview
```

Starts a local dev server with a demo with the timeline slider at http://localhost:4173.

## Usage

### In an HTML page

```html
<script type="module" src="pie-chart.es.js"></script>
<pie-chart electionSummary='{ ... RCtabSummary JSON ... }'></pie-chart>
```

With optional attributes:

```html
<pie-chart
  electionSummary='{ ... }'
  currentRound="3"
  showCaptions="true"
  textForWinner="winner"
  candidateColors='["#e41a1c", "#377eb8", "#4daf4a", "#984ea3"]'
></pie-chart>
```

### Input format

The component accepts an `electionSummary` attribute containing an [RCtabSummary](https://www.rcvresources.org/) JSON object (as a string or object). This is the standard output format produced by [RCTab](https://github.com/BrightSpots/rcv) and compatible tabulators.

The JSON structure looks like:

```json
{
  "config": {
    "contest": "Election Name",
    "date": "2024-01-01"
  },
  "jsonFormatVersion": "1",
  "results": [
    {
      "round": 1,
      "tally": { "Alice": "100", "Bob": "80", "Carol": "60" },
      "tallyResults": [{ "eliminated": "Carol", "transfers": { "Alice": "35", "Bob": "25" } }],
      "threshold": "121",
      "inactiveBallots": { "exhaustedChoices": "0" }
    }
  ],
  "summary": {
    "finalThreshold": "121",
    "numCandidates": 3,
    "numWinners": 1,
    "totalNumBallots": "240"
  }
}
```

### Attributes / Properties

| Attribute | Type | Default | Description |
|-----------|------|---------|-------------|
| `electionSummary` | `RCtabSummary \| string` | (required) | Election results data |
| `currentRound` | `number` | `1` | Round to display |
| `requestRoundChange` | `(round: number) => void` | no-op | Callback when the component requests a round change (e.g. during animation) |
| `candidateColors` | `string[]` | `[]` (uses d3.schemeCategory10) | Custom color palette for candidates |
| `textForWinner` | `string` | `'elected'` | Word used in captions for winners (e.g. `'elected'`, `'winner'`, `'approved'`) |
| `showCaptions` | `boolean` | `false` | Show narration text below the chart describing eliminations and elections per round |
| `firstRoundDeterminesPercentages` | `boolean` | `true` | When true, percentages use first-round active votes as the denominator (so the total stays at 100% even as votes are exhausted). When false, the denominator is the current round's active votes, which decrease as candidates are eliminated. |
| `excludeFinalWinnerAndEliminatedCandidate` | `boolean` | `false` | When true, removes the final winner and last eliminated candidate from the display |

### Animation controls

The component includes a built-in **One Small Step** button that advances one animation phase at a time (eliminate → transfer → consolidate). Full-round animation is intended to be driven by the host page via `currentRound` and `requestRoundChange`.

## Project structure

```
src/lib/
  pie-chart.js              — Build entry point
  PieChart.svelte           — Custom element wrapper, tooltips, status display
  PieChartGraphics.svelte   — d3 rendering engine, animation logic
  ElectionSummaryTypes.ts   — RCtabSummary type definitions and validation
```

## Dependencies

- [d3](https://d3js.org/) ^7.9.0 — SVG rendering and animations
- [Svelte](https://svelte.dev/) ^5.20.5 — Component framework (compiled away at build time)
- [Vite](https://vite.dev/) ^6.1.0 — Build tool (dev dependency)

## License

MIT
