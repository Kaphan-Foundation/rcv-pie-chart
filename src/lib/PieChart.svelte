<!-- src/components/PieChart.svelte -->
<svelte:options runes={true} customElement="pie-chart" />
<script lang="ts">

// import BubbleVisualization from '$components/BubbleVisualization.svelte';
import PieChartGraphics from '$components/PieChartGraphics.svelte';

import type { RCtabSummary, RCtabTally, RCtabTallyResults,RCtabResults, JSONValue } from '$lib/ElectionSummaryTypes';
import { validateRCtabSummary } from '$lib/ElectionSummaryTypes';

const tooltipOpacity = 0.85;   // for when we display explanatory text at the mouse cursor.

let { electionSummary,
      currentRound = 1,
      requestRoundChange = ((r:number) => {}),
      candidateColors = [],
      textForWinner = 'elected',
      excludeFinalWinnerAndEliminatedCandidate = false,
      firstRoundDeterminesPercentages = false,
      showCaptions = false,
    } : {
      electionSummary : RCtabSummary|string,
      currentRound:number,
      requestRoundChange:(r:number) => void,
      candidateColors: string[],
      textForWinner: string,
      excludeFinalWinnerAndEliminatedCandidate: boolean,
      firstRoundDeterminesPercentages: boolean,
      showCaptions: boolean,

    } = $props();


// Verb forms for textForWinner, matching rcvis textForWinnerUtils.py
const winnerTextForms: Record<string, { caption: string, event: string, infinitive: string }> = {
  'elected':  { caption: 'Elected',  event: 'was elected',              infinitive: 'to be elected' },
  'won':      { caption: 'Won',      event: 'won',                      infinitive: 'to win' },
  'advanced': { caption: 'Advanced', event: 'advanced to the general',   infinitive: 'to advance to the general' },
  'leading':  { caption: 'Leading',  event: 'is in the lead',           infinitive: 'to take the lead' },
};
let winnerText = $derived(winnerTextForms[textForWinner] ?? winnerTextForms['elected']);


let popup = $state<HTMLElement | null>(null);
let exhaustedExplainer = $state<HTMLElement | null>(null);

let reportTitleGlobal = $state<string>("");
let reportGlobal = $state<string[]>([]);
let mouseEventType = $state<string>("");
let mouseData = $state<string>("");
let mouseY = $state<number>(0);


// Create a reactive variable that will always be an object
let jsonData = $derived(ensureObject(electionSummary));
  
  // Function to ensure we're working with an object,
  // otherwise rendering will happen before an input string
  // can be converted into an object, and try to reference
  // the input string as if it was an object. This will run early
  // enough to prevent that.
function ensureObject(data:any) {
    if (typeof data === 'string') {
      // console.log('input was a string');
      try {
        data = JSON.parse(data);
      } catch (e) {
        console.error('Failed to parse JSON string:', e);
        return {}; // Return empty object as fallback
      }
    }
    // console.log('RCtabSummary object status: ', validateRCtabSummary(data));
    return data || {}; // Return the object or empty object if null/undefined
}

// when PieChartGraphics component requests a round change, pass it up to
// the next component above.
function onRoundChange(round: number) {
  if (requestRoundChange) {
    // console.log('onRoundChange in PieChart: passing on request for round ', round);
    requestRoundChange(round);
  } else {
    console.warn('onRoundChange in PieChart: requestRoundChange is null');
  }
}

const allCandidateNames = $derived(getCandidateListFromSummaryFile());

function handleMouseEvent(): void {
  // console.log('mouse event ', mouseEventType, mouseData, mouseY);
  switch(mouseEventType) {
    case 'enter':
      [reportGlobal, reportTitleGlobal] = popupReport(mouseData, currentRound);
      if (popup) {
          popup.style.top = String((mouseY || 0) + 20) + 'px';
          popup.style.opacity = String(tooltipOpacity);
      }
      break;
    case 'leave':
      if (popup)
        popup.style.opacity = '0';
      reportGlobal = [];
      reportTitleGlobal = '';
      break;
    case 'show-exhausted':
      if (exhaustedExplainer) {
        exhaustedExplainer.style.top = String((mouseY || 0) + 20) + 'px';
        exhaustedExplainer.style.opacity = String(tooltipOpacity);
      }
      break;
    case 'hide-exhausted':
      if (exhaustedExplainer)
        exhaustedExplainer.style.opacity = '0';
      break;
    default:
      console.log('Unknown mouse event: ', mouseEventType);
      break;
  }
}
$effect(() => handleMouseEvent());



function verbPhrase(votes: number, past: boolean): string {
  if (votes == 1)
    return past ? 'vote was' : 'vote will be';
  else
    return past ? 'votes were' : 'votes will be';
}


function popupReport(candidate: string, round: number): [string[], string] {

  const report: string[] = [];
  const candidateLabel: string = candidate === 'exhausted' ? exhaustedLabel() : candidate;

  let tallyVotes;

  if (candidate == 'exhausted') {
    //tallyVotes = jsonData.results[0].inactiveBallots.exhaustedChoices;
    tallyVotes = countExhaustedVotes(1);
  } else {
    const tallyObject = jsonData.results[0].tally;
    tallyVotes = tallyObject[candidate];
  }
  report.push(`${candidateLabel} started with ${tallyVotes} votes.`);

  for (let r = 1; r <= round; r++) {
    if (r === round) {
      if (candidate == 'exhausted') {
        //tallyVotes = jsonData.results[round-1].inactiveBallots.exhaustedChoices;
        tallyVotes = countExhaustedVotes(round);
      } else {
        const tallyObject = jsonData.results[round-1].tally;
        tallyVotes = tallyObject[candidate];
      }
    
      report.push(`${candidateLabel} has ${tallyVotes} votes at round ${round}.`);
    }

    const tallyResults = jsonData.results[r-1].tallyResults;
    const suppressOutcome = isFinalRoundSuppressed(r);
    for (let i = 0; i < tallyResults.length; i++) {
      const transfers: RCtabTally = tallyResults[i].transfers;
      const eliminated: string = tallyResults[i].eliminated;
      const elected: string = tallyResults[i].elected;

      if (!suppressOutcome) {
        if (eliminated) {
          if (eliminated === candidate) {
            report.push(`${candidateLabel} will be eliminated on round ${r}.`);
          }
        } else {
          // eliminated was undefined, so see if the candidate was elected.
          if (candidate === elected) {
            report.push(`${candidateLabel} ${winnerText.event} on round ${r}.`);
            if (transfers) {
              for (let [cand, votes] of Object.entries(transfers)) {
                report.push(`${votes} ${verbPhrase(Number(votes), r < round)} transferred to ${cand} on round ${r}.`);
              }
            }
          }
        }
      }

      const transferFrom = eliminated ? eliminated : elected;
      if (transferFrom) {
        const transferVotes: number = Number(transfers[candidate]);
        if (transferVotes) {
          report.push(`${transferVotes} ${verbPhrase(transferVotes, r < round)} transferred from ${transferFrom} on round ${r}.`);
        }
      } 
    }
  }
 
  return [report, candidateLabel];
}

function countElected(): number {
  let electedCount: number = 0;
  for (let r = 1; r <= jsonData.results.length; r++) {
    if (isFinalRoundSuppressed(r)) continue;
    const tallyResults = jsonData.results[r-1].tallyResults;
    for (let i = 0; i < tallyResults.length; i++) {
      const elected = tallyResults[i].elected;
      if (elected)
        electedCount++;
    }
  }
  return electedCount;
}

function getCandidateListFromSummaryFile() {
  return Object.keys(jsonData.results[0].tally);
}

function makeEliminatedCandidateArray(round: number) {
  // const allCandidateNames = getCandidateListFromSummaryFile();

  let allEliminatedCandidateNames:string[] = [];

  for (let r=1; r<=round; r++) {
    const newEliminatedCandidateNames = getEliminatedCandidates(r-1);
    allEliminatedCandidateNames = [...allEliminatedCandidateNames, ...newEliminatedCandidateNames];
  }
 
  const result = allCandidateNames.map((c) => allEliminatedCandidateNames.some((cand) => cand === c));
  // console.log('Eliminate Candidate Vector = ', result);
  return result;
}

