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
} : {
  jsonData: RCtabSummary,
  currentRound: number,
  mouseEventType: string,
  mouseData: string,
  mouseY: number,
  requestRoundChange: ((r:number)=>void) | null,
  candidateColors: string[],
} = $props();



interface PieData  {
    label: string;
    value: number;
};

type PieDataArray = PieData[];

/*
// Create a pie generator
const pie = d3.pie<PieData>()

// Generate pie info
const pieInfo:PieInfoArray = pie(data);
*/

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
const transferTag = '#transfer';
const darkHashing = true;

//const exhaustedColor = '#E0E0E0';
const exhaustedColor = 'url(#cross-hatch)';

const textArcRadius = 1.15;   // multiple of the pie chart radius where text labels go
const minimumTextAngle = 0.1; // minimum number of radians of a text slice to display label

const shortTransition = 750;
const longTransition = 800;


let pieInfoGlobal:PieInfoArray = [];
let donutInfoGlobal:PieInfoArray = [];
// let previousPieInfoGlobal;
// let previousDonutInfoGlobal;

let pieDataGlobal:PieDataArray = [];

let originalTotalVotes:number = 0;

let displayPhase:number = $state(0);    // $state just to make it inspectable
let animationRound:number = 0;

export type ColorMap = Record<string,string>;

export const pieColors:ColorMap = {};

export const exhaustedLabel = 'No Further Rankings';

$inspect("currentRound = ", currentRound);
$inspect("DisplayPhase = ", displayPhase);

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

  console.log('PieChartGraphics component loaded and initialized');
  console.log('jsonData is: ', jsonData);

  initPieChartColors();
  setTimeout(() => {
    makeNewPie(currentRound);
  }, 0);

});

function initSummaryData(round: number):PieDataArray {
  // console.log(jsonData.results);
  // initGlobals();
  const pieData:PieDataArray = prepareRoundData(round);
  originalTotalVotes = getTotalVotes(round);
  // console.log('pieData is: ', pieData);
  return pieData;
}

// Maybe don't need this if we force reload on every new display.  Keep temporarily.
/*
function initGlobals() {
  pieInfoGlobal = [];
  donutInfoGlobal =[];
  pieDataGlobal = [];

  originalTotalVotes = 0;

  round = 1;
  displayPhase = 0;

  pieColors = {};
  reportGlobal = [];
  reportTitleGlobal = '';

}
  */



function smallPieRadius():number {
  //const scale = Math.sqrt(getTotalVotes(round)/originalTotalVotes);
  //return Math.floor(scale * pieChartRadius);
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
        //console.log('on round ', r, ' transfers ', transfers);
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

  // console.log('elected candidates are: ', result);
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
  // console.log('votes transferred from elected candidate ', candidate, votesTransferred);
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
      resultData.push({label: newObj.label + transferTag, value: electedTransfers});
      newObj.value = newValue - electedTransfers;
      resultData.push(newObj)
    } else {
      newObj.value = newValue;
      resultData.push(newObj);
    }
  }

  //const exhaustedVotes = Number(jsonData.results[round-1].inactiveBallots.exhaustedChoices);
  const exhaustedVotes = countExhaustedVotes(round);
  // console.log('prepareRoundData: exhausted votes --> ', exhaustedVotes);
  // console.log('prepareRoundData: resultData --> ', resultData);
  resultData.push({ label: 'exhausted',
                 value: exhaustedVotes });

  return resultData;
}

/*
function ZZZprepareRoundData(summaryResults:[], round:number) {

  const roundTally = summaryResults[round-1].tally;
  const resultData = [];
  for (let [name, votes] of Object.entries(roundTally)) {
    const newObj = {label: name, value: Number(votes)};
    const electedTransfers = countElectedTransfers(name, round);
    if (electedTransfers > 0) {
      resultData.push({label: name + transferTag, value: electedTransfers});
      newObj.value -= electedTransfers;
    }
    resultData.push(newObj);
  }

  //const exhaustedVotes = Number(jsonData.results[round-1].inactiveBallots.exhaustedChoices);
  const exhaustedVotes = countExhaustedVotes(round);
  // console.log('prepareRoundData: exhausted votes --> ', exhaustedVotes);
  // console.log('prepareRoundData: resultData --> ', resultData);
  resultData.push({ label: 'exhausted',
                value: exhaustedVotes });

  return resultData;
}
*/


