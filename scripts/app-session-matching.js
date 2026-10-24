/**
 * Name matching used when merging quizzes: pairs teams, blocks and questions
 * by name (case-insensitive) and then by position.
 */

/**
 * Compare two arrays of names and find matches
 * @param {Array} localNames - Local names array (index 0 is null/placeholder)
 * @param {Array} remoteNames - Remote names array (index 0 is null/placeholder)
 * @param {string} type - Type for logging ('team', 'block', 'question')
 * @returns {Object} Matching result
 */
function compareArrays(localNames, remoteNames, type) {
  var result = {
    matches: [],      // Array of { remoteIndex, localIndex, confidence, remoteName, localName }
    unmatched: {
      local: [],      // Indices that exist only locally
      remote: []      // Indices that exist only remotely
    },
    needsReview: false
  };
  
  var localUsed = new Set();
  var remoteUsed = new Set();
  
  // Pass 1: Exact name matches (case-insensitive)
  for (var r = 1; r < remoteNames.length; r++) {
    if (!remoteNames[r]) continue;
    
    var remoteName = remoteNames[r].toLowerCase().trim();
    
    for (var l = 1; l < localNames.length; l++) {
      if (localUsed.has(l) || !localNames[l]) continue;
      
      var localName = localNames[l].toLowerCase().trim();
      
      if (remoteName === localName) {
        result.matches.push({
          remoteIndex: r,
          localIndex: l,
          confidence: 'exact',
          remoteName: remoteNames[r],
          localName: localNames[l]
        });
        localUsed.add(l);
        remoteUsed.add(r);
        break;
      }
    }
  }
  
  // Pass 2: Position matches for remaining (same index, different name)
  for (var r = 1; r < remoteNames.length; r++) {
    if (remoteUsed.has(r) || !remoteNames[r]) continue;
    
    // Check if same position is available locally
    if (r < localNames.length && localNames[r] && !localUsed.has(r)) {
      result.matches.push({
        remoteIndex: r,
        localIndex: r,
        confidence: 'position',
        remoteName: remoteNames[r],
        localName: localNames[r]
      });
      localUsed.add(r);
      remoteUsed.add(r);
      result.needsReview = true;
    }
  }
  
  // Pass 3: Collect unmatched remote items
  for (var r = 1; r < remoteNames.length; r++) {
    if (!remoteUsed.has(r) && remoteNames[r]) {
      result.unmatched.remote.push({
        index: r,
        name: remoteNames[r]
      });
      result.needsReview = true;
    }
  }
  
  // Pass 4: Collect unmatched local items
  for (var l = 1; l < localNames.length; l++) {
    if (!localUsed.has(l) && localNames[l]) {
      result.unmatched.local.push({
        index: l,
        name: localNames[l]
      });
    }
  }
  
  return result;
}

/**
 * Compare local and remote session data to find matches
 * @param {Object} localData - Local session data { teams, blocks, questions }
 * @param {Object} remoteData - Remote session data { teams, blocks, questions }
 * @returns {Object} Matching results for teams, blocks, questions
 */
function compareSessionData(localData, remoteData) {
  return {
    teams: compareArrays(localData.teams || [null], remoteData.teams || [null], 'team'),
    blocks: compareArrays(localData.blocks || [null], remoteData.blocks || [null], 'block'),
    questions: compareArrays(localData.questions || [null], remoteData.questions || [null], 'question')
  };
}

/**
 * Calculate overall match statistics
 * @param {Object} comparison - Result from compareSessionData
 * @returns {Object} Statistics
 */
function getMatchStats(comparison) {
  var stats = {
    teams: {
      total: comparison.teams.matches.length + comparison.teams.unmatched.remote.length,
      exact: comparison.teams.matches.filter(function(m) { return m.confidence === 'exact'; }).length,
      needsReview: comparison.teams.needsReview
    },
    blocks: {
      total: comparison.blocks.matches.length + comparison.blocks.unmatched.remote.length,
      exact: comparison.blocks.matches.filter(function(m) { return m.confidence === 'exact'; }).length,
      needsReview: comparison.blocks.needsReview
    },
    questions: {
      total: comparison.questions.matches.length + comparison.questions.unmatched.remote.length,
      exact: comparison.questions.matches.filter(function(m) { return m.confidence === 'exact'; }).length,
      needsReview: comparison.questions.needsReview
    }
  };
  
  stats.overallNeedsReview = stats.teams.needsReview || 
                             stats.blocks.needsReview || 
                             stats.questions.needsReview;
  
  return stats;
}
