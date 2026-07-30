


export type JSONValue = 
  string 
  | number 
  | boolean 
  | null 
  | JSONObject 
  | JSONArray;

export interface JSONObject {
  [key: string]: JSONValue;
}

export interface JSONArray extends Array<JSONValue> {}

export interface RCtabSummary {
  config : RCtabSummaryConfig,
  jsonFormatVersion : string,
  results : RCtabResults[],
  summary : RCtabSummarySummary,
  /** Our additive extension (the tieBreaks precedent): election statistics
   *  computed at tabulation (docs/election-statistics-design.md). Absent
   *  from real RCTab files, which still validate. */
  statistics ?: import('./election-statistics').ElectionStatistics,
}

export interface RCtabSummaryConfig {
  contest : string,
  date ?: string,
  generatedBy ?: string,
  jurisdiction ?: string,
  office ?: string,
  threshold ?: string,
}

export interface RCtabResults {
  inactiveBallots : RCtabInactiveBallots,
  round : number,
  tally : RCtabTally,
  tallyResults : RCtabTallyResults[],
  threshold ?: string,
  // Our extension (absent from real RCTab files, which log tie decisions
  // only to their audit log): records each time the tiebreak logic actually
  // decided between equal-vote candidates this round. Nobody external
  // consumes our summaries (RCVis retired), so additive fields are safe.
  tieBreaks ?: RCtabTieBreak[]
}

export interface RCtabTieBreak {
  // 'elimination': tied for fewest votes, `selected` was eliminated.
  // 'election': tied at/over threshold in single-election-per-round mode,
  //             `selected` was elected first.
  // 'electionOrder': remaining candidates all won but were tied when
  //                  deciding the order of their election rounds.
  kind : 'elimination' | 'election' | 'electionOrder',
  tiedCandidates : string[],   // everyone in the tie, including `selected`
  selected : string,
  votes : string,              // the tied total (formatted like tally values)
  method : string,             // how it was broken, e.g. "candidate order",
                               // "Borda count (A: 1.62, B: 0.38)",
                               // "random draw (seed 42)"
}

export interface RCtabInactiveBallots {
  exhaustedChoices ?: string,
  overvotes ?: string,
  repeatedRankings ?: string,
  skippedRankings ?: string,
  finalRoundSurplus ?: string
}

export interface RCtabTally {
  [key:string] : string  // potentially many of these
}

export interface RCtabTallyResults {
  elected ?: string,
  eliminated ?: string,
  transfers : RCtabTally
}

export interface RCtabSummarySummary  {
    finalThreshold ?: string,
    numCandidates : number,
    numWinners : number,
    totalNumBallots : string,
    undervotes ?: number
}



/**
 * Validates an RCtabSummary object for essential properties and structure
 * Ensures only fields defined in the interface types are present
 * @param data The RCtabSummary object to validate
 * @returns A validation result containing status and error messages if any
 */
