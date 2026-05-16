(function () {
  'use strict';

  const cfg = window.__FRETDLE__;
  if (!cfg) return;

  const musicSource = cfg.words || [];
  const extraSource = cfg.extraValid || [];

  const cleanList = function (list) {
    return list.map(function (entry) {
      const val = (typeof entry === 'string') ? entry : (entry && entry.word ? entry.word : '');
      return val.toString().trim().toUpperCase();
    }).filter(function (w) {
      return w.length === 5;
    });
  };

  const WORD_LIST = Array.from(new Set(cleanList(musicSource)));
  const ALL_VALID = new Set(WORD_LIST.concat(cleanList(extraSource)));

  const ROWS = 6;
  const COLS = 5;
  let secret;
  let currentRow;
  let currentCol;
  let board;
  let gameOver;
  const stats = { played: 0, won: 0, streak: 0 };

  const boardEl = document.getElementById('game-board');
  const msgEl = document.getElementById('game-msg');
  const hintEl = document.getElementById('game-hint');
  const newBtn = document.getElementById('game-new-btn');
  const statPlayed = document.getElementById('stat-played');
  const statWon = document.getElementById('stat-won');
  const statStreak = document.getElementById('stat-streak');

  function buildBoard() {
    if (!boardEl) return;
    boardEl.innerHTML = '';
    board = [];
    for (let r = 0; r < ROWS; r++) {
      const row = document.createElement('div');
      row.className = 'game-row';
      const rowTiles = [];
      for (let c = 0; c < COLS; c++) {
        const tile = document.createElement('div');
        tile.className = 'game-tile';
        row.appendChild(tile);
        rowTiles.push(tile);
      }
      boardEl.appendChild(row);
      board.push(rowTiles);
    }
  }

  function buildKeyboard() {
    const kbEl = document.getElementById('game-keyboard');
    if (!kbEl) return;
    kbEl.querySelectorAll('.kb-row').forEach(function (row) {
      row.innerHTML = '';
      const keysStr = row.dataset.keys;
      if (!keysStr) return;
      const keys = keysStr.split('');
      keys.forEach(function (k) {
        const btn = document.createElement('button');
        btn.className = 'kb-key' + (k === '↵' || k === '⌫' ? ' wide' : '');
        btn.textContent = k;
        btn.dataset.key = k;
        btn.addEventListener('click', function () {
          handleKey(k);
        });
        row.appendChild(btn);
      });
    });
  }

  function resetKeyboard() {
    document.querySelectorAll('.kb-key').forEach(function (k) {
      k.classList.remove('correct', 'present', 'absent');
    });
  }

  function newGame() {
    if (WORD_LIST.length === 0) {
      secret = 'GUITAR';
      console.warn('Fretdle: WORD_LIST is empty, using fallback.');
    } else {
      secret = WORD_LIST[Math.floor(Math.random() * WORD_LIST.length)];
    }
    currentRow = 0;
    currentCol = 0;
    gameOver = false;
    buildBoard();
    resetKeyboard();
    if (msgEl) {
      msgEl.className = 'game-message';
      msgEl.textContent = '> GUESS THE 5-LETTER MUSIC WORD';
    }
    if (hintEl) hintEl.textContent = '6 attempts // green = right spot // gold = wrong spot';
    updateStats();

    if (boardEl) boardEl.focus && boardEl.focus();
  }

  function updateStats() {
    if (statPlayed) statPlayed.textContent = stats.played;
    if (statWon) statWon.textContent = stats.won;
    if (statStreak) statStreak.textContent = stats.streak;
  }

  function setMessage(text, type) {
    if (!msgEl) return;
    msgEl.className = 'game-message' + (type ? ' ' + type : '');
    msgEl.textContent = '> ' + text;
  }

  function handleKey(key) {
    if (gameOver) return;
    if (key === '⌫' || key === 'BACKSPACE') {
      deleteLetter();
      return;
    }
    if (key === '↵' || key === 'ENTER') {
      submitGuess();
      return;
    }
    if (/^[A-Z]$/.test(key)) addLetter(key);
  }

  function addLetter(letter) {
    if (currentCol >= COLS) return;
    const tile = board[currentRow][currentCol];
    tile.textContent = letter;
    tile.classList.add('filled', 'pop');
    tile.addEventListener('animationend', function () {
      tile.classList.remove('pop');
    }, { once: true });
    currentCol++;
  }

  function deleteLetter() {
    if (currentCol <= 0) return;
    currentCol--;
    const tile = board[currentRow][currentCol];
    tile.textContent = '';
    tile.classList.remove('filled');
  }

  function getGuess() {
    return Array.from({ length: COLS }, function (_, c) {
      return board[currentRow][c].textContent;
    }).join('');
  }

  function submitGuess() {
    if (currentCol < COLS) {
      setMessage('NOT ENOUGH LETTERS', 'error');
      shakeRow(currentRow);
      return;
    }
    const guess = getGuess();
    if (!ALL_VALID.has(guess)) {
      setMessage('NOT IN WORD LIST', 'error');
      shakeRow(currentRow);
      return;
    }
    const result = scoreGuess(guess);
    revealRow(currentRow, guess, result, function () {
      updateKeyboard(guess, result);
      const won = result.every(function (r) {
        return r === 'correct';
      });
      if (won) {
        stats.played++;
        stats.won++;
        stats.streak++;
        updateStats();
        gameOver = true;
        const msgs = ['NAILED IT', 'NICE PLAYING', 'ON THE MONEY', 'PERFECT PITCH', 'SHRED MASTER'];
        setTimeout(function () {
          setMessage(msgs[Math.min(currentRow, msgs.length - 1)], 'win');
        }, 400);
        if (hintEl) hintEl.textContent = '[ hit New Word to play again ]';
        return;
      }
      currentRow++;
      currentCol = 0;
      if (currentRow >= ROWS) {
        stats.played++;
        stats.streak = 0;
        updateStats();
        gameOver = true;
        setTimeout(function () {
          setMessage('THE WORD WAS: ' + secret, 'error');
          if (hintEl) hintEl.textContent = '[ hit New Word to play again ]';
        }, 400);
      }
    });
  }

  function scoreGuess(guess) {
    const result = Array(COLS).fill('absent');
    const secretArr = secret.split('');
    const guessArr = guess.split('');
    for (let i = 0; i < COLS; i++) {
      if (guessArr[i] === secretArr[i]) {
        result[i] = 'correct';
        secretArr[i] = null;
        guessArr[i] = null;
      }
    }
    for (let i = 0; i < COLS; i++) {
      if (guessArr[i] === null) continue;
      const idx = secretArr.indexOf(guessArr[i]);
      if (idx !== -1) {
        result[i] = 'present';
        secretArr[idx] = null;
      }
    }
    return result;
  }

  function revealRow(row, guess, result, onDone) {
    board[row].forEach(function (tile, i) {
      setTimeout(function () {
        tile.classList.add('flip');
        setTimeout(function () {
          tile.classList.add(result[i]);
          tile.classList.remove('flip');
          if (i === COLS - 1 && onDone) onDone();
        }, 200);
      }, i * 120);
    });
  }

  function updateKeyboard(guess, result) {
    const priority = { correct: 3, present: 2, absent: 1 };
    guess.split('').forEach(function (letter, i) {
      const btn = document.querySelector('.kb-key[data-key="' + letter + '"]');
      if (!btn) return;
      const currentClass = ['correct', 'present', 'absent'].find(function (c) {
        return btn.classList.contains(c);
      });
      const currentPrio = currentClass ? priority[currentClass] : 0;
      if (priority[result[i]] > currentPrio) {
        btn.classList.remove('correct', 'present', 'absent');
        btn.classList.add(result[i]);
      }
    });
  }

  function shakeRow(row) {
    if (!boardEl) return;
    const rowEl = boardEl.children[row];
    rowEl.classList.add('shake');
    rowEl.addEventListener('animationend', function () {
      rowEl.classList.remove('shake');
    }, { once: true });
  }

  document.addEventListener('keydown', function (e) {
    const section = document.getElementById('game-section');
    if (!section) return;
    if (e.ctrlKey || e.altKey || e.metaKey) return;
    if (e.key === 'Enter') {
      handleKey('↵');
      return;
    }
    if (e.key === 'Backspace') {
      handleKey('⌫');
      return;
    }
    const k = e.key.toUpperCase();
    if (/^[A-Z]$/.test(k)) handleKey(k);
  });

  if (newBtn) newBtn.addEventListener('click', function () {   newGame();   newBtn.blur(); // prevent Enter from re-triggering this button });

  buildKeyboard();
  newGame();
})();
