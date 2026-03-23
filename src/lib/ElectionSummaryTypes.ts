


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
  summary : RCtabSummarySummary
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
  threshold ?: string
}

export interface RCtabInactiveBallots {
  exhaustedChoices ?: string,
  overvotes ?: string,
  repeatedRankings ?: string,
  skippedRankings ?: string
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
export function validateRCtabSummary(data: any): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  // Check if the data is an object
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    return { valid: false, errors: ['Input is not a valid object'] };
  }

  // Define allowed fields for each type
  const allowedRCtabSummaryFields = new Set(['config', 'jsonFormatVersion', 'results', 'summary']);
  const allowedConfigFields = new Set(['contest', 'date', 'generatedBy', 'jurisdiction', 'office', 'threshold']);
  const allowedResultsFields = new Set(['inactiveBallots', 'round', 'tally', 'tallyResults', 'threshold']);
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
    return { valid: errors.length === 0, errors };
  }
  
  if (!Array.isArray(data.results)) {
    errors.push('Results must be an array');
    return { valid: errors.length === 0, errors };
  }

  // Early return if no results to validate
  if (data.results.length === 0) {
    errors.push('Results array is empty');
    return { valid: errors.length === 0, errors };
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

    // Check for required fields
    const requiredSummaryFields = ['finalThreshold', 'numCandidates', 'numWinners', 'totalNumBallots'];
    for (const field of requiredSummaryFields) {
      if (data.summary[field] === undefined) {
        errors.push(`Summary is missing required field: "${field}"`);
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors
  };
}