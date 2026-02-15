# rcv-pie-chart

An animated Ranked Choice Voting (RCV) pie chart web component. Visualizes round-by-round RCV election results with smooth d3-powered transitions showing vote transfers as candidates are eliminated or elected.

Built as a standalone `<pie-chart>` custom element that can be embedded in any web page.

## Demo

![Pie chart showing RCV rounds](https://img.shields.io/badge/status-working-green)

After building, open `dist/index.html` in a browser or run `npx vite preview` to see a 7-round County Sheriff election animated round by round.

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
npm run dev
```

Starts a local dev server with hot reload at `http://localhost:4000`.

## Usage

### In an HTML page

```html
<script type="module" src="pie-chart.es.js"></script>
<pie-chart electionSummary='{ ... RCtabSummary JSON ... }'></pie-chart>
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

| Attribute | Type | Description |
|-----------|------|-------------|
| `electionSummary` | `RCtabSummary \| string` | Election results data (required) |
| `currentRound` | `number` | Round to display (default: 1) |
| `requestRoundChange` | `(round: number) => void` | Callback when the component requests a round change |
| `candidateColors` | `string[]` | Custom color palette for candidates (uses d3.schemeCategory10 by default) |

### Animation controls

The component includes two built-in buttons:
- **Animate All** — plays through all rounds automatically
- **One Small Step** — advances one animation phase at a time (eliminate → transfer → consolidate)

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

TBD
