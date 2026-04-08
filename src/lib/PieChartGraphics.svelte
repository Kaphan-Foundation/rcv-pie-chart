<!--  PieChartGraphics.svelte -->
<svelte:options runes={true} />
<script lang='ts'>


import * as d3 from 'd3';
import { type DefaultArcObject } from 'd3-shape';

import { onMount } from 'svelte';

import type { RCtabSummary,
              RCtabSummaryConfig,
              RCtabResults,
              RCtabInactiveBallots,
              RCtabTally,
              RCtabTallyResults,
              RCtabSummarySummary
            } from '$lib/ElectionSummaryTypes';

let {
  jsonData,
  currentRound = 1,
  mouseEventType = $bindable(),
  mouseData = $bindable(),
  mouseX = $bindable(),
  mouseY = $bindable(),
  requestRoundChange = ((r:number) => {}),
  candidateColors = [],
  excludeFinalWinnerAndEliminatedCandidate = false,
  firstRoundDeterminesPercentages = false,
  randomizeOrder = false,
  displayPhase = $bindable(0),
} : {
  jsonData: RCtabSummary,
  currentRound: number,
  mouseEventType: string,
  mouseData: string,
  mouseX: number,
  mouseY: number,
  requestRoundChange: ((r:number)=>void) | null,
  candidateColors: string[],
  excludeFinalWinnerAndEliminatedCandidate: boolean,
  firstRoundDeterminesPercentages: boolean,
  randomizeOrder: boolean,
  displayPhase: number,
} = $props();



interface PieData  {
    label: string;         // always the real candidate name
    value: number;
    isTransfer?: boolean;  // true for the surplus-transfer portion of an elected candidate's slice
    transferIndex?: number; // index into tallyResults, used for donut sub-slices
};

type PieDataArray = PieData[];

// Unique key for D3 data binding — derived from structured fields, never parsed back
function pieKey(d: PieData): string {
    if (d.isTransfer) return `${d.label}__transfer`;
    if (d.transferIndex != null) return `${d.label}__${d.transferIndex}`;
    return d.label;
}

type PieInfoType = d3.PieArcDatum<PieData>;
type PieInfoArray = PieInfoType[];

type PieOrArc = PieInfoType | DefaultArcObject;



const width = 800;
const height = 800;

const pieChartRadius = Math.min(width,height) * 0.3;

const pieChartCenterX = width/2;
const pieChartCenterY = height/2;

const pieChartID = 'Pie';
const pieOutlineID = 'PieOutline';
const donutChartID = 'Donut';
const textLayerID = 'TextLayer';
const darkHashing = true;

const exhaustedColor = 'url(#cross-hatch)';

const textArcRadius = 1.15;   // multiple of the pie chart radius where text labels go
const minimumTextAngle = 0.1; // minimum number of radians of a text slice to display label

const shortTransition = 750;
const longTransition = 800;

// Slice separator: thin gap between adjacent pie slices
const sliceSeparatorColor = 'white';
const sliceSeparatorWidth = 1;

// Elected candidate outline: rendered via the shadow outline pie
const electedOutlineColor = '#ff00ff';
const electedOutlineWidth = 3;

// SVG pattern IDs derived from candidate names. Must sanitize all non-alphanumeric
// characters — apostrophes, quotes, etc. break CSS url(#...) references.
function hatchPatternId(name: string): string {
  return 'hatch-' + name.replace(/[^a-zA-Z0-9]/g, '-');
}


let pieInfoGlobal:PieInfoArray = [];
let donutInfoGlobal:PieInfoArray = [];
let pieDataGlobal:PieDataArray = [];

let originalTotalVotes:number = 0;

// displayPhase is now a $bindable prop (see props above)
let animationRound:number = 0;

export type ColorMap = Record<string,string>;

export const pieColors:ColorMap = {};

export const exhaustedLabel = 'No Further Rankings';

// $inspect("currentRound = ", currentRound);
// $inspect("DisplayPhase = ", displayPhase);

// Variables bound in Svelte bind directives
let svg = $state<SVGSVGElement|null>(null);


function cleanUpOldPie() {
  const g = d3.select<SVGSVGElement | null, any>(svg)
  g.select('#' + pieChartID)
    .remove();
  g.select('#' + pieOutlineID)
    .remove();
  g.select('#' + donutChartID)
    .remove();
  g.select('#' + textLayerID)
    .remove();
}

function tryRequestRoundChange(newRound:number):void {
  if (requestRoundChange) {
    previousRound = newRound; // if we get a reactive "echo" we will ignore it!
    requestRoundChange(newRound);
  }
}

function makeNewPie(round: number) {

  cleanUpOldPie();
  pieDataGlobal = initSummaryData(round);
  pieInfoGlobal = createPieChart(round, pieChartID, pieDataGlobal, pieChartCenterX, pieChartCenterY,
                                  0, smallPieRadius());
  // Shadow outline pie — same geometry, invisible until elected
  createPieChart(round, pieOutlineID, pieDataGlobal, pieChartCenterX, pieChartCenterY,
                  0, smallPieRadius(), false, false, true);
  outlineElected();
}

onMount(() => {

  // console.log('PieChartGraphics component loaded and initialized');
  // console.log('jsonData is: ', jsonData);

  initPieChartColors();
  setTimeout(() => {
    makeNewPie(currentRound);
  }, 0);

});

function initSummaryData(round: number):PieDataArray {
  const pieData:PieDataArray = prepareRoundData(round);
  originalTotalVotes = getTotalVotes(round);
  return pieData;
}

function smallPieRadius():number {
  return pieChartRadius;
}

function largePieRadius():number {
    return smallPieRadius() * 1.41;
}

// Count up the exhausted ballots *before* a given round
//
export function countExhaustedVotes(round:number) {
  let exhaustedVotes = 0;
  for (let r = 1; r < round; r++) {
    const tallyResults:RCtabTallyResults[] = jsonData.results[r-1].tallyResults;
    for (let i=0; i<tallyResults.length; i++) {

      const transfers = tallyResults[i].transfers;
      if (transfers) {
        const exhausted = transfers['exhausted'];
        if (exhausted)
          exhaustedVotes += Number(exhausted);
      }
    }
  }
  return exhaustedVotes;
}



function candidateVotes(candidate:string, round:number):number {
  if (candidate === 'exhausted')
    return countExhaustedVotes(round);
  else {
    const tally = jsonData.results[round-1].tally;
    return Number(tally[candidate]);
  }
}

// returns a formatted string with the number of votes for a candidate at a given round.
function candidateVotesStr(candidate:string, round:number):string {
  const votes = candidateVotes(candidate, round);
  return votes.toLocaleString('en-US');
}

// returns a formatted string with the percentage of the vote for a candidate on a given round.
// When firstRoundDeterminesPercentages is true, the denominator is the first round's total votes.
// When false, the denominator is the current round's active votes.
function candidatePercentage(candidate:string, round:number):string {
  const denominator = firstRoundDeterminesPercentages
    ? originalTotalVotes
    : getActiveVotes(round);
  const fraction = candidateVotes(candidate,round)/denominator;
  const formattedNumber = fraction.toLocaleString('en-US', {
    style: 'percent',
    minimumFractionDigits: 1
  });
  return formattedNumber;
}

function getTotalVotes(round:number) {
  const tally = jsonData.results[round-1].tally;
  let totalVotes:number = 0;
  for (let [name, votes] of Object.entries(tally)) {
    totalVotes += Number(votes);
  }
  return totalVotes;
}

// RCTab puts exhausted votes in the tally as a pseudo-candidate named
// 'Inactive Ballots'. Our own tabulator uses 'exhausted'.
function isExhaustedLabel(name:string):boolean {
  return name === 'exhausted' || name === 'Inactive Ballots';
}

// Active votes only — excludes exhausted/inactive ballots from the total.
// Used as the denominator when firstRoundDeterminesPercentages is false.
function getActiveVotes(round:number) {
  const tally = jsonData.results[round-1].tally;
  let activeVotes:number = 0;
  for (let [name, votes] of Object.entries(tally)) {
    if (!isExhaustedLabel(name)) {
      activeVotes += Number(votes);
    }
  }
  return activeVotes;
}

// makes a list of either eliminated or elected candidates on a given round
// from the JSON summary object.
//
function chosenCandidates(round:number, key:'eliminated'|'elected'):string[] {
    if (!round || round < 1 || round > jsonData.results.length) {
      console.warn('In chosenCandidates: round ${round} is out of range.');
      return [];
    }

    // When excludeFinalWinnerAndEliminatedCandidate is set, suppress
    // elected/eliminated status on the final round (incomplete results).
    if (excludeFinalWinnerAndEliminatedCandidate && round === jsonData.results.length) {
      return [];
    }

    const tallyResults:RCtabTallyResults[] = jsonData.results[round-1].tallyResults;
    const result:string[] = [];
    for (let i=0; i<tallyResults.length; i++){
        const chosen:string = tallyResults[i][key]!;
        if (chosen != undefined)
            result.push(chosen);
    }
    return result;
}


// get a list of candidates eliminated on this round.
export function getEliminatedCandidates(round:number):string[] {
    const result =  chosenCandidates(round,'eliminated');
    return result;
}

// get a list of the candidates who have been elected up to and incuding a
// certain round.
//
export function getElectedCandidates(round:number):string[] {
  let result:string[] = [];
  for (let r = 1; r <= round; r++)
    result = result.concat(chosenCandidates(r, 'elected'));
  return [...new Set(result)];
}




function countElectedTransfers(candidate:string, round:number) {

  const tallyResults = jsonData.results[round-1].tallyResults;
  let votesTransferred = 0;
  const elected = tallyResults.findIndex((results:RCtabTallyResults) =>
                  results?.elected && candidate == results.elected);
  if (elected>=0) {
    const transfers = tallyResults[elected].transfers;
    if (transfers) {
      for (let [name,votes] of Object.entries(transfers))
        votesTransferred += Number(votes);
    }
  } else {
    return 0; // candidate was not elected
  }
  return votesTransferred;
}

// True if the round has any non-empty transfers to animate.
function roundHasTransfers(round: number): boolean {
  if (round < 1 || round > jsonData.results.length) return false;
  const tallyResults = jsonData.results[round-1].tallyResults;
  return tallyResults.length > 0 &&
    tallyResults.some((tr: RCtabTallyResults) => Object.keys(tr.transfers).length > 0);
}

// Find the next round >= fromRound that has transfers, or the last round.
function nextRoundWithTransfers(fromRound: number): number {
  const lastRound = jsonData.results.length;
  for (let r = fromRound; r < lastRound; r++) {
    if (roundHasTransfers(r)) return r;
  }
  return lastRound;
}

// Add exhausted votes if the tally doesn't already include them
// under another name (e.g., 'Inactive Ballots' from rcvis).
function appendExhaustedIfNeeded(resultData:PieDataArray, round:number):void {
  if (!resultData.some(d => isExhaustedLabel(d.label))) {
    resultData.push({ label: 'exhausted', value: countExhaustedVotes(round) });
  }
}

// Seeded shuffle: spreads differently-sized pie slices around the circle
// to prevent clustering and label overlap. Deterministic for same contest name.

// mulberry32: simple 32-bit seeded PRNG
function mulberry32(seed: number): () => number {
  let s = seed | 0;
  return () => {
    s = (s + 0x6D2B79F5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Simple string hash (djb2) producing a 32-bit seed
function hashString(str: string): number {
  let hash = 5381;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) + hash + str.charCodeAt(i)) | 0;
  }
  return hash;
}