/*
function XXXprepareRoundData(summaryResults:[], round:number) {

  const roundTally = summaryResults[0].tally;
  const newData = [];
  for (let [name, votes] of Object.entries(roundTally)) {
      newData.push({label: name,
                    value: 0});
  }

  roundTally = summaryResults[round-1].tally;
  for (let newObj of newData) {
    newObj.value = Number(roundTally[newObj.label]);
  }

  //const exhaustedVotes = Number(jsonData.results[round-1].inactiveBallots.exhaustedChoices);
  const exhaustedVotes = countExhaustedVotes(round);
  console.log('prepareRoundData: exhausted votes --> ', exhaustedVotes);
  newData.push({ label: 'exhausted',
                    value: exhaustedVotes });

  return newData;
}
*/

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
        .attr('id', name.replaceAll(' ','-'))
        .select('rect')
          .attr('fill', pieColors[name]);
      pattern
        .select('path')
          .attr('stroke', '#505050');

    } else {
      prototypePattern.clone(true)
        .attr('id', name.replaceAll(' ','-'))
        .select('path')
          .attr('stroke', pieColors[name]);
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

  // console.log('animate phase 1');

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
  // console.log('animate phase 2');

  const t = d3.transition('global').duration(longTransition);

  if (nextPhase) {
    t.on("end", nextPhase);
  }
  updateDonut(round);
}

function animatePhase3(round:number, nextPhase:()=>void) {
  // console.log('animate phase 3');

  const t = d3.transition('global').duration(longTransition);
  if (nextPhase)
    t.on("end", nextPhase);

  updatePie(round);
  shrinkDonut(smallPieRadius(), largePieRadius());

}

function stopAnimating() {
  outlineElected();
  isAnimating = false;
}

let isAnimating: boolean = false;

// will be bound to prop 'runFullAnimation'
export function runFullAnimationFn() {
  if (isAnimating) {
    console.warn('busy animating');
    return;
  }

  isAnimating = true;
  animationRound = currentRound;
  runAnimationCycle();
}

function runAnimationCycle() {
  displayPhase = 0;   // if in the middle of "one small step" animation, reset to 0.


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

// called when RoundSelector changes selection
function goToNextRound():void {

  console.log(`previous round was ${previousRound}, currentRound is ${currentRound}`);
  if (isAnimating) {
    console.log('gotoNextRound: busy animating');
    return;
  }
  if (previousRound == currentRound)
    return;
  if (previousRound == currentRound-1 && previousRound > 0)
    animateOneRoundFn();
  else
    setRoundFn(currentRound);
  previousRound = currentRound;
}


// will be bound to prop 'setRound'
function setRoundFn(round:number): void {
  console.log('setRoundFn called');
  if (isAnimating) {
    console.warn('busy animating');
    return;
  }

  displayPhase = 0;
  makeNewPie(round);

}

// will be bound to prop 'animateOneRound'
function animateOneRoundFn() {
  console.log("animateOneRoundFn called");

  if (isAnimating) {
    console.warn('busy animating');
    return;
  }
  if (currentRound <= 1) {
    console.warn(`animateOneRoundFn: can't anitmate to round ${currentRound}`);
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

  console.log(`animateOnePhaseFn called, currentRound = ${currentRound}, displayPhase = ${displayPhase}`);


  if (currentRound > jsonData.results.length) {
    outlineElected();
    isAnimating = false;
    return;
  }

  if (isAnimating)
    return;

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
  // previousPieInfoGlobal = pieInfoGlobal;
  pieInfoGlobal = updatePieChart(round, pieChartID, pieDataGlobal, 0, smallPieRadius(), true);
}



function shrinkDonut(innerRadius:number,outerRadius:number):void {

  const updatedPie = d3.pie<PieData>()
    .sort(null)                     // (a, b) => d3.descending(a.value, b.value))
    .value(d => d.value);


  const chart = d3.select<SVGSVGElement | null, any>(svg)
                  .select('#'+donutChartID);

  // This is the destination arc for the slices when we shrink
  // them in from the current radius.
  const updatedArc = d3.arc<DefaultArcObject>()
    .outerRadius(innerRadius)
    .innerRadius(innerRadius-1);  // blows up without the -1!!!

  const slices = chart.selectAll<SVGPathElement, DefaultArcObject>('.slice');
     // .data(info, d => d.data.label);

  let slicesLeft = slices.size();
  function cleanUpAtEnd() {
    slicesLeft--;
    if (slicesLeft === 0) {

      removeFinishedText();
      //deleteDonut();
    }
  }

  slices
    .select('path')
      //.transition('shrink-donut')
      .transition('global')
      .duration(shortTransition)
      .attr('d', d => updatedArc(d))
      .on('end', d => cleanUpAtEnd());

}


function displayDonut(round: number):void {
  // const [donutData, startAngles, endAngles] = makeDonutData();

  const donutInfo = makeDonutInfo(round, pieInfoGlobal);
  // previousDonutInfoGlobal = donutInfoGlobal;
  donutInfoGlobal = createPieChartWithInfo(round, donutChartID, donutInfo, pieChartCenterX, pieChartCenterY,
                                           smallPieRadius(), largePieRadius(), false, true);
}




function updateDonut(round: number):void {

  const newDonutInfo = updateDonutInfo(round, donutInfoGlobal, pieInfoGlobal);
  //previousDonutInfoGlobal = donutInfoGlobal;
  donutInfoGlobal = updatePieChartWithInfo(round, donutChartID, newDonutInfo,
                          /* previousDonutInfoGlobal, */
                          smallPieRadius(), largePieRadius(), false);
}


function pickColor(d:PieInfoType) {
  const label:string = d.data.label;
  return pieColors[label.split('#')[0]];
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
  // console.log('Total transfers are: ', result);
  return result;
}

// the argument here is the pieInfo (internal form for D3) for the main pie
// not for the donut...
function makeDonutInfo(round:number, pieInfo:PieInfoArray):PieInfoArray {

  // console.log(`makeDonutInfo: round = ${round}`);

  const donutInfo:PieInfoArray = [];
  const totalVotes:number = originalTotalVotes; //getTotalVotes(round);
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

    let transferFromData = pieInfo.find((obj:PieInfoType) => obj.data.label == transferFrom + transferTag);
    if (transferFromData === undefined)
      transferFromData = pieInfo.find((obj:PieInfoType) => obj.data.label == transferFrom);
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
      newObj.data.label = `${newObj.data.label}#${i}`;

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
  const totalVotes = originalTotalVotes; // getTotalVotes(round);
  const transferVotes = getTransferVotes(round);
  const transferStartAngles = getTransferStartAngles(transferVotes, totalVotes, pieInfo);

  for (let [i,d] of donutInfo.entries()) {

    const newObj = structuredClone(d);
    const sliceAngle = d.endAngle - d.startAngle;

    // now find where the corresponding slice in the main pie is.
    const mainPieObj = pieInfo.find(obj => d.data.label.indexOf(obj.data.label)===0);

    if (mainPieObj) {
      const sliceName = mainPieObj.data.label;
      newObj.startAngle = transferStartAngles[sliceName];
      transferStartAngles[sliceName] += sliceAngle;
      newObj.endAngle = newObj.startAngle + sliceAngle;

    } else {
      if (d.data.label.indexOf('exhausted') === 0) {
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
    //.attr('filter', 'url(#text-top-filter)');

  const textArc = d3.arc<PieOrArc>()
    .innerRadius(outerRadius * textArcRadius)
    .outerRadius(outerRadius * textArcRadius);

  const textSlices = textLayer.selectAll<SVGTextElement, PieInfoType>('text')
    .data(pieInfo)
    .enter()
    .each(function (d:PieInfoType) {
      if (!(d.endAngle - d.startAngle < minimumTextAngle ||
            d.data.label.includes(transferTag))) {
        d3.select<SVGGElement, PieInfoType>(this as SVGGElement)
          .append('g')
          .attr('id', d => d.data.label)
          .classed('eliminated', (d:PieInfoType) => eliminatedCandidates.includes(d.data.label.split('#')[0]) ||
                                                                    d.data.label.includes(transferTag))
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
    .data(pieInfo, d => d.data.label)
    .classed('eliminated', d => eliminatedCandidates.includes(d.data.label.split('#')[0]) ||
                                              d.data.label.includes(transferTag));
  const textArc = d3.arc<PieOrArc>()
    .innerRadius(outerRadius * textArcRadius)
    .outerRadius(outerRadius * textArcRadius+1);


  tspans
    //.transition('move-tspans')
    .transition('global')
    .duration(shortTransition)
    .attr('transform', d => `translate(${textArc.centroid(d)})`)
    .attr('text-anchor', d => textLabelPosition(d.startAngle,d.endAngle));

  textGroups
    .select('text')
    //.transition('move-text')
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

/*
  const g = d3.select<SVGSVGElement | null, any>(svg)
    .attr('width', width)
    .attr('height', height);
*/

  const g = d3.select<SVGSVGElement|null, any>(svg)
    // .attr('width', '100%')
    // .attr('height', 'auto')
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
    .classed('eliminated', d => eliminatedCandidates.includes(d.data.label.split('#')[0]) ||
                                          d.data.label.includes(transferTag))
    .classed('elected', d => electedCandidates.includes(d.data.label.split('#')[0]) &&
                                          !d.data.label.includes(transferTag))
    .attr('id', d => d.data.label)
    .on('mouseenter', (d,i) => handleMouseEnter(d,i))
    .on('mouseleave', (d,i) => handleMouseLeave(d,i));
    //.on('click', (d,i) => handleMouseClick(d,i));

  // outlineElected();

  const radialArc = d3.arc<PieOrArc>()
    .outerRadius(outerRadius)
    .innerRadius(innerRadius);

  if (growChart) {

    const oldArc = d3.arc<PieOrArc>()
      .outerRadius(innerRadius+1)  // blows up without the +1
      .innerRadius(innerRadius);

    slices
      .append('path')
        .attr('d', oldArc)
        //.transition('grow-pie-chart')
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

//  removeEliminatedText();

  const solidArc = d3.arc<DefaultArcObject>()
    .innerRadius(innerRadius);

  const hatchedArc = d3.arc<DefaultArcObject>()
    .outerRadius(outerRadius);

  slices
    .classed('finished', true)
    .select('path')
      //.transition('hatch-out-eliminated')
      .transition('global')
      .duration(shortTransition)

      .attrTween('d', function(d) {
          const interpolateRadius = d3.interpolate(outerRadius, innerRadius);
          // this._current = d;

          return function(t) {
            hatchedArc.innerRadius(interpolateRadius(t));
            return hatchedArc(d);
          };
        })
      .attr('fill', (d:PieInfoType) => `url(#${d.data.label.split('#')[0].replaceAll(' ','-')})`);


  slices
    .clone(true)
    .classed('finished', true)
    .select('path')
      //.transition('shrink-eliminated')
      .transition('global')
      .duration(shortTransition)
      .attrTween('d', function(d) {
          const interpolateRadius = d3.interpolate(outerRadius, innerRadius);
          // this._current = d;

          return function(t:number) {
            solidArc.outerRadius(interpolateRadius(t));
            return solidArc(d);
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


/*
function getStartAngle(name, pieInfo) {
    const d = pieInfo.find(obj => name.indexOf(obj.data.label)===0);
    return d.startAngle;
}


function getEndAngle(name, pieInfo) {
    const d = pieInfo.find(obj => name.indexOf(obj.data.label)===0);
    return d.endAngle;
}
*/


function updatePieChart(round: number, chartID:string, newData:PieDataArray,
                        innerRadius:number, outerRadius:number,
                        displayText:boolean) : PieInfoArray {

  const updatedPie = d3.pie<PieData>()
    .sort(null)
    .value(d => d.value);
  // const previousPieInfo = previousPieInfoGlobal;
  const pieInfo:PieInfoArray = updatedPie(newData);

  updatePieChartWithInfo(round, chartID, pieInfo,
                          /* previousPieInfo, */
                          innerRadius, outerRadius, displayText);

  return pieInfo;
}

function updatePieChartWithInfo(round: number, chartID:string, pieInfo:PieInfoArray,
                                /* previousPieInfo, */
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
    .data(pieInfo, d => d.data.label);


  // If there are slices coming in, they are because someone was elected and these
  // are the surplus votes they are transferring away.
  slices
    .enter()
    .append('g')
    .attr('class', 'slice')
    .attr('id', d => d.data.label)
    .classed('eliminated',true)
    //.on('click', (d,i) => handleMouseClick(d,i))
    .on('mouseenter', (d,i) => handleMouseEnter(d,i))
    .on('mouseleave', (d,i) => handleMouseLeave(d,i))
    .append('path')
      .attr('d', d => radialArc(d))
      .attr('fill', d => pickColor(d));

  // This section is for already existing slices and will not be run for the newly
  // entering slices.
  slices
  /*
    .classed('eliminated', d => eliminatedCandidates.includes(d.data.label.split('#')[0]) ||
                                          d.data.label.includes(transferTag))
    .classed('elected', d => electedCandidates.includes(d.data.label.split('#')[0]) &&
                                          !d.data.label.includes(transferTag))
  */
    .classed('eliminated', d => eliminatedCandidates.includes(d.data.label.split('#')[0]))
    .classed('elected', d => electedCandidates.includes(d.data.label.split('#')[0]))
    //.on('click', (d,i) => handleMouseClick(d,i));
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
      //.transition('rotate-slices')
      .transition('global')
      .duration(shortTransition)
      //.attr('d', d => rotatorArc(d));

      .attrTween('d', function(d) {

    /*
        const interpolateStartAngle = d3.interpolate(getStartAngle(d.data.label, previousPieInfo), d.startAngle);
        const interpolateEndAngle = d3.interpolate(getEndAngle(d.data.label, previousPieInfo), d.endAngle);
    */
        const prevStartAngle = Number(d3.select(this.parentNode).attr('prevStart'));
        const prevEndAngle = Number(d3.select(this.parentNode).attr('prevEnd'));

        const interpolateStartAngle = d3.interpolate(prevStartAngle, d.startAngle);
        const interpolateEndAngle = d3.interpolate(prevEndAngle, d.endAngle);

        // this._current = d;
        return t => {
          rotatorArc
            .startAngle(interpolateStartAngle(t))
            .endAngle(interpolateEndAngle(t));
          return rotatorArc(d);
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
    if (d.data.label.indexOf('exhausted')===0){
      // console.log('+ exhausted votes ', d);
      exhaustedVotes += Number(d.data.value);
      // console.log('this round exhausted votes ', exhaustedVotes);
    }
  }
  return exhaustedVotes;
}



   /*
    // there were several instances of this.  Just saving for awhile
    // in case I have to remember how to do it.
    //

    .on('mouseenter', function(d,i) {
      d3.select(this)
        .classed('hovered', true)
        .style('stroke', 'darkblue')
        .style('stroke-width', '2px');
      handleMouseEnter(d,i);
      })
    .on('mouseleave', function() {
      d3.select(this)
        .classed('hovered', false)
        .style('stroke', 'none');
      handleMouseLeave();
    });
    */


function handleMouseEnter(event:MouseEvent, d:any) {
  mouseData = d.data.label.split('#')[0];
  mouseEventType = 'enter';
  mouseY = event.clientY;

}

/*
  [reportGlobal, reportTitleGlobal] = popupReport(d);
  if (popup) {
    popup.style.top = event.clientY + 20 + 'px';
    popup.style.opacity = String(tooltipOpacity);
  }

*/


function handleMouseLeave(event:Event, d:any) {

  mouseData = d.data.label.split('#')[0];
  mouseEventType = 'leave';
}
/*
  if (popup)
    popup.style.opacity = '0';;
  reportGlobal = [];
  reportTitleGlobal = '';
*/


function showExhaustedExplainer(event:MouseEvent,d:any) {
  mouseEventType = 'show-exhausted';
  mouseY = event.clientY;
}

/*
  if (exhaustedExplainer) {
    exhaustedExplainer.style.top = event.clientY + 20 + 'px';
    exhaustedExplainer.style.opacity = String(tooltipOpacity);
  }
*/


function hideExhaustedExplainer(event:Event,d:any) {
  mouseEventType = 'hide-exhausted';
}
/*
  if (exhaustedExplainer)
    exhaustedExplainer.style.opacity = '0';
*/


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
    max-height: 50vh; /* Smaller maximum height on mobile */
  }
}

@media (max-width: 768px) {
  .pie-chart-svg {
    max-height: 60vh; /* Increase from 50vh to use more screen space */
  }
}


</style>

<svg class="pie-chart-svg" bind:this={svg} >

  <defs>

    <filter id='text-top-filter'>
      <feBlend mode='normal' in='SourceGraphic' in2='BackgroundImage' />
    </filter>

    <pattern id='cross-hatch' width='10' height='10' patternUnits='userSpaceOnUse'>
      <rect width='10' height='10' fill='transparent' />
      <path d='M0,0 l10,10 M0,10 l10,-10' stroke='lightgray' stroke-width='2' />
    </pattern>

  </defs>

</svg>
