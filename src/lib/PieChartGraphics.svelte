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
  mouseY = $bindable(),
  requestRoundChange = ((r:number) => {}),
  candidateColors = [],
  excludeFinalWinnerAndEliminatedCandidate = false,
} : {
  jsonData: RCtabSummary,
  currentRound: number,
  mouseEventType: string,
  mouseData: string,
  mouseY: number,
  requestRoundChange: ((r:number)=>void) | null,
  candidateColors: string[],
  excludeFinalWinnerAndEliminatedCandidate: boolean,
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
const donutChartID = 'Donut';
const textLayerID = 'TextLayer';
const darkHashing = true;

const exhaustedColor = 'url(#cross-hatch)';

const textArcRadius = 1.15;   // multiple of the pie chart radius where text labels go
const minimumTextAngle = 0.1; // minimum number of radians of a text slice to display label

const shortTransition = 750;
const longTransition = 800;

// SVG pattern IDs derived from candidate names. Must sanitize all non-alphanumeric
// characters — apostrophes, quotes, etc. break CSS url(#...) references.
function hatchPatternId(name: string): string {
  return 'hatch-' + name.replace(/[^a-zA-Z0-9]/g, '-');
}


let pieInfoGlobal:PieInfoArray = [];
let donutInfoGlobal:PieInfoArray = [];
let pieDataGlobal:PieDataArray = [];

let originalTotalVotes:number = 0;

let displayPhase:number = $state(0);    // $state just to make it inspectable
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

// returns a formatted string with the percentage of the vote for a candidate on a given round
function candidatePercentage(candidate:string, round:number):string {
  const fraction = candidateVotes(candidate,round)/originalTotalVotes;
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

// makes a list of either eliminated or elected candidates on a given round
// from the JSON summary object.
//
function chosenCandidates(round:number, key:'eliminated'|'elected'):string[] {
    if (!round || round < 1 || round > jsonData.results.length) {
      console.warn('In chsoenCandidates: round ${round} is out of range.');
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
  return result;
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


function prepareRoundData(round:number):PieDataArray {

  const summaryResults = jsonData.results;
  let roundTally = summaryResults[Math.max(0,round-2)].tally;
  const newData:PieDataArray = [];
  const resultData:PieDataArray = [];
  for (let [name, votes] of Object.entries(roundTally)) {
      newData.push({label: name,
                    value: 0});
  }

  roundTally = summaryResults[round-1].tally;
  for (let newObj of newData) {
    const newValue = Number(roundTally[newObj.label]);
    const electedTransfers = countElectedTransfers(newObj.label, round);
    if (electedTransfers > 0) {
      resultData.push({label: newObj.label, value: electedTransfers, isTransfer: true});
      newObj.value = newValue - electedTransfers;
      resultData.push(newObj)
    } else {
      newObj.value = newValue;
      resultData.push(newObj);
    }
  }

  const exhaustedVotes = countExhaustedVotes(round);
  resultData.push({ label: 'exhausted',
                 value: exhaustedVotes });

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
  animatePhase1(animationRound-1, () => {
    animatePhase2(animationRound-1, () => {
      animatePhase3(animationRound, stopAnimating);
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

  const nextPhase = animationRound < jsonData.results.length - 1 ?
      runAnimationCycle : stopAnimating;

  animatePhase1(animationRound, () => {
    animatePhase2(animationRound, () => {
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
  if (previousRound == currentRound-1 && previousRound > 0)
    animateOneRoundFn();
  else
    setRoundFn(currentRound);
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
      animatePhase2(animationRound-1, () => {
        animatePhase3(animationRound, stopAnimating);
      });
    });
  } else if (displayPhase === 1) {
    animatePhase2(animationRound-1, () => {
        animatePhase3(animationRound, stopAnimating);
      });
  } else if (displayPhase === 2) {
    animatePhase3(animationRound, stopAnimating);
  }
  displayPhase = 0;

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
  displayPhase = (displayPhase + 1) % 3;
  animationRound = currentRound;

  if (displayPhase === 1) {
    animatePhase1(animationRound, stopAnimating);
  } else if (displayPhase === 2) {
    animatePhase2(animationRound, stopAnimating);
  } else if (displayPhase === 0) {
    animationRound++;
    tryRequestRoundChange(animationRound);
    animatePhase3(animationRound, stopAnimating);
  } else {
    isAnimating = false;
    console.warn('displayPhase out of range at ', displayPhase);
  }
}

function updatePie(round:number):void {
  pieDataGlobal = prepareRoundData(round);
  pieInfoGlobal = updatePieChart(round, pieChartID, pieDataGlobal, 0, smallPieRadius(), true);
}



function shrinkDonut(innerRadius:number,outerRadius:number):void {

  const chart = d3.select<SVGSVGElement | null, any>(svg)
                  .select('#'+donutChartID);

  // Destination arc shrinks slices down to the inner edge of the pie.
  // innerRadius-1 avoids a D3 arc degenerate path when inner === outer.
  const updatedArc = d3.arc<DefaultArcObject>()
    .outerRadius(innerRadius)
    .innerRadius(innerRadius-1);

  const slices = chart.selectAll<SVGPathElement, DefaultArcObject>('.slice');

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
      .attr('d', d => updatedArc(d))
      .on('end', d => cleanUpAtEnd());

}


function displayDonut(round: number):void {
  const donutInfo = makeDonutInfo(round, pieInfoGlobal);
  donutInfoGlobal = createPieChartWithInfo(round, donutChartID, donutInfo, pieChartCenterX, pieChartCenterY,
                                           smallPieRadius(), largePieRadius(), false, true);
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
        console.warn('makeDonutInfo: residual surplus = ', votes);
        continue;
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
      console.warn( 'getTransferStartAngles: mainPieObj not found for ', name);
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


function displayTextLabels(round: number, pieInfo:PieInfoArray,
                            x:number, y:number, outerRadius:number, eliminatedCandidates:string[]) {

  const g = d3.select<SVGSVGElement | null, any>(svg);

  const textLayer = g.append('g')
    .attr('id', textLayerID)
    .attr('transform', `translate(${x}, ${y})`);

  const textArc = d3.arc<PieOrArc>()
    .innerRadius(outerRadius * textArcRadius)
    .outerRadius(outerRadius * textArcRadius);

  const textSlices = textLayer.selectAll<SVGTextElement, PieInfoType>('text')
    .data(pieInfo)
    .enter()
    .each(function (d:PieInfoType) {
      if (!(d.endAngle - d.startAngle < minimumTextAngle ||
            d.data.isTransfer)) {
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
              .text(d => candidateVotesStr(d.data.label,round) + ' (' +
                            candidatePercentage(d.data.label,round) + ')');
      }
    });
  }



function moveTextLabels(round: number, pieInfo:PieInfoArray, outerRadius:number, eliminatedCandidates:string[]) {
  const g = d3.select<SVGSVGElement | null, any>(svg);
  const textLayer = g.select('#' + textLayerID);

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
                        displayText:boolean = true, growChart:boolean = false):PieInfoArray {

  const pie = d3.pie<PieData>()
    .sort(null)
    .value(d => d.value);
  const pieInfo:PieInfoArray = pie(data);

  createPieChartWithInfo(round, chartID, pieInfo,
                          x, y, innerRadius, outerRadius,
                          displayText, growChart);
  return pieInfo;

}

function outlineElected() {
  const g = d3.select<SVGSVGElement | null, any>(svg);
  const chart = g.select('#' + pieChartID);
  chart.selectAll<SVGGElement, PieInfoType>('.elected')
    .style('stroke', 'yellow')
    .style('stroke-width', '2px');
}

// Generic function to create pie charts
function createPieChartWithInfo(round: number, chartID:string, info:PieInfoArray,
                              x:number, y:number, innerRadius:number, outerRadius:number,
                              displayText:boolean, growChart:boolean) :PieInfoArray {

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
    .attr('id', d => pieKey(d.data))
    .on('mouseenter', (d,i) => handleMouseEnter(d,i))
    .on('mouseleave', (d,i) => handleMouseLeave(d,i));

  const radialArc = d3.arc<PieOrArc>()
    .outerRadius(outerRadius)
    .innerRadius(innerRadius);

  if (growChart) {

    // innerRadius+1 avoids a D3 arc degenerate path when inner === outer
    const oldArc = d3.arc<PieOrArc>()
      .outerRadius(innerRadius+1)
      .innerRadius(innerRadius);

    slices
      .append('path')
        .attr('d', oldArc)
        .transition('global')
        .duration(shortTransition)
        .attr('d', d => radialArc(d))
        .attr('fill', d => pickColor(d))
        .on('end', d => raiseText());

  } else {
    slices
      .append('path')
        .attr('d', d => radialArc(d))
        .attr('fill', d => pickColor(d));

    raiseText();
  }

  if (displayText) {
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
                        displayText:boolean) : PieInfoArray {

  const updatedPie = d3.pie<PieData>()
    .sort(null)
    .value(d => d.value);
  const pieInfo:PieInfoArray = updatedPie(newData);

  updatePieChartWithInfo(round, chartID, pieInfo,
                          innerRadius, outerRadius, displayText);

  return pieInfo;
}

function updatePieChartWithInfo(round: number, chartID:string, pieInfo:PieInfoArray,
                                innerRadius:number, outerRadius:number, displayText:boolean):PieInfoArray {

  const eliminatedCandidates = getEliminatedCandidates(round);
  const electedCandidates = getElectedCandidates(round);

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

  const slices = chart.selectAll<SVGGElement, PieInfoType>('.slice')
    .data(pieInfo, d => pieKey(d.data));


  // If there are slices coming in, they are because someone was elected and these
  // are the surplus votes they are transferring away.
  slices
    .enter()
    .append('g')
    .attr('class', 'slice')
    .attr('id', d => pieKey(d.data))
    .classed('eliminated',true)
    .on('mouseenter', (d,i) => handleMouseEnter(d,i))
    .on('mouseleave', (d,i) => handleMouseLeave(d,i))
    .append('path')
      .attr('d', d => radialArc(d))
      .attr('fill', d => pickColor(d));

  // This section is for already existing slices and will not be run for the newly
  // entering slices.
  slices
    .classed('eliminated', d => eliminatedCandidates.includes(d.data.label))
    .classed('elected', d => electedCandidates.includes(d.data.label))
    .on('mouseenter', (d,i) => handleMouseEnter(d,i))
    .on('mouseleave', (d,i) => handleMouseLeave(d,i));


  let transitionsRemaining = slices.size();

  function raiseTextAtEnd() {
    transitionsRemaining--;
    if (transitionsRemaining <= 0) {
      raiseText();
      chart.selectAll<SVGGElement, PieInfoType>('.finished').remove();
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
      .on('end', raiseTextAtEnd);


    if (displayText)
      moveTextLabels(round, pieInfo, outerRadius, eliminatedCandidates);

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
  mouseY = event.clientY;
}

function handleMouseLeave(event:Event, d:any) {
  mouseData = d.data.label;
  mouseEventType = 'leave';
}

function showExhaustedExplainer(event:MouseEvent,d:any) {
  mouseEventType = 'show-exhausted';
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