// Deterministic Fisher-Yates shuffle using contest name as seed.
// Skips shuffle for 3 or fewer candidates.
function scatterOrder(names: string[]): string[] {
  if (names.length <= 3) return names;
  const seed = hashString(jsonData.config?.contest ?? '');
  const rng = mulberry32(seed);
  const result = [...names];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

// Compute stable candidate ordering from round 1, reused for all rounds.
// When randomizeOrder is true, slices are scattered for even size distribution.
function getCandidateOrder(): string[] {
  const allNames = Object.keys(jsonData.results[0].tally);
  const active = allNames.filter(n => !isExhaustedLabel(n));
  const inactive = allNames.filter(n => isExhaustedLabel(n));
  const ordered = randomizeOrder ? scatterOrder(active) : active;
  return [...ordered, ...inactive];
}

// Build pie data from the current round's tally only.
// Used when creating a fresh pie (no transition history).
function prepareRoundData(round:number):PieDataArray {
  const tally = jsonData.results[round-1].tally;
  const resultData:PieDataArray = [];
  for (const name of getCandidateOrder()) {
    if (name in tally) {
      resultData.push({label: name, value: Number(tally[name])});
    }
  }
  appendExhaustedIfNeeded(resultData, round);
  return resultData;
}

// Build pie data for a transition, including candidates from the previous round
// who were just eliminated (with 0 votes) so the transition can shrink them.
function prepareTransitionData(round:number):PieDataArray {
  const currentRoundTally = jsonData.results[round-1].tally;
  const resultData:PieDataArray = [];
  for (const name of getCandidateOrder()) {
    resultData.push({label: name, value: Number(currentRoundTally[name] ?? 0)});
  }
  appendExhaustedIfNeeded(resultData, round);
  return resultData;
}

// Split elected candidates' slices into retained votes + surplus transfer portion.
// Returns a new array with transfer sub-slices inserted before their main slice.
function splitElectedSurplus(data:PieDataArray, round:number):PieDataArray {
  const resultData:PieDataArray = [];
  for (const entry of data) {
    if (entry.label === 'exhausted' || entry.isTransfer) {
      resultData.push(entry);
      continue;
    }
    const electedTransfers = countElectedTransfers(entry.label, round);
    if (electedTransfers > 0) {
      resultData.push({label: entry.label, value: electedTransfers, isTransfer: true});
      resultData.push({...entry, value: entry.value - electedTransfers});
    } else {
      resultData.push(entry);
    }
  }
  return resultData;
}

function initPieChartColors() {

  const prototypePattern = d3.select<SVGSVGElement|null, SVGDefsElement>(svg)
                          .select('defs')
                          .select('#cross-hatch');
  let i=0;
  for (let [name, votes] of Object.entries(jsonData.results[0].tally)) {

    if (!candidateColors || candidateColors.length === 0) {

      if (i<10) {
        pieColors[name] =  d3.schemeCategory10[i];
      } else {
        pieColors[name] = '#' + Math.floor(Math.random() * 0xFFFFFF)
                                .toString(16).padStart(6,'0');
      }
    } else {
      pieColors[name] = candidateColors[ i % candidateColors.length];
    }

    i++;

    if (darkHashing) {
      const pattern = prototypePattern.clone(true);
      pattern
        .attr('id', hatchPatternId(name))
        .select('rect')
          .attr('fill', pieColors[name]);
      pattern
        .selectAll('circle')
          .attr('fill', '#383838');

    } else {
      prototypePattern.clone(true)
        .attr('id', hatchPatternId(name))
        .selectAll('circle')
          .attr('fill', pieColors[name]);
    }
  }
  pieColors['exhausted'] = exhaustedColor;
  pieColors['Inactive Ballots'] = exhaustedColor;
}

function deleteDonut():void {
  d3.select<SVGSVGElement|null, any>(svg)
        .select('#'+donutChartID)
        .remove();
}


function animatePhase1(round:number, nextPhase:()=>void) {

  const t = d3.transition('global').duration(longTransition);

  if (nextPhase) {
    t.on("end", nextPhase);
  }

  // Split elected candidates' slices into retained + surplus-transfer portions.
  // This must happen before displayDonut so the donut arcs anchor to the transfer sub-slice.
  const splitData = splitElectedSurplus(pieDataGlobal, round);
  const splitPie = d3.pie<PieData>().sort(null).value(d => d.value);
  const splitPieInfo = splitPie(splitData);

  applySplitToChart(round, pieChartID, splitPieInfo, 0, smallPieRadius());
  applySplitToChart(round, pieOutlineID, splitPieInfo, 0, smallPieRadius(), true);

  pieDataGlobal = splitData;
  pieInfoGlobal = splitPieInfo;

  deleteDonut();
  displayDonut(round);
  markTextFinished();
  grayOutEliminated(0, smallPieRadius());
  outlineElected();

}

function animatePhase2(round:number, nextPhase:() => void) {

  const t = d3.transition('global').duration(longTransition);

  if (nextPhase) {
    t.on("end", nextPhase);
  }
  updateDonut(round);
}

function animatePhase3(round:number, nextPhase:()=>void) {

  const t = d3.transition('global').duration(longTransition);
  if (nextPhase)
    t.on("end", nextPhase);

  updatePie(round);
  shrinkDonut(smallPieRadius(), largePieRadius());

}

// --- Action queue: user actions during animation are queued and replayed in order ---

type QueuedAction =
    | { type: 'round', round: number }
    | { type: 'step' };

let isAnimating: boolean = false;
let actionQueue: QueuedAction[] = [];

function stopAnimating() {
  outlineElected();
  isAnimating = false;

  // If we landed on a round with no outgoing transfers, auto-advance
  // to the next round that does (or the last round).
  if (actionQueue.length === 0
      && currentRound < jsonData.results.length
      && !roundHasTransfers(currentRound)) {
    const target = nextRoundWithTransfers(currentRound);
    tryRequestRoundChange(target);
  }

  processNextAction();
}

// After each animation completes, process the next queued user action.
// Each action executes as if the user performed it when not animating.
function processNextAction() {
  if (actionQueue.length === 0) {
    // Queue drained — reconcile with parent's currentRound if needed
    if (previousRound !== currentRound) {
      if (currentRound === previousRound + 1 && previousRound > 0
          && currentRound <= jsonData.results.length) {
        previousRound = currentRound;
        doAnimateOneRound(currentRound);
      } else if (currentRound >= 1 && currentRound <= jsonData.results.length) {
        previousRound = currentRound;
        displayPhase = 0;
        makeNewPie(currentRound);
      }
    }
    return;
  }

  const action = actionQueue.shift()!;
  switch (action.type) {
    case 'round': {
      const targetRound = action.round;
      if (targetRound === previousRound + 1 && previousRound > 0
          && targetRound <= jsonData.results.length) {
        // Adjacent: animate the transition
        previousRound = targetRound;
        doAnimateOneRound(targetRound);
      } else if (targetRound !== previousRound
                  && targetRound >= 1
                  && targetRound <= jsonData.results.length) {
        // Non-adjacent: jump directly, then continue processing
        previousRound = targetRound;
        displayPhase = 0;
        makeNewPie(targetRound);
        processNextAction();
      } else {
        // Same round or invalid — skip
        processNextAction();
      }
      break;
    }
    case 'step':
      animateOnePhaseFn();
      break;
  }
}

// Animate a single round transition (all 3 phases) without depending on currentRound.
// Used by the queue processor and by animateOneRoundFn.
function doAnimateOneRound(targetRound: number) {
  if (targetRound <= 1 || targetRound > jsonData.results.length) {
    processNextAction();
    return;
  }
  isAnimating = true;
  animationRound = targetRound;
  displayPhase = 0;

  // Skip past consecutive no-transfer rounds.
  if (!roundHasTransfers(animationRound - 1)) {
    const target = nextRoundWithTransfers(animationRound - 1);
    if (target > animationRound) {
      animationRound = target;
      tryRequestRoundChange(animationRound);
    }
    stopAnimating();
    return;
  }

  animatePhase1(animationRound-1, () => {
    displayPhase = 1;
    animatePhase2(animationRound-1, () => {
      displayPhase = 2;
      animatePhase3(animationRound, () => { displayPhase = 0; stopAnimating(); });
    });
  });
}

// will be bound to prop 'runFullAnimation'
export function runFullAnimationFn() {
  if (isAnimating) {
    // Already animating — ignore duplicate "Animate All" requests
    return;
  }

  isAnimating = true;
  animationRound = currentRound;
  runAnimationCycle();
}

function runAnimationCycle() {
  displayPhase = 0;   // if in the middle of "one small step" animation, reset to 0.

  // If user performed actions during animation, stop auto-play and process them
  if (actionQueue.length > 0) {
    stopAnimating();
    return;
  }

  // No transfers to animate — skip to the next round that has transfers.
  if (!roundHasTransfers(animationRound)) {
    animationRound = nextRoundWithTransfers(animationRound);
    tryRequestRoundChange(animationRound);
    makeNewPie(animationRound);
    if (animationRound < jsonData.results.length) {
      runAnimationCycle();
    } else {
      displayPhase = 0;
      stopAnimating();
    }
    return;
  }

  const nextPhase = animationRound < jsonData.results.length - 1 ?
      runAnimationCycle : () => { displayPhase = 0; stopAnimating(); };

  animatePhase1(animationRound, () => {
    displayPhase = 1;
    animatePhase2(animationRound, () => {
      displayPhase = 2;
      animationRound++;
      tryRequestRoundChange(animationRound);
      animatePhase3(animationRound, nextPhase);
    });
  });
}


$effect(() =>{
    goToNextRound();
});


let previousRound = 0;

// called when RoundPlayer changes selection
function goToNextRound():void {

  // console.log(`previous round was ${previousRound}, currentRound is ${currentRound}`);
  if (previousRound == currentRound)
    return;
  if (isAnimating) {
    actionQueue.push({ type: 'round', round: currentRound });
    return;
  }
  if (previousRound == currentRound-1 && previousRound > 0) {
    // If the source round has no transfers, skip ahead to the first that does,
    // draw that round, and animate from there.
    if (!roundHasTransfers(previousRound)) {
      const target = nextRoundWithTransfers(previousRound);
      previousRound = target;
      currentRound = target + 1;
      animateOneRoundFn();
      // Notify controller after animation has started, so the reactive
      // echo doesn't interfere. isAnimating is now true, so goToNextRound
      // will queue rather than act on the echo.
      tryRequestRoundChange(currentRound);
      return;
    }
    animateOneRoundFn();
  } else {
    setRoundFn(currentRound);
  }
  previousRound = currentRound;
}


// will be bound to prop 'setRound'
function setRoundFn(round:number): void {
  // console.log('setRoundFn called');
  if (isAnimating) {
    actionQueue.push({ type: 'round', round: round });
    return;
  }

  displayPhase = 0;
  makeNewPie(round);

}

// will be bound to prop 'animateOneRound'
function animateOneRoundFn() {
  // console.log("animateOneRoundFn called");

  if (isAnimating) {
    actionQueue.push({ type: 'round', round: currentRound });
    return;
  }
  if (currentRound <= 1) {
    console.warn(`animateOneRoundFn: can't animate to round ${currentRound}`);
    return;
  }

  animationRound = currentRound;

  if (animationRound > jsonData.results.length) {
    outlineElected();
    isAnimating = false;
    return;
  }

  isAnimating = true;
  if (displayPhase === 0) {
    animatePhase1(animationRound-1, () => {
      displayPhase = 1;
      animatePhase2(animationRound-1, () => {
        displayPhase = 2;
        animatePhase3(animationRound, () => { displayPhase = 0; stopAnimating(); });
      });
    });
  } else if (displayPhase === 1) {
    animatePhase2(animationRound-1, () => {
        displayPhase = 2;
        animatePhase3(animationRound, () => { displayPhase = 0; stopAnimating(); });
      });
  } else if (displayPhase === 2) {
    animatePhase3(animationRound, () => { displayPhase = 0; stopAnimating(); });
  }

}

// will be bound to prop 'animateOnePhase'
export function animateOnePhaseFn():void {

  // console.log(`animateOnePhaseFn called, currentRound = ${currentRound}, displayPhase = ${displayPhase}`);


  if (currentRound > jsonData.results.length) {
    outlineElected();
    isAnimating = false;
    return;
  }

  if (isAnimating) {
    actionQueue.push({ type: 'step' });
    return;
  }

  isAnimating = true;
  animationRound = currentRound;

  // displayPhase shows current phase: 0=Eliminate, 1=Transfer, 2=Consolidate
  // Advance displayPhase only after the animation completes (in the callback).
  if (displayPhase === 0) {
    animatePhase1(animationRound, () => { displayPhase = 1; stopAnimating(); });
  } else if (displayPhase === 1) {
    animatePhase2(animationRound, () => { displayPhase = 2; stopAnimating(); });
  } else if (displayPhase === 2) {
    animationRound++;
    tryRequestRoundChange(animationRound);
    animatePhase3(animationRound, () => { displayPhase = 0; stopAnimating(); });
  } else {
    isAnimating = false;
    console.warn('displayPhase out of range at ', displayPhase);
  }
}

function updatePie(round:number):void {
  pieDataGlobal = prepareTransitionData(round);
  pieInfoGlobal = updatePieChart(round, pieChartID, pieDataGlobal, 0, smallPieRadius(), true);
  // Update shadow outline pie in sync — exit() in applyDataJoin handles cleanup
  updatePieChart(round, pieOutlineID, pieDataGlobal, 0, smallPieRadius(), false, true);
}



function shrinkDonut(innerRadius:number,outerRadius:number):void {

  const chart = d3.select<SVGSVGElement | null, any>(svg)
                  .select('#'+donutChartID);

  const g = d3.select<SVGSVGElement | null, any>(svg);
  const pieChart = g.select('#' + pieChartID);

  // Build a map of candidate name → { oldStart, oldEnd, newStart, newEnd }
  // from the main pie's prevStart/prevEnd attrs and the new pieInfoGlobal.
  const candidateAngles: Record<string, {
    oldStart: number, oldEnd: number, newStart: number, newEnd: number
  }> = {};
  for (const info of pieInfoGlobal) {
    const label = info.data.label;
    if (info.data.isTransfer) continue;
    const sliceEl = pieChart.select<SVGGElement>('#' + CSS.escape(pieKey(info.data)));
    if (sliceEl.empty()) continue;
    candidateAngles[label] = {
      oldStart: Number(sliceEl.attr('prevStart')),
      oldEnd: Number(sliceEl.attr('prevEnd')),
      newStart: info.startAngle,
      newEnd: info.endAngle
    };
  }

  const slices = chart.selectAll<SVGPathElement, PieInfoType>('.slice');

  let slicesLeft = slices.size();
  function cleanUpAtEnd() {
    slicesLeft--;
    if (slicesLeft === 0) {
      removeFinishedText();
    }
  }

  slices
    .select('path')
      .transition('global')
      .duration(shortTransition)
      .attrTween('d', function(d) {
        const donutStart = d.startAngle;
        const donutEnd = d.endAngle;
        const donutAngle = donutEnd - donutStart;

        // Find where this donut slice's target candidate is moving
        const target = candidateAngles[d.data.label];
        let targetStart: number, targetEnd: number;
        if (target) {
          // Donut slice's offset relative to old candidate midpoint
          const oldMid = (target.oldStart + target.oldEnd) / 2;
          const newMid = (target.newStart + target.newEnd) / 2;
          const offset = donutStart - oldMid;
          targetStart = newMid + offset;
          targetEnd = targetStart + donutAngle;
        } else {
          // Exhausted or unmatched — keep in place
          targetStart = donutStart;
          targetEnd = donutEnd;
        }

        const interpStart = d3.interpolate(donutStart, targetStart);
        const interpEnd = d3.interpolate(donutEnd, targetEnd);
        const interpOuter = d3.interpolate(outerRadius, innerRadius);

        const arc = d3.arc<DefaultArcObject>();

        return function(t) {
          // innerRadius-1 avoids a D3 arc degenerate path when inner === outer
          arc.innerRadius(Math.min(interpOuter(t), innerRadius) - 1)
             .outerRadius(interpOuter(t))
             .startAngle(interpStart(t))
             .endAngle(interpEnd(t));
          return arc(d as unknown as DefaultArcObject)!;
        };
      })
      .on('end', d => cleanUpAtEnd());

}


function displayDonut(round: number):void {
  const donutInfo = makeDonutInfo(round, pieInfoGlobal);
  donutInfoGlobal = createPieChartWithInfo(round, donutChartID, donutInfo, pieChartCenterX, pieChartCenterY,
                                           smallPieRadius(), largePieRadius(), false, true);

  // Raise pie and outline groups so they render after (on top of) the donut group.
  // Order: donut, pie, outline — so outline strokes are on top of everything.
  const svgEl = d3.select<SVGSVGElement | null, any>(svg);
  svgEl.select('#' + pieChartID).raise();
  svgEl.select('#' + pieOutlineID).raise();
}




function updateDonut(round: number):void {

  const newDonutInfo = updateDonutInfo(round, donutInfoGlobal, pieInfoGlobal);
  donutInfoGlobal = updatePieChartWithInfo(round, donutChartID, newDonutInfo,
                          smallPieRadius(), largePieRadius(), false);
}


function pickColor(d:PieInfoType) {
  return pieColors[d.data.label];
}

type NameNumberMap = {
  [key:string]:number
}
// return an object that maps all the candidate names to all the transfers to them
// on a given round
function getTransferVotes(round: number) {

  const result:NameNumberMap = {};
  const tallyResults = jsonData.results[round-1].tallyResults;
  for (let i = 0; i<tallyResults.length; i++) {
    let transferFrom = tallyResults[i].eliminated;
    if (transferFrom === undefined)
      transferFrom = tallyResults[i].elected;

    if (transferFrom === undefined) {
      console.warn('getTransferVotes: Eliminated and Elected undefined...');
      continue;
    }
    const transfers = tallyResults[i].transfers;
    if (transfers === undefined){
      console.warn('getTransferVotes: transfers undefined...');
      continue;
    }
    for (let [name, votes] of Object.entries(transfers)) {
      if (result[name]===undefined)
        result[name] = Number(votes);
      else
        result[name] += Number(votes);
    }
  }
  return result;
}

// Build donut slice info from the main pie's pieInfo and the round's transfer data.
// The donut shows where eliminated/elected candidate votes are going.
function makeDonutInfo(round:number, pieInfo:PieInfoArray):PieInfoArray {

  const donutInfo:PieInfoArray = [];
  const totalVotes:number = originalTotalVotes;
  const tallyResults:RCtabTallyResults[] = jsonData.results[round-1].tallyResults;
  const elected:boolean = false;

  for (let i = 0; i<tallyResults.length; i++) {

    let transferFrom = tallyResults[i].eliminated;
    if (transferFrom === undefined) {
      transferFrom = tallyResults[i].elected;
    }
    if (transferFrom === undefined) {
      console.warn('MakeDonutInfo: Eliminated and Elected undefined...');
      continue;
    }

    const transfers:RCtabTally = tallyResults[i].transfers;
    if (transfers === undefined) {
      console.warn('makeDonutInfo: transfers undefined...');
      continue;
    }

    // Look for the transfer slice first (elected candidate's surplus portion), fall back to main slice
    let transferFromData = pieInfo.find((obj:PieInfoType) => obj.data.label == transferFrom && obj.data.isTransfer);
    if (transferFromData === undefined)
      transferFromData = pieInfo.find((obj:PieInfoType) => obj.data.label == transferFrom && !obj.data.isTransfer);
    let startAngle:number = 0;
    if (transferFromData)
      startAngle = transferFromData.startAngle;
    else {
      console.warn('makeDonutInfo: No transfers');
      continue;
    }

    for (let [name, votes] of Object.entries(transfers)) {

      let newObj:PieInfoType;
      const transferToData = pieInfo.find((obj:PieInfoType) => obj.data.label == name);
      if (transferToData) {
        newObj = structuredClone(transferToData);

      } else if (name == 'exhausted') {
        newObj = {data: {label:name, value:Number(votes)},
                  value: 0, index: 0, startAngle:0, endAngle:0, padAngle:0};  // only needed to keep Typescript happy.
      } else if (name == 'residual surplus') {
        continue;  // expected in RCTab output; silently ignore
      } else {
        console.warn('makeDonutInfo: unrecognized name in transfers ', name);
        continue;
      }


      const transferVotes = Number(votes); // This is the number of votes to be transferred to this candidate
      const sliceAngle = (transferVotes/totalVotes) * 2 * Math.PI;

      newObj.startAngle = startAngle;
      startAngle = newObj.endAngle = (startAngle + sliceAngle);
      // modify startAngle for next slice.
      newObj.index = i;
      newObj.data.transferIndex = i;

      donutInfo.push(newObj);
    }
  }
  return donutInfo;
}

function getTransferStartAngles(transferVotes:NameNumberMap, totalVotes:number, pieInfo:PieInfoArray) {

  const transferStartAngles:NameNumberMap = {};
  for (let [name, votes] of Object.entries(transferVotes)) {

    const mainPieObj = pieInfo.find(obj => name == obj.data.label);
    if (mainPieObj === undefined) {
      if (name !== 'residual surplus') {
        console.warn( 'getTransferStartAngles: mainPieObj not found for ', name);
      }
      continue;
    }
    const midpoint = (mainPieObj.startAngle + mainPieObj.endAngle)/2;
    const transferAngle = transferVotes[mainPieObj.data.label]/totalVotes * 2 * Math.PI;

    transferStartAngles[mainPieObj.data.label] = midpoint - transferAngle/2;
  }
  return transferStartAngles;
}

function updateDonutInfo(round: number, donutInfo:PieInfoArray, pieInfo:PieInfoArray) {

  const newDonutInfo = [];
  const totalVotes = originalTotalVotes;
  const transferVotes = getTransferVotes(round);
  const transferStartAngles = getTransferStartAngles(transferVotes, totalVotes, pieInfo);

  for (let [i,d] of donutInfo.entries()) {

    const newObj = structuredClone(d);
    const sliceAngle = d.endAngle - d.startAngle;

    // now find where the corresponding slice in the main pie is.
    const mainPieObj = pieInfo.find(obj => d.data.label === obj.data.label && !obj.data.isTransfer);

    if (mainPieObj) {
      const sliceName = mainPieObj.data.label;
      newObj.startAngle = transferStartAngles[sliceName];
      transferStartAngles[sliceName] += sliceAngle;
      newObj.endAngle = newObj.startAngle + sliceAngle;

    } else {
      if (d.data.label === 'exhausted') {
        newObj.startAngle = d.startAngle;
        newObj.endAngle = d.endAngle;
      } else {
        console.warn('updateDonutInfo: unrecognized slice name ', d.data.label);
        continue;
      }
    }
    newObj.index = i;
    newDonutInfo.push(newObj);
  }
  return newDonutInfo;
}


/**
 * Compute which labels can be displayed without overlapping.
 * Renders all candidate labels invisibly, measures bounding boxes,
 * then greedily selects labels in descending vote order, skipping
 * any that would overlap a previously placed label.
 * Returns a Set of candidate labels that should be visible.
 */
function computeVisibleLabels(round: number, pieInfo: PieInfoArray,
                               outerRadius: number,
                               parentGroup: d3.Selection<SVGGElement, unknown, null, undefined>): Set<string> {
  const textArc = d3.arc<PieOrArc>()
    .innerRadius(outerRadius * textArcRadius)
    .outerRadius(outerRadius * textArcRadius);

  // Render all non-transfer labels invisibly to measure bounding boxes
  const candidates = pieInfo.filter(d => !d.data.isTransfer && d.data.value > 0);
  const measurements: { label: string; value: number; bbox: DOMRect }[] = [];

  const tempGroup = parentGroup.append('g').attr('opacity', 0);

  for (const d of candidates) {
    const displayName = d.data.label === 'exhausted' ? exhaustedLabel : d.data.label;
    const centroid = textArc.centroid(d as any);
    const anchor = textLabelPosition(d.startAngle, d.endAngle);
    const votes = candidateVotesStr(d.data.label, round);
    let secondLine: string;
    if (!firstRoundDeterminesPercentages && isExhaustedLabel(d.data.label)) {
      secondLine = votes;
    } else {
      secondLine = votes + ' (' + candidatePercentage(d.data.label, round) + ')';
    }

    const textEl = tempGroup.append('text')
      .attr('transform', `translate(${centroid})`)
      .attr('text-anchor', anchor)
      .text(displayName);
    textEl.append('tspan')
      .attr('x', 0)
      .attr('dy', '1.2em')
      .text(secondLine);

    const bbox = (textEl.node() as SVGTextElement).getBBox();
    // getBBox is in local coords — offset by centroid for absolute position
    measurements.push({
      label: d.data.label,
      value: d.data.value,
      bbox: new DOMRect(bbox.x + centroid[0], bbox.y + centroid[1], bbox.width, bbox.height),
    });
  }

  tempGroup.remove();

  // Sort by vote count descending — biggest labels get priority
  measurements.sort((a, b) => b.value - a.value);

  const placed: DOMRect[] = [];
  const visible = new Set<string>();

  for (const m of measurements) {
    const overlaps = placed.some(p =>
      m.bbox.left < p.right && m.bbox.right > p.left &&
      m.bbox.top < p.bottom && m.bbox.bottom > p.top
    );
    if (!overlaps) {
      visible.add(m.label);
      placed.push(m.bbox);
    }
  }

  return visible;
}

function displayTextLabels(round: number, pieInfo:PieInfoArray,
                            x:number, y:number, outerRadius:number, eliminatedCandidates:string[]) {

  const g = d3.select<SVGSVGElement | null, any>(svg);

  const textLayer = g.append('g')
    .attr('id', textLayerID)
    .attr('transform', `translate(${x}, ${y})`);

  const textArc = d3.arc<PieOrArc>()
    .innerRadius(outerRadius * textArcRadius)
    .outerRadius(outerRadius * textArcRadius);

  // Compute which labels fit without overlapping
  const visibleLabels = computeVisibleLabels(round, pieInfo, outerRadius, textLayer);

  const textSlices = textLayer.selectAll<SVGTextElement, PieInfoType>('text')
    .data(pieInfo)
    .enter()
    .each(function (d:PieInfoType) {
      if (!d.data.isTransfer && visibleLabels.has(d.data.label)) {
        d3.select<SVGGElement, PieInfoType>(this as SVGGElement)
          .append('g')
          .attr('id', d => pieKey(d.data))
          .classed('eliminated', (d:PieInfoType) => eliminatedCandidates.includes(d.data.label) ||
                                                                    d.data.isTransfer === true)
          .each(function (d,i) {
            if (d.data.label==='exhausted') {
              d3.select(this as SVGGElement)
                .on('mouseenter', (d,i) => showExhaustedExplainer(d,i))
                .on('mouseleave', (d,i) => hideExhaustedExplainer(d,i));
            }
          })
          .append('text')
            .attr('transform', d => `translate(${textArc.centroid(d)})`)
            .attr('text-anchor', d => textLabelPosition(d.startAngle, d.endAngle))

            .text(d => d.data.label==='exhausted'? exhaustedLabel : d.data.label)
            .append('tspan')
              .attr('x', 0)
              .attr('dy', '1.2em')
              .text(d => {
                const votes = candidateVotesStr(d.data.label, round);
                // When using per-round percentages, exhausted votes would push
                // the total over 100%, so show only the vote count.
                if (!firstRoundDeterminesPercentages && isExhaustedLabel(d.data.label)) {
                  return votes;
                }
                return votes + ' (' + candidatePercentage(d.data.label, round) + ')';
              });
      }
    });
  }



function moveTextLabels(round: number, pieInfo:PieInfoArray, outerRadius:number, eliminatedCandidates:string[]) {
  const g = d3.select<SVGSVGElement | null, any>(svg);
  const textLayer = g.select('#' + textLayerID);

  // Compute which labels will be visible at the destination
  const destVisible = computeVisibleLabels(round, pieInfo, outerRadius, textLayer);

  // Hide labels that won't be visible at destination before the transition
  textLayer.selectAll<SVGGElement, PieInfoType>('g').each(function(d) {
    if (d && d.data && !d.data.isTransfer && !destVisible.has(d.data.label)) {
      d3.select(this).remove();
    }
  });

  const tspans = textLayer.selectAll<SVGTSpanElement, PieInfoType>('tspan');

  const textGroups = textLayer.selectAll<SVGGElement, PieInfoType>('g')
    .data(pieInfo, d => pieKey(d.data))
    .classed('eliminated', d => eliminatedCandidates.includes(d.data.label) ||
                                              d.data.isTransfer === true);
  const textArc = d3.arc<PieOrArc>()
    .innerRadius(outerRadius * textArcRadius)
    .outerRadius(outerRadius * textArcRadius+1);


  tspans
    .transition('global')
    .duration(shortTransition)
    .attr('transform', d => `translate(${textArc.centroid(d)})`)
    .attr('text-anchor', d => textLabelPosition(d.startAngle,d.endAngle));

  textGroups
    .select('text')
    .transition('global')
    .duration(shortTransition)
    .attr('transform', d => `translate(${textArc.centroid(d)})`)
    .attr('text-anchor', d => textLabelPosition(d.startAngle,d.endAngle))
    .on('end', d => redraw(d));

    let textsRemaining = textGroups.size();
    function redraw(d:any) {
        // This is a kludge because d3.js doesn't reliably move all the tspans with the texts.
        // D3 was not transitioning the last tspan on the list for unknown reasons.
        // If we want to see both lines of text moving, we can't regenerate the text in the transition.
        // But then we have to redisplay at the end, and it is more reliable to just redraw the text.
        // So this is OK.  There's no visible erasing and redrawing and both lines smoothly move.
        textsRemaining--;
        if (textsRemaining === 0) {
          textLayer.remove();
          displayTextLabels(round, pieInfo, pieChartCenterX, pieChartCenterY, outerRadius, eliminatedCandidates);

        }
    }
}



function createPieChart(round: number, chartID:string, data:PieDataArray,
                        x:number, y:number, innerRadius:number, outerRadius:number,
                        displayText:boolean = true, growChart:boolean = false,
                        outlineOnly:boolean = false):PieInfoArray {

  const pie = d3.pie<PieData>()
    .sort(null)
    .value(d => d.value);
  const pieInfo:PieInfoArray = pie(data);

  createPieChartWithInfo(round, chartID, pieInfo,
                          x, y, innerRadius, outerRadius,
                          displayText, growChart, outlineOnly);
  return pieInfo;

}

function outlineElected() {
  const g = d3.select<SVGSVGElement | null, any>(svg);
  const outline = g.select('#' + pieOutlineID);
  outline.selectAll<SVGGElement, PieInfoType>('.elected')
    .select('path')
    .style('stroke', electedOutlineColor)
    .style('stroke-width', `${electedOutlineWidth}px`);
}

// Generic function to create pie charts.
// outlineOnly: if true, paths are invisible (fill/stroke none) — used for the shadow outline pie.
function createPieChartWithInfo(round: number, chartID:string, info:PieInfoArray,
                              x:number, y:number, innerRadius:number, outerRadius:number,
                              displayText:boolean, growChart:boolean,
                              outlineOnly:boolean = false) :PieInfoArray {

  const eliminatedCandidates = getEliminatedCandidates(round);
  const electedCandidates = getElectedCandidates(round);

  const g = d3.select<SVGSVGElement|null, any>(svg)
    .attr('viewBox', `0 0 ${width} ${height}`)
    .attr('preserveAspectRatio', 'xMidYMid meet')
    .classed('pie-chart-svg', true);


  const chart = g.append('g')
    .attr('id',chartID)
    .attr('transform', `translate(${x}, ${y})`);


  const slices = chart.selectAll<SVGGElement, PieInfoType>('.slice')
    .data(info)
    .enter()
    .append('g')
    .attr('class', 'slice')
    .classed('eliminated', d => eliminatedCandidates.includes(d.data.label) ||
                                          d.data.isTransfer === true)
    .classed('elected', d => electedCandidates.includes(d.data.label) &&
                                          !d.data.isTransfer)
    .attr('id', d => pieKey(d.data));

  if (!outlineOnly) {
    slices
      .on('mouseenter', (d,i) => handleMouseEnter(d,i))
      .on('mouseleave', (d,i) => handleMouseLeave(d,i));
  } else {
    slices.style('pointer-events', 'none');
  }

  const radialArc = d3.arc<PieOrArc>()
    .outerRadius(outerRadius)
    .innerRadius(innerRadius);

  if (growChart) {

    // innerRadius+1 avoids a D3 arc degenerate path when inner === outer
    const oldArc = d3.arc<PieOrArc>()
      .outerRadius(innerRadius+1)
      .innerRadius(innerRadius);

    const paths = slices
      .append('path')
        .attr('d', oldArc)
        .attr('stroke', outlineOnly ? 'none' : innerRadius === 0 ? sliceSeparatorColor : 'none')
        .attr('stroke-width', outlineOnly ? 0 : innerRadius === 0 ? sliceSeparatorWidth : 0)
        .attr('fill', outlineOnly ? 'none' : (d => pickColor(d)))
        .transition('global')
        .duration(shortTransition)
        .attr('d', d => radialArc(d))
        .on('end', d => { if (!outlineOnly) raiseText(); });

  } else {
    slices
      .append('path')
        .attr('d', d => radialArc(d))
        .attr('fill', outlineOnly ? 'none' : (d => pickColor(d)))
        .attr('stroke', outlineOnly ? 'none' : sliceSeparatorColor)
        .attr('stroke-width', outlineOnly ? 0 : sliceSeparatorWidth);

    if (!outlineOnly) raiseText();
  }

  if (displayText && !outlineOnly) {
    displayTextLabels(round, info, x, y, outerRadius, eliminatedCandidates);
  }
  return info;

}


function markTextFinished() {
  const g = d3.select<SVGSVGElement | null, any>(svg);
  const textLayer = g.select('#' + textLayerID);
  const textGroups = textLayer.selectAll<SVGGElement, PieInfoType>('.eliminated');
  if (textGroups.size() > 0)
    textGroups.classed('finished', true);
}

function removeFinishedText() {

  const g = d3.select<SVGSVGElement | null, any>(svg);
  const textLayer = g.select('#' + textLayerID);
  const textGroups = textLayer.selectAll('.finished');
  if (textGroups.size() > 0)
    textGroups.remove();
}

function grayOutEliminated(innerRadius:number,outerRadius:number) {

  const g = d3.select<SVGSVGElement | null, any>(svg);
  const chart = g.select('#' + pieChartID);
  const slices = chart.selectAll<SVGGElement, PieInfoType>('.eliminated');

  const solidArc = d3.arc<DefaultArcObject>()
    .innerRadius(innerRadius);

  const hatchedArc = d3.arc<DefaultArcObject>()
    .outerRadius(outerRadius);

  slices
    .classed('finished', true)
    .select('path')
      .attr('stroke', 'none')
      .transition('global')
      .duration(shortTransition)
      .attrTween('d', function(d) {
          const interpolateRadius = d3.interpolate(outerRadius, innerRadius);

          return function(t) {
            hatchedArc.innerRadius(interpolateRadius(t));
            return hatchedArc(d as unknown as DefaultArcObject)!;
          };
        })
      .attr('fill', (d:PieInfoType) => `url(#${hatchPatternId(d.data.label)})`);


  slices
    .clone(true)
    .classed('finished', true)
    .select('path')
      .transition('global')
      .duration(shortTransition)
      .attrTween('d', function(d) {
          const interpolateRadius = d3.interpolate(outerRadius, innerRadius);

          return function(t:number) {
            solidArc.outerRadius(interpolateRadius(t));
            return solidArc(d as unknown as DefaultArcObject)!;
          };
        })
      .attr('fill', d => pickColor(d));
}

function textLabelPosition(startAngle:number,endAngle:number):string {

  const avg = (startAngle + endAngle) /2;

  if (avg > Math.PI * 11/6 || avg < Math.PI * 1/6)
    return 'middle';
  if (avg > Math.PI * 5/6 && avg < Math.PI * 7/6)
    return 'middle';
  if (avg < Math.PI)
    return 'start';
  else
    return 'end';
}

function raiseText():void {
  d3.select<SVGSVGElement | null, any>(svg).select('#'+textLayerID)  // force redisplay of text labels
        .raise()
        .append('g')
        .remove();
}

function updatePieChart(round: number, chartID:string, newData:PieDataArray,
                        innerRadius:number, outerRadius:number,
                        displayText:boolean,
                        outlineOnly:boolean = false) : PieInfoArray {

  const updatedPie = d3.pie<PieData>()
    .sort(null)
    .value(d => d.value);
  const pieInfo:PieInfoArray = updatedPie(newData);

  updatePieChartWithInfo(round, chartID, pieInfo,
                          innerRadius, outerRadius, displayText, outlineOnly);

  return pieInfo;
}

// Data join core: bind new pie data to existing slices, enter new slices,
// update classes. Returns the d3 selection of existing (update) slices.
// Used by both updatePieChartWithInfo (with transition) and applySplitToChart (instant).
function applyDataJoin(round: number, chartID: string, pieInfo: PieInfoArray,
                       radialArc: d3.Arc<any, PieOrArc>,
                       outlineOnly: boolean = false) {

  const eliminatedCandidates = getEliminatedCandidates(round);
  const electedCandidates = getElectedCandidates(round);

  const g = d3.select<SVGSVGElement | null, any>(svg);
  const chart = g.select('#'+chartID);

  const slices = chart.selectAll<SVGGElement, PieInfoType>('.slice')
    .data(pieInfo, d => pieKey(d.data));

  // Exit: remove slices no longer in the data (eliminated candidates
  // drop out of prepareTransitionData one round after elimination,
  // along with any clones created by grayOutEliminated).
  slices.exit().remove();

  // Enter new slices (transfer sub-slices when splitting elected candidates)
  const entered = slices
    .enter()
    .append('g')
    .attr('class', 'slice')
    .attr('id', d => pieKey(d.data))
    .classed('eliminated', true);

  if (!outlineOnly) {
    entered
      .on('mouseenter', (d,i) => handleMouseEnter(d,i))
      .on('mouseleave', (d,i) => handleMouseLeave(d,i));
  } else {
    entered.style('pointer-events', 'none');
  }

  entered
    .append('path')
      .attr('d', d => radialArc(d))
      .attr('fill', outlineOnly ? 'none' : (d => pickColor(d)))
      .attr('stroke', outlineOnly ? 'none' : sliceSeparatorColor)
      .attr('stroke-width', outlineOnly ? 0 : sliceSeparatorWidth);

  // Update classes on existing slices
  slices
    .classed('eliminated', d => eliminatedCandidates.includes(d.data.label))
    .classed('elected', d => electedCandidates.includes(d.data.label));

  if (!outlineOnly) {
    slices
      .on('mouseenter', (d,i) => handleMouseEnter(d,i))
      .on('mouseleave', (d,i) => handleMouseLeave(d,i));
  }

  return slices;
}

// Apply split data to a chart instantly (no transition).
// Updates existing slice paths to new angles and enters new slices.
function applySplitToChart(round: number, chartID: string, pieInfo: PieInfoArray,
                           innerRadius: number, outerRadius: number,
                           outlineOnly: boolean = false): void {

  const radialArc = d3.arc<PieOrArc>()
    .outerRadius(outerRadius)
    .innerRadius(innerRadius);

  const slices = applyDataJoin(round, chartID, pieInfo, radialArc, outlineOnly);

  // Update existing slice paths instantly (no transition)
  slices
    .select<SVGPathElement>('path')
      .attr('d', d => radialArc(d))
      .attr('fill', outlineOnly ? 'none' : (d => pickColor(d)));
}

function updatePieChartWithInfo(round: number, chartID:string, pieInfo:PieInfoArray,
                                innerRadius:number, outerRadius:number, displayText:boolean,
                                outlineOnly:boolean = false):PieInfoArray {

  const rotatorArc = d3.arc<DefaultArcObject>()
    .outerRadius(outerRadius)
    .innerRadius(innerRadius)
    .startAngle(d => d.startAngle)
    .endAngle(d => d.endAngle);

  const radialArc = d3.arc<PieOrArc>()
    .outerRadius(outerRadius)
    .innerRadius(innerRadius);

  const g = d3.select<SVGSVGElement | null, any>(svg);
  const chart = g.select('#'+chartID);

  chart.selectAll<SVGGElement, PieInfoType>('.slice')
      .attr('prevStart', d => d.startAngle)
      .attr('prevEnd', d => d.endAngle);

  const slices = applyDataJoin(round, chartID, pieInfo, radialArc, outlineOnly);

  let transitionsRemaining = slices.size();

  function raiseTextAtEnd() {
    transitionsRemaining--;
    if (transitionsRemaining <= 0) {
      if (!outlineOnly) {
        raiseText();
      }
    }
  }
    // Update existing slices
  slices
    .select<SVGPathElement>('path')
      .transition('global')
      .duration(shortTransition)
      .attrTween('d', function(d) {
        const prevStartAngle = Number(d3.select(this.parentNode as Element).attr('prevStart'));
        const prevEndAngle = Number(d3.select(this.parentNode as Element).attr('prevEnd'));

        const interpolateStartAngle = d3.interpolate(prevStartAngle, d.startAngle);
        const interpolateEndAngle = d3.interpolate(prevEndAngle, d.endAngle);

        return t => {
          rotatorArc
            .startAngle(interpolateStartAngle(t))
            .endAngle(interpolateEndAngle(t));
          return rotatorArc(d as unknown as DefaultArcObject)!;
        };
      })
      .on('end', function(d) {
        // Clear stroke on slices that transitioned to zero width
        if (d.startAngle === d.endAngle) {
          d3.select(this).attr('stroke', 'none');
        }
        raiseTextAtEnd();
      });


    if (displayText && !outlineOnly)
      moveTextLabels(round, pieInfo, outerRadius, getEliminatedCandidates(round));

    return pieInfo;
}


function getExhaustedVotes() {
  let exhaustedVotes = 0;
  for (let d of donutInfoGlobal) {
    if (d.data.label === 'exhausted'){
      exhaustedVotes += Number(d.data.value);
    }
  }
  return exhaustedVotes;
}

function handleMouseEnter(event:MouseEvent, d:any) {
  mouseData = d.data.label;
  mouseEventType = 'enter';
  mouseX = event.clientX;
  mouseY = event.clientY;
}

function handleMouseLeave(event:Event, d:any) {
  mouseData = d.data.label;
  mouseEventType = 'leave';
}

function showExhaustedExplainer(event:MouseEvent,d:any) {
  mouseEventType = 'show-exhausted';
  mouseX = event.clientX;
  mouseY = event.clientY;
}

function hideExhaustedExplainer(event:Event,d:any) {
  mouseEventType = 'hide-exhausted';
}


</script>

<style>

.pie-chart-svg {
  width: 100%;
  height: 100%;
  max-width: 700px;
  max-height: 60vh;
  aspect-ratio: 1 / 1; /* For a perfect circle, use 1:1 ratio */
  margin: 0 auto;
  display: block;
}

@media (max-width: 768px) {
  .pie-chart-svg {
    max-height: 60vh;
  }
}


</style>

<svg class="pie-chart-svg" bind:this={svg} >

  <defs>

    <filter id='text-top-filter'>
      <feBlend mode='normal' in='SourceGraphic' in2='BackgroundImage' />
    </filter>

    <pattern id='cross-hatch' width='7' height='7' patternUnits='userSpaceOnUse'>
      <rect width='7' height='7' fill='transparent' />
      <circle cx='1.75' cy='1.75' r='1.5' fill='lightgray' />
      <circle cx='5.25' cy='5.25' r='1.5' fill='lightgray' />
    </pattern>

  </defs>

</svg>