type ColorMap = Record<string,string>;
interface PieChartGraphicsType {
  getEliminatedCandidates: (round:number) => string[];
  getElectedCandidates: (round:number) => string[];
  countExhaustedVotes: (round:number) => number;
  animateOnePhaseFn: () => void;
  runFullAnimationFn: () => void;
  pieColors:  ColorMap;
  exhaustedLabel: string;
}

const phaseLabels = ['Eliminate', 'Transfer', 'Consolidate'] as const;

let pieChartGraphicsInstance: PieChartGraphicsType;
let displayPhase = $state(0);

function isFinalRoundSuppressed(round: number): boolean {
  return excludeFinalWinnerAndEliminatedCandidate
      && jsonData.results
      && round === jsonData.results.length;
}

function getEliminatedCandidates(round:number): string[] {
  if (isFinalRoundSuppressed(round)) return [];
  return pieChartGraphicsInstance?
        pieChartGraphicsInstance.getEliminatedCandidates(round)
        : [];
}

function getElectedCandidates(round:number): string[] {
  if (isFinalRoundSuppressed(round)) return [];
  return pieChartGraphicsInstance?
        pieChartGraphicsInstance.getElectedCandidates(round)
        : [];

}

function countExhaustedVotes(round:number) : number {
  return pieChartGraphicsInstance? 
        pieChartGraphicsInstance.countExhaustedVotes(round)
        : 0;
}

function animateOnePhase() {
  if (pieChartGraphicsInstance && pieChartGraphicsInstance.animateOnePhaseFn)
    pieChartGraphicsInstance.animateOnePhaseFn();
}

function runFullAnimation() {
  if (pieChartGraphicsInstance && pieChartGraphicsInstance.runFullAnimationFn)
    pieChartGraphicsInstance.runFullAnimationFn();

}

function exhaustedLabel() : string {
  return pieChartGraphicsInstance? pieChartGraphicsInstance.exhaustedLabel : '';
}

function pieColors() : ColorMap {
  return pieChartGraphicsInstance? pieChartGraphicsInstance.pieColors : {};
}


</script>

<style>
.page-container {
  width: 95%;
  max-width: 1800px;
  margin: 0 auto;
  padding: 0 20px;
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  align-items: center;
}

.common-header {
  width: 100%;
  margin-bottom: 1rem;
  text-align: center;
}

.tooltip {
  position: fixed;
  width: max-content;
  text-align: left;
  padding: .5rem;
  background: #FFFFFF;
  color: #313639;
  border: 1px solid #313639;
  border-radius: 8px;
  pointer-events: none;
  font-size: 0.8rem;
  left: 50%;
  transform: translate(-50%);
  font-weight:normal;
  opacity: 0;
  z-index: 100;
}

.tooltip h3 {
  text-align: center;
}

.animation-button-container {
  display: flex;
  justify-content: center;
  gap: 10px;
  margin: 0.5rem;
}

.animation-button-container button {
  background-color: #4747ff;
  color: #fff;
  padding: 1px 7px;
  font-size: 0.67rem;
  min-width: 107px;
  border: none;
  border-radius: 3px;
  cursor: pointer;
}

.animation-button-container button:hover {
  background-color: #4747c2;
}

.pie-chart-container {
  /* width: 90%; */
  /* min-width: 800px; /* Larger minimum size */
  width: 100%; /* Change from 90% to 100% */
  min-width: auto; /* Remove the 800px minimum */

  flex-grow: 0; /* Don't grow beyond specified width */
  margin: 0 auto;
  margin-right: 40px; /* Add extra space on right */
  margin-top: -3vh;
}
 

.visualizations-container {
  display: flex;
  justify-content: space-between;
  width: 100%;
  padding: 0 20px;
  /* gap: 80px; */
  gap: 20px; /* Reduce from 80px */
}