export function validateRCtabSummary(data: any): { valid: boolean; errors: string[]; warnings: string[] } {
  const errors: string[] = [];
  // Warnings are non-fatal data-consistency observations (e.g. Sankey
  // balance drift from floating-point rounding). Callers should log
  // them but not block rendering on them — the chart is still
  // informative even when the underlying numbers drift by a small
  // amount across rounds.
  const warnings: string[] = [];

  // Check if the data is an object
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    return { valid: false, errors: ['Input is not a valid object'], warnings };
  }

  // Define allowed fields for each type
  const allowedRCtabSummaryFields = new Set(['config', 'jsonFormatVersion', 'results', 'summary', 'statistics']);
  const allowedConfigFields = new Set(['contest', 'date', 'generatedBy', 'jurisdiction', 'office', 'threshold']);
  const allowedResultsFields = new Set(['inactiveBallots', 'round', 'tally', 'tallyResults', 'threshold', 'tieBreaks']);
  const allowedTieBreakFields = new Set(['kind', 'tiedCandidates', 'selected', 'votes', 'method']);
  const allowedInactiveBallotsFields = new Set(['exhaustedChoices', 'overvotes', 'repeatedRankings', 'skippedRankings', 'finalRoundSurplus']);
  const allowedTallyResultsFields = new Set(['elected', 'eliminated', 'transfers']);
  const allowedSummaryFields = new Set(['finalThreshold', 'numCandidates', 'numWinners', 'totalNumBallots', 'undervotes']);

  // Check for unexpected fields in RCtabSummary
  for (const field of Object.keys(data)) {
    if (!allowedRCtabSummaryFields.has(field)) {
      errors.push(`Unexpected field in RCtabSummary: "${field}"`);
    }
  }

  // 1. Check config structure
  if (!data.config) {
    errors.push('Config is missing');
  } else if (typeof data.config !== 'object' || Array.isArray(data.config)) {
    errors.push('Config must be an object');
  } else {
    // Check for unexpected fields in config
    for (const field of Object.keys(data.config)) {
      if (!allowedConfigFields.has(field)) {
        errors.push(`Unexpected field in config: "${field}"`);
      }
    }

    // Check for required fields
    if (!data.config.contest) {
      errors.push('Config is missing contest name');
    }
  }

  // 2. Check if jsonFormatVersion exists
  if (!data.jsonFormatVersion) {
    errors.push('jsonFormatVersion is missing');
  }

  // 3. Check if results exist and is an array
  if (!data.results) {
    errors.push('Results are missing');
    // statistics: our additive extension — light structural check only
    // (absent from real RCTab files; internal producer is trusted).
    const stats = (data as Record<string, unknown>).statistics;
    if (stats !== undefined) {
      if (!stats || typeof stats !== 'object' || Array.isArray(stats)) {
        errors.push('statistics must be an object when present');
      } else if ((stats as Record<string, unknown>).version !== 1) {
        warnings.push('statistics.version is not 1 — viewer may not understand it');
      }
    }

    return { valid: errors.length === 0, errors, warnings };
  }
  
  if (!Array.isArray(data.results)) {
    errors.push('Results must be an array');
    return { valid: errors.length === 0, errors, warnings };
  }

  // Early return if no results to validate
  if (data.results.length === 0) {
    errors.push('Results array is empty');
    return { valid: errors.length === 0, errors, warnings };
  }

  // Track all candidate names seen in the first round
  let allCandidates: Set<string> = new Set();
  let remainingCandidates: Set<string> = new Set();
  let previousRound = 0;

  // Validate each round
  for (let i = 0; i < data.results.length; i++) {
    const round = data.results[i];
    
    // Check for unexpected fields in results
    for (const field of Object.keys(round)) {
      if (!allowedResultsFields.has(field)) {
        errors.push(`Round ${i+1}: Unexpected field in results: "${field}"`);
      }
    }
    
    // Check if round number exists and is sequential
    if (typeof round.round !== 'number') {
      errors.push(`Round ${i+1} is missing a round number`);
    } else if (i === 0 && round.round !== 1) {
      errors.push(`First round number should be 1, found ${round.round}`);
    } else if (i > 0 && round.round !== previousRound + 1) {
      errors.push(`Round numbers should be sequential. Expected ${previousRound + 1}, found ${round.round}`);
    }
    previousRound = round.round || i+1;

    // Check inactiveBallots
    if (!round.inactiveBallots) {
      errors.push(`Round ${previousRound}: inactiveBallots is missing`);
    } else if (typeof round.inactiveBallots !== 'object' || Array.isArray(round.inactiveBallots)) {
      errors.push(`Round ${previousRound}: inactiveBallots must be an object`);
    } else {
      // Check for unexpected fields in inactiveBallots
      for (const field of Object.keys(round.inactiveBallots)) {
        if (!allowedInactiveBallotsFields.has(field)) {
          errors.push(`Round ${previousRound}: Unexpected field in inactiveBallots: "${field}"`);
        }
      }
    }

    // Check if tally exists
    if (!round.tally) {
      errors.push(`Round ${previousRound} is missing a tally`);
      continue; // Skip further validation for this round
    }
    
    if (typeof round.tally !== 'object' || Array.isArray(round.tally)) {
      errors.push(`Round ${previousRound}: tally must be an object`);
      continue;
    }

    // First round establishes all candidates
    if (i === 0) {
      allCandidates = new Set(Object.keys(round.tally));
      remainingCandidates = new Set(allCandidates);
    } else {
      // Subsequent rounds should only have candidates from the original set
      const currentCandidates = new Set(Object.keys(round.tally));
      
      // Check if any new candidates appeared
      const newCandidates = [...currentCandidates].filter(c => !allCandidates.has(c));
      if (newCandidates.length > 0) {
        errors.push(`Round ${previousRound} contains new candidates not present in earlier rounds: ${newCandidates.join(', ')}`);
      }
      
      // Update remaining candidates
      remainingCandidates = currentCandidates;
    }

    // Threshold is optional (absent in bottoms-up elections)

    // tieBreaks is optional (our extension; absent from real RCTab files)
    if (round.tieBreaks !== undefined) {
      if (!Array.isArray(round.tieBreaks)) {
        errors.push(`Round ${previousRound}: tieBreaks must be an array`);
      } else {
        for (let j = 0; j < round.tieBreaks.length; j++) {
          const tb = round.tieBreaks[j];
          if (!tb || typeof tb !== 'object' || Array.isArray(tb)) {
            errors.push(`Round ${previousRound}, tieBreak ${j+1}: must be an object`);
            continue;
          }
          for (const field of Object.keys(tb)) {
            if (!allowedTieBreakFields.has(field)) {
              errors.push(`Round ${previousRound}, tieBreak ${j+1}: Unexpected field: "${field}"`);
            }
          }
          if (!tb.selected || !Array.isArray(tb.tiedCandidates) || tb.tiedCandidates.length < 2) {
            errors.push(`Round ${previousRound}, tieBreak ${j+1}: needs a selected candidate and at least two tiedCandidates`);
          }
        }
      }
    }

    // Check if tallyResults exists and is an array
    if (!round.tallyResults) {
      errors.push(`Round ${previousRound} is missing tallyResults`);
      continue; // Skip further validation for this round
    }
    
    if (!Array.isArray(round.tallyResults)) {
      errors.push(`Round ${previousRound}: tallyResults must be an array`);
      continue;
    }

    // Validate each tallyResult
    for (let j = 0; j < round.tallyResults.length; j++) {
      const tallyResult = round.tallyResults[j];
      
      // Check for unexpected fields
      for (const field of Object.keys(tallyResult)) {
        if (!allowedTallyResultsFields.has(field)) {
          errors.push(`Round ${previousRound}, tallyResult ${j+1}: Unexpected field: "${field}"`);
        }
      }
      
      // Check if it has elected OR eliminated but not both
      if (tallyResult.elected !== undefined && tallyResult.eliminated !== undefined) {
        errors.push(`Round ${previousRound}, tallyResult ${j+1}: has both elected and eliminated set`);
      } else if (tallyResult.elected === undefined && tallyResult.eliminated === undefined) {
        errors.push(`Round ${previousRound}, tallyResult ${j+1}: has neither elected nor eliminated set`);
      }

      const candidateName = tallyResult.elected || tallyResult.eliminated;
      
      // Check that the candidate being elected/eliminated is in the candidate list
      if (candidateName && !remainingCandidates.has(candidateName)) {
        errors.push(`Round ${previousRound}, tallyResult ${j+1}: references candidate "${candidateName}" who is not in the current candidate list`);
      }

      // Validate transfers
      if (!tallyResult.transfers) {
        errors.push(`Round ${previousRound}, tallyResult ${j+1}: missing transfers`);
        continue;
      }
      
      if (typeof tallyResult.transfers !== 'object' || Array.isArray(tallyResult.transfers)) {
        errors.push(`Round ${previousRound}, tallyResult ${j+1}: transfers must be an object`);
        continue;
      }

      // Check that transfer destinations are valid
      const transferKeys = Object.keys(tallyResult.transfers);
      for (const transferKey of transferKeys) {
        if (transferKey !== 'exhausted' && transferKey !== 'residual surplus' && !remainingCandidates.has(transferKey)) {
          errors.push(`Round ${previousRound}, tallyResult ${j+1}: transfers votes to "${transferKey}" who is not in the current candidate list`);
        }
      }

      // If this is an elimination, check transfer total
      if (tallyResult.eliminated && candidateName) {
        // Get the number of votes the eliminated candidate had
        const candidateVotes = parseFloat(round.tally[candidateName] || '0');
        
        // Calculate total transfers
        let transferTotal = 0;
        for (const transferAmount of Object.values(tallyResult.transfers)) {
          const amount = parseFloat(transferAmount as string || '0');
          if (!isNaN(amount)) {
            transferTotal += amount;
          }
        }

        // Check if totals match (with floating point tolerance)
        if (Math.abs(candidateVotes - transferTotal) > 0.01) {
          errors.push(`Round ${previousRound}: Eliminated candidate "${candidateName}" had ${candidateVotes} votes but transferred ${transferTotal}`);
        }
      }

      // Remove eliminated candidates from remaining list for next round.
      // Elected candidates stay — in Meek's method they continue receiving transfers.
      if (tallyResult.eliminated && candidateName) {
        remainingCandidates.delete(candidateName);
      }
    }
  }

  // 3b. Per-candidate conservation check across round transitions.
  //     For each candidate C in round R, the Sankey-balance constraint is:
  //         prev_tally[C] + incoming[C] = next_tally[C] + outgoing[C]
  //     where:
  //       outgoing[C] = sum of C's transfers when C is a source (eliminated
  //                     or elected with surplus) in round R
  //       incoming[C] = sum of transfers directed at C from any source in
  //                     round R's tallyResults
  //     If C is eliminated in R, C is absent from R+1's tally (next_tally=0).
  //     Destinations "exhausted" and "residual surplus" count as outflow only.
  const TOLERANCE = 0.01;
  for (let i = 0; i < data.results.length - 1; i++) {
    const round = data.results[i];
    const nextRound = data.results[i + 1];
    if (!round?.tally || !nextRound?.tally || !Array.isArray(round.tallyResults)) continue;

    const outgoing: Record<string, number> = {};
    const incoming: Record<string, number> = {};
    for (const tr of round.tallyResults) {
      const source = tr.elected || tr.eliminated;
      if (!source || !tr.transfers) continue;
      let total = 0;
      for (const [dest, amountStr] of Object.entries(tr.transfers)) {
        const amount = parseFloat(amountStr as string || '0');
        if (isNaN(amount)) continue;
        total += amount;
        if (dest !== 'exhausted' && dest !== 'residual surplus') {
          incoming[dest] = (incoming[dest] || 0) + amount;
        }
      }
      outgoing[source] = (outgoing[source] || 0) + total;
    }

    for (const name of Object.keys(round.tally)) {
      const prev = parseFloat(round.tally[name] || '0');
      const next = parseFloat(nextRound.tally[name] || '0');
      const out = outgoing[name] || 0;
      const inc = incoming[name] || 0;
      const delta = (prev + inc) - (next + out);
      if (Math.abs(delta) > TOLERANCE) {
        // Non-fatal: drift from floating-point rounding across many
        // rounds with 4-decimal-place vote arithmetic. Surface as a
        // warning so the chart still renders; the user sees a tiny
        // amount of imbalance, not a failure.
        warnings.push(
          `Round ${round.round}→${nextRound.round}: "${name}" unbalanced — ` +
          `prev=${prev} + in=${inc.toFixed(4)} ≠ next=${next} + out=${out.toFixed(4)} ` +
          `(delta=${delta.toFixed(4)})`,
        );
      }
    }
  }

  // 4. Check summary structure
  if (!data.summary) {
    errors.push('Summary is missing');
  } else if (typeof data.summary !== 'object' || Array.isArray(data.summary)) {
    errors.push('Summary must be an object');
  } else {
    // Check for unexpected fields in summary
    for (const field of Object.keys(data.summary)) {
      if (!allowedSummaryFields.has(field)) {
        errors.push(`Unexpected field in summary: "${field}"`);
      }
    }

    // Check for required fields. finalThreshold is intentionally NOT required:
    // plain bottoms-up has no winning threshold (the winner set is whoever
    // survives the last elimination round — the "threshold" is only known
    // after the fact), and per-round `threshold` is already optional for the
    // same reason.
    const requiredSummaryFields = ['numCandidates', 'numWinners', 'totalNumBallots'];
    for (const field of requiredSummaryFields) {
      if (data.summary[field] === undefined) {
        errors.push(`Summary is missing required field: "${field}"`);
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}