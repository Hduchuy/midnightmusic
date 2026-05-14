const quotesState = {
  currentMood: 'chill',
  lastQuoteIdx: -1,
  intervalId: null
};

function initQuotes() {
  // Sync the initial mood based on the UI or default to chill
  const activeMoodBtn = document.querySelector('.mood-btn.active');
  const initialMood = activeMoodBtn ? activeMoodBtn.dataset.mood : 'chill';
  
  // Set initial quote immediately
  updateQuoteMood(initialMood);
  
  // Apply CSS transition to the quote wrapper for smooth fading
  const quoteWrap = document.getElementById('quote-wrap');
  if (quoteWrap) {
    quoteWrap.style.transition = 'opacity 0.4s ease, transform 0.4s ease';
  }
}

function startQuoteTimer() {
  if (quotesState.intervalId) {
    clearInterval(quotesState.intervalId);
  }
  quotesState.intervalId = setInterval(() => {
    changeQuote(false);
  }, 300000); // 5 minutes
}

function updateQuoteMood(moodId) {
  const moodMap = {
    'sleep': 'sleepy',
    'study': 'focus'
  };
  const mappedMood = moodMap[moodId] || moodId;
  
  // Check if mood exists in data, otherwise fallback
  if (!QUOTES[mappedMood]) return;
  
  quotesState.currentMood = mappedMood;
  quotesState.lastQuoteIdx = -1; // Reset memory to ensure fresh pick for new mood
  
  changeQuote(true);
}

function changeQuote(isMoodChange = false) {
  const quoteWrap = document.getElementById('quote-wrap');
  const quoteEn = document.getElementById('quote-en');
  const quoteVi = document.getElementById('quote-vi');
  
  if (!quoteWrap || !quoteEn || !quoteVi) return;

  const mood = quotesState.currentMood;
  const moodQuotes = QUOTES[mood] || QUOTES['chill'];
  
  if (!moodQuotes || moodQuotes.length === 0) return;

  // Pick a random quote avoiding immediate repeats
  let nextIdx;
  if (moodQuotes.length > 1) {
    do {
      nextIdx = Math.floor(Math.random() * moodQuotes.length);
    } while (nextIdx === quotesState.lastQuoteIdx);
  } else {
    nextIdx = 0;
  }
  
  quotesState.lastQuoteIdx = nextIdx;
  const selectedQuote = moodQuotes[nextIdx];

  // Animation: Fade out
  quoteWrap.style.opacity = '0';
  quoteWrap.style.transform = 'translateY(5px)';
  
  setTimeout(() => {
    // Update text content
    quoteEn.textContent = `"${selectedQuote.en}"`;
    if (selectedQuote.vi) {
      quoteVi.textContent = selectedQuote.vi;
      quoteVi.style.display = 'block';
    } else {
      quoteVi.style.display = 'none';
    }
    
    // Animation: Fade in
    quoteWrap.style.opacity = '1';
    quoteWrap.style.transform = 'translateY(0)';
  }, 400); // Match CSS transition duration
  
  // Restart timer if it was triggered by a manual mood change
  if (isMoodChange) {
    startQuoteTimer();
  }
}