/***  It looks like it is always OK to use justify-content: space-between even with no bubble viz display

.visualizations-container {
  justify-content: space-between;
}
  ***/



/*  width: 25%; /* Smaller percentage */
/*  flex-grow: 0; /* Don't grow beyond specified width */
/*  margin-left: 40px; /* Add extra space on left */

/***  Omit this if we are not using the bubble-visualization
.bubble-visualization-container {
  width: 25%;
  flex-grow: 0;
  align-self: center;
  margin: 0 auto;
  margin-top: 30px;
  margin-left: 40px; 
}
***/


/* Media query for smaller screens */
@media (max-width: 1300px) {
  .visualizations-container {
    flex-direction: column;
    align-items: center;
  }
}

@media (max-width: 768px) {
  .page-container {
    padding: 0 10px; /* Reduce padding on smaller screens */
  }
  
  .visualizations-container {
    padding: 0; /* Remove padding on small screens */
  }
}

h3, h4 {
  margin: 0.5rem;
}

@media (max-width: 768px) {
  .common-header {
    margin-bottom: 0.5rem;
  }
  
  h3, h4 {
    margin: 0.3rem 0;
    font-size: 0.9rem;
  }
  
}
 

</style>

  
<div class="animation-button-container">
  <!-- Animate All button removed — RoundPlayer handles this now
  <button class="next-button" onclick={runFullAnimation}>
    Animate All
  </button>
  -->

  <button class="next-button" onclick={animateOnePhase}>
    {phaseLabels[displayPhase]}
  </button>
</div>
<div class="common-header">  <!-- if I take out this div, the buttons above stop working! -->
</div>
  
  <div class="page-container">
    <div class="visualizations-container">
      <div class="pie-chart-container">
          <PieChartGraphics bind:this={pieChartGraphicsInstance}
            jsonData={jsonData}
            currentRound={currentRound}
            bind:mouseEventType={mouseEventType}
            bind:mouseData={mouseData}
            bind:mouseY={mouseY}
            requestRoundChange={onRoundChange}
            candidateColors={candidateColors}
            excludeFinalWinnerAndEliminatedCandidate={excludeFinalWinnerAndEliminatedCandidate}
            firstRoundDeterminesPercentages={firstRoundDeterminesPercentages}
            bind:displayPhase={displayPhase}
          />
      </div>

    <!-- 
      <div class="bubble-visualization-container">
        <BubbleVisualization
          candidates={getCandidateListFromSummaryFile()}
          maxRanks={Math.min(10,getCandidateListFromSummaryFile().length)}
          eliminatedCandidates={makeEliminatedCandidateArray(currentRound)}
          currentRound={currentRound}
        />
      </div>
    -->

    </div>

    {#if showCaptions}
    <h3>{jsonData.config.contest}, {countElected()} {winnerText.infinitive}, Round {currentRound}.</h3>
      <h4>
        {#if getEliminatedCandidates(currentRound).length > 0}
          About to eliminate:
          {#each getEliminatedCandidates(currentRound) as elim, i}
            <span style:color={pieColors()[elim]}>{elim}</span>
            {#if i < getEliminatedCandidates(currentRound).length - 1}
              ,&nbsp;
            {/if}

          {/each}
        {/if}

        {#if getElectedCandidates(currentRound).length > 0}
          {winnerText.caption}:
          {#each getElectedCandidates(currentRound) as elected, i}
            <span style:color={pieColors()[elected]}>{elected}</span>
            {#if i < getElectedCandidates(currentRound).length - 1}
              ,&nbsp;
            {/if}
          {/each}
        {/if}
      </h4>
    {/if}
  </div>

  <div class='tooltip' bind:this={popup}>
    <h3>{reportTitleGlobal}</h3>          
    {#each reportGlobal as line}
      <span>{line}</span>
      <br>
    {/each}
  </div>

  <div class='tooltip' bind:this={exhaustedExplainer}>
    "{exhaustedLabel()}" means all the candidates ranked on <br>
    these ballots have already been eliminated.
  </div>
  
