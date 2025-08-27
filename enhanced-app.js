// Firebase Configuration and Setup
import { initializeApp } from "firebase/app";
import { getAuth, signInWithPopup, GoogleAuthProvider } from "firebase/auth";
import { getFirestore, collection, addDoc, query, where, orderBy, limit, getDocs } from "firebase/firestore";
import { getFunctions, httpsCallable } from "firebase/functions";
import { getAnalytics, logEvent } from "firebase/analytics";

// Initialize Firebase
const firebaseConfig = {
  apiKey: "AIzaSyCdRa8UIyHYyy8863EcfJHZWAMxSsKPipY",
  authDomain: "musicbouncegame.firebaseapp.com",
  projectId: "musicbouncegame",
  storageBucket: "musicbouncegame.firebasestorage.app",
  messagingSenderId: "181880913389",
  appId: "1:181880913389:web:998a12067f781100083be4",
  measurementId: "G-21EE9EY9KC"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const functions = getFunctions(app);
const analytics = getAnalytics(app);

// Enhanced Game Variables
let currentUser = null;
let currentSong = null;
let beatData = null;
let game = null;
let score = 0;
let combo = 0;
let maxCombo = 0;
let perfectHits = 0;
let goodHits = 0;
let totalHits = 0;
let difficulty = 'medium';
let isPaused = false;
let gameStartTime = 0;

// Visual Enhancement Variables
let particleEmitters = [];
let screenShake = { x: 0, y: 0, intensity: 0 };
let comboMultiplier = 1;
let backgroundPulse = 1;

// UI State Management
const screens = {
  AUTH: 'auth-screen',
  SONG_SELECTION: 'song-selection',
  GAME: 'game-container',
  GAME_OVER: 'game-over',
  LOADING: 'loading-screen'
};

let currentScreen = screens.AUTH;

// Enhanced Authentication
async function signIn() {
  showScreen(screens.LOADING);
  updateLoadingMessage('Connecting to Spotify...', 'Please sign in with your Spotify account');
  
  try {
    const provider = new GoogleAuthProvider();
    provider.addScope('https://www.googleapis.com/auth/userinfo.email');
    
    const result = await signInWithPopup(auth, provider);
    currentUser = result.user;
    
    document.getElementById('user-display').textContent = `Welcome, ${currentUser.displayName}`;
    
    updateLoadingMessage('Loading your music library...', 'Analyzing your saved tracks');
    await loadUserLibrary();
    
    showScreen(screens.SONG_SELECTION);
    
    logEvent(analytics, 'login', {
      method: 'google',
      user_id: currentUser.uid
    });
  } catch (error) {
    console.error("Authentication failed:", error);
    showErrorMessage('Authentication failed. Please try again.');
    showScreen(screens.AUTH);
  }
}

// Enhanced Music Library Loading
async function loadUserLibrary() {
  try {
    const getUserLibrary = httpsCallable(functions, 'getUserLibrary');
    const result = await getUserLibrary({ service: 'spotify' });
    
    const songListElement = document.getElementById('song-list');
    songListElement.innerHTML = '';
    
    if (result.data && result.data.length > 0) {
      result.data.forEach((song, index) => {
        const songElement = createSongCard(song, index);
        songListElement.appendChild(songElement);
      });
    } else {
      songListElement.innerHTML = `
        <div class="no-songs-message">
          <div class="no-songs-icon">🎵</div>
          <h3>No saved tracks found</h3>
          <p>Save some songs to your Spotify library to play!</p>
        </div>
      `;
    }
  } catch (error) {
    console.error("Error loading library:", error);
    showErrorMessage('Failed to load your music library. Please try again.');
  }
}

// Enhanced Song Card Creation
function createSongCard(song, index) {
  const songElement = document.createElement('div');
  songElement.className = 'song-item';
  
  const albumArt = song.albumArt || 'assets/default-album.svg';
  
  songElement.innerHTML = `
    <div class="song-artwork">
      <img src="${albumArt}" alt="${song.title}" onerror="this.src='assets/default-album.svg'">
      <div class="play-overlay">
        <div class="play-icon">▶</div>
      </div>
    </div>
    <div class="song-details">
      <h3 class="song-title">${song.title}</h3>
      <p class="song-artist">${song.artist}</p>
      <div class="song-duration">${formatDuration(song.duration)}</div>
    </div>
    <div class="difficulty-indicator difficulty-${difficulty}">
      ${getDifficultyLabel(difficulty)}
    </div>
  `;
  
  // Add smooth hover animations
  songElement.addEventListener('mouseenter', () => {
    songElement.style.transform = 'translateY(-8px) scale(1.02)';
  });
  
  songElement.addEventListener('mouseleave', () => {
    songElement.style.transform = 'translateY(0) scale(1)';
  });
  
  songElement.onclick = () => selectSong(song.id, song);
  
  // Stagger animation for loading
  setTimeout(() => {
    songElement.style.opacity = '1';
    songElement.style.transform = 'translateY(0)';
  }, index * 100);
  
  return songElement;
}

// Enhanced Song Selection
async function selectSong(songId, songData) {
  showScreen(screens.LOADING);
  updateLoadingMessage('Analyzing track...', `Processing "${songData.title}" for beat detection`);
  
  try {
    const analyzeTrack = httpsCallable(functions, 'analyzeTrack');
    const result = await analyzeTrack({ trackId: songId, service: 'spotify' });
    
    beatData = result.data;
    currentSong = { id: songId, ...songData };
    
    // Update game UI with song info
    document.getElementById('track-title').textContent = songData.title;
    document.getElementById('track-artist').textContent = songData.artist;
    
    updateLoadingMessage('Preparing game...', 'Loading visual effects and game elements');
    
    // Small delay for better UX
    setTimeout(() => {
      showScreen(screens.GAME);
      initEnhancedGame();
    }, 1000);
    
    logEvent(analytics, 'song_selected', { 
      song_id: songId,
      song_title: songData.title,
      difficulty: difficulty 
    });
  } catch (error) {
    console.error("Error analyzing track:", error);
    showErrorMessage('Failed to analyze track. Please try a different song.');
    showScreen(screens.SONG_SELECTION);
  }
}

// Enhanced Game Implementation with Phaser
function initEnhancedGame() {
  // Reset game state
  score = 0;
  combo = 0;
  maxCombo = 0;
  perfectHits = 0;
  goodHits = 0;
  totalHits = 0;
  gameStartTime = Date.now();
  particleEmitters = [];
  
  const config = {
    type: Phaser.AUTO,
    width: 800,
    height: 600,
    parent: 'game-canvas',
    transparent: true,
    physics: {
      default: 'arcade',
      arcade: {
        gravity: { y: 400 },
        debug: false
      }
    },
    scene: {
      preload: enhancedPreload,
      create: enhancedCreate,
      update: enhancedUpdate
    }
  };
  
  // Destroy existing game
  if (game) {
    game.destroy(true);
  }
  
  game = new Phaser.Game(config);
}

function enhancedPreload() {
  // Create procedural graphics for game elements
  createGameAssets.call(this);
  
  // Load audio (if available)
  if (currentSong && currentSong.preview_url) {
    this.load.audio('song', currentSong.preview_url);
  }
}

function createGameAssets() {
  // Enhanced Ball/Player
  const ballGraphics = this.add.graphics();
  ballGraphics.fillGradientStyle(0x4facfe, 0x00f2fe, 0x667eea, 0x764ba2);
  ballGraphics.fillCircle(25, 25, 25);
  ballGraphics.lineStyle(3, 0xffffff, 0.8);
  ballGraphics.strokeCircle(25, 25, 25);
  ballGraphics.generateTexture('enhanced-ball', 50, 50);
  ballGraphics.destroy();
  
  // Enhanced Platform - Dynamic based on beat strength
  const platformGraphics = this.add.graphics();
  platformGraphics.fillGradientStyle(0xf093fb, 0xf5576c, 0xff6b6b, 0xee5a52);
  platformGraphics.fillRoundedRect(0, 0, 120, 20, 10);
  platformGraphics.lineStyle(2, 0xffffff, 0.6);
  platformGraphics.strokeRoundedRect(0, 0, 120, 20, 10);
  platformGraphics.generateTexture('enhanced-platform', 120, 20);
  platformGraphics.destroy();
  
  // Particle texture
  const particleGraphics = this.add.graphics();
  particleGraphics.fillStyle(0xffffff);
  particleGraphics.fillCircle(2, 2, 2);
  particleGraphics.generateTexture('particle', 4, 4);
  particleGraphics.destroy();
  
  // Trail effect texture
  const trailGraphics = this.add.graphics();
  trailGraphics.fillGradientStyle(0x4facfe, 0x4facfe, 0x4facfe, 0x000000, 0.8, 0);
  trailGraphics.fillEllipse(10, 5, 20, 10);
  trailGraphics.generateTexture('trail', 20, 10);
  trailGraphics.destroy();
}

function enhancedCreate() {
  // Set up enhanced visual elements
  this.cameras.main.setBackgroundColor('rgba(0,0,0,0)');
  
  // Create platform group
  this.platforms = this.physics.add.staticGroup();
  
  // Create enhanced player with trail effect
  this.player = this.physics.add.sprite(400, 100, 'enhanced-ball');
  this.player.setBounce(0.9);
  this.player.setCollideWorldBounds(true);
  this.player.setDrag(50);
  
  // Add glow effect to player
  this.player.setTint(0xffffff);
  this.player.postFX.addGlow(0x00f2fe, 4, 0, false, 0.1, 16);
  
  // Trail system for player
  this.playerTrail = this.add.particles(0, 0, 'trail', {
    follow: this.player,
    quantity: 2,
    scale: { start: 0.3, end: 0 },
    alpha: { start: 0.8, end: 0 },
    lifespan: 300,
    tint: 0x4facfe
  });
  
  // Collision detection with enhanced effects
  this.physics.add.collider(this.player, this.platforms, enhancedHitPlatform, null, this);
  
  // Enhanced controls
  this.cursors = this.input.keyboard.createCursorKeys();
  this.wasd = this.input.keyboard.addKeys('W,S,A,D');
  
  // Enhanced mobile controls with haptic feedback
  this.input.on('pointerdown', (pointer) => {
    const moveForce = 200;
    if (pointer.x < this.game.config.width / 2) {
      this.player.setVelocityX(-moveForce);
    } else {
      this.player.setVelocityX(moveForce);
    }
    
    // Haptic feedback for mobile
    if (navigator.vibrate) {
      navigator.vibrate(50);
    }
    
    // Visual feedback
    this.tweens.add({
      targets: this.player,
      scaleX: 1.2,
      scaleY: 0.8,
      duration: 100,
      yoyo: true
    });
  });
  
  // Background effects
  createBackgroundEffects.call(this);
  
  // Start music and beat tracking
  if (this.sound.get('song')) {
    this.music = this.sound.get('song');
    this.music.play();
  }
  
  // Enhanced beat timing system
  if (beatData && beatData.beats) {
    this.beatIndex = 0;
    this.nextBeatTime = 0;
    
    this.time.addEvent({
      delay: 16, // 60fps checking
      callback: enhancedCheckBeats,
      callbackScope: this,
      loop: true
    });
  }
  
  // Visual pulse system based on music
  this.time.addEvent({
    delay: 100,
    callback: updateBackgroundPulse,
    callbackScope: this,
    loop: true
  });
}

function createBackgroundEffects() {
  // Ambient particles
  this.ambientParticles = this.add.particles(0, 0, 'particle', {
    x: { min: 0, max: 800 },
    y: 600,
    speedY: { min: -50, max: -100 },
    speedX: { min: -20, max: 20 },
    scale: { start: 0.1, end: 0.3 },
    alpha: { start: 0.3, end: 0 },
    lifespan: 4000,
    frequency: 500,
    tint: [0x4facfe, 0x00f2fe, 0x667eea, 0x764ba2]
  });
  
  // Beat visualization rings
  this.beatRings = [];
  for (let i = 0; i < 3; i++) {
    const ring = this.add.circle(400, 300, 50 + i * 30);
    ring.setStrokeStyle(2, 0x4facfe, 0.2);
    ring.setVisible(false);
    this.beatRings.push(ring);
  }
}

function enhancedUpdate() {
  // Enhanced player movement with momentum
  const moveSpeed = 200;
  const acceleration = 400;
  
  if (this.cursors.left.isDown || this.wasd.A.isDown) {
    this.player.setAccelerationX(-acceleration);
  } else if (this.cursors.right.isDown || this.wasd.D.isDown) {
    this.player.setAccelerationX(acceleration);
  } else {
    this.player.setAccelerationX(0);
  }
  
  // Apply screen shake
  if (screenShake.intensity > 0) {
    this.cameras.main.setScroll(
      Phaser.Math.Between(-screenShake.intensity, screenShake.intensity),
      Phaser.Math.Between(-screenShake.intensity, screenShake.intensity)
    );
    screenShake.intensity *= 0.9;
    if (screenShake.intensity < 0.1) screenShake.intensity = 0;
  } else {
    this.cameras.main.setScroll(0, 0);
  }
  
  // Clean up off-screen platforms
  this.platforms.getChildren().forEach(platform => {
    if (platform.y < -50) {
      if (platform.particles) platform.particles.destroy();
      platform.destroy();
    }
  });
  
  // Update particle emitters
  particleEmitters.forEach((emitter, index) => {
    if (!emitter.alive) {
      particleEmitters.splice(index, 1);
    }
  });
}

function enhancedCheckBeats() {
  if (!this.music || !this.music.isPlaying) return;
  
  const currentTime = this.music.seek * 1000;
  
  // Enhanced beat prediction system
  while (this.beatIndex < beatData.beats.length && 
         beatData.beats[this.beatIndex].start < currentTime + 3000) {
    
    const beat = beatData.beats[this.beatIndex];
    const beatTime = beat.start;
    const timeUntilBeat = beatTime - currentTime;
    
    if (timeUntilBeat > 0) {
      this.time.delayedCall(timeUntilBeat, () => {
        enhancedSpawnPlatform.call(this, beat);
        triggerBeatVisualEffect.call(this, beat);
      }, [], this);
    } else if (timeUntilBeat > -500) {
      enhancedSpawnPlatform.call(this, beat);
      triggerBeatVisualEffect.call(this, beat);
    }
    
    this.beatIndex++;
  }
}

function enhancedSpawnPlatform(beat) {
  const x = Phaser.Math.Between(100, 700);
  
  // Create platform with enhanced visuals
  const platform = this.platforms.create(x, 650, 'enhanced-platform');
  
  // Platform size based on difficulty and beat confidence
  let platformWidth = 120;
  if (difficulty === 'easy') platformWidth = 160;
  if (difficulty === 'hard') platformWidth = 90;
  
  // Adjust size based on beat confidence
  platformWidth *= (0.7 + (beat.confidence * 0.6));
  platform.displayWidth = platformWidth;
  platform.refreshBody();
  
  // Enhanced visual properties
  platform.beatStrength = beat.confidence || 0.5;
  platform.beatTime = beat.start;
  
  // Add glow effect based on beat strength
  const glowIntensity = beat.confidence * 10;
  platform.postFX.addGlow(0xf5576c, glowIntensity, 0, false, 0.1, 16);
  
  // Pulsing animation
  this.tweens.add({
    targets: platform,
    scaleY: 1.2,
    duration: 200,
    yoyo: true,
    ease: 'Sine.easeInOut'
  });
  
  // Enhanced movement with easing
  const moveDuration = 4000 - (difficulty === 'hard' ? 1000 : 0);
  this.tweens.add({
    targets: platform,
    y: -50,
    duration: moveDuration,
    ease: 'Linear',
    onComplete: () => {
      if (platform.particles) platform.particles.destroy();
    }
  });
  
  // Add particle trail to platform
  platform.particles = this.add.particles(platform.x, platform.y, 'particle', {
    follow: platform,
    quantity: 1,
    scale: { start: 0.2, end: 0 },
    alpha: { start: 0.6, end: 0 },
    lifespan: 1000,
    tint: 0xf5576c
  });
}

function triggerBeatVisualEffect(beat) {
  // Beat ring visualization
  this.beatRings.forEach((ring, index) => {
    ring.setVisible(true);
    ring.setAlpha(beat.confidence);
    this.tweens.add({
      targets: ring,
      scaleX: 2,
      scaleY: 2,
      alpha: 0,
      duration: 800,
      delay: index * 100,
      onComplete: () => {
        ring.setScale(1);
        ring.setVisible(false);
      }
    });
  });
}

function enhancedHitPlatform(player, platform) {
  // Enhanced bounce with visual feedback
  const bounceForce = -400;
  player.setVelocityY(bounceForce);
  
  // Calculate accuracy
  const currentTime = this.music ? this.music.seek * 1000 : Date.now() - gameStartTime;
  const beatTime = platform.beatTime;
  const timeDiff = Math.abs(currentTime - beatTime);
  
  let points = 0;
  let hitType = 'ok';
  let feedbackColor = '#ff8800';
  
  if (timeDiff < 50) {
    points = 150;
    hitType = 'perfect';
    feedbackColor = '#00ff00';
    perfectHits++;
    combo++;
  } else if (timeDiff < 150) {
    points = 100;
    hitType = 'great';
    feedbackColor = '#4facfe';
    goodHits++;
    combo++;
  } else if (timeDiff < 300) {
    points = 50;
    hitType = 'good';
    feedbackColor = '#ffff00';
    goodHits++;
    combo = Math.max(0, combo - 1);
  } else {
    points = 20;
    hitType = 'ok';
    feedbackColor = '#ff8800';
    combo = 0;
  }
  
  totalHits++;
  
  // Apply combo multiplier
  comboMultiplier = Math.min(4, 1 + (combo * 0.1));
  points = Math.round(points * comboMultiplier * (0.5 + platform.beatStrength / 2));
  
  // Update score
  score += points;
  updateScoreDisplay();
  
  // Enhanced visual feedback
  createHitFeedback(player.x, player.y - 50, hitType, feedbackColor, points);
  
  // Screen shake based on hit quality
  const shakeIntensity = hitType === 'perfect' ? 8 : hitType === 'great' ? 5 : 3;
  screenShake.intensity = shakeIntensity;
  
  // Particle explosion
  createHitParticleEffect.call(this, platform.x, platform.y, hitType);
  
  // Haptic feedback
  if (navigator.vibrate) {
    const vibrationPattern = hitType === 'perfect' ? [100, 50, 100] : [80];
    navigator.vibrate(vibrationPattern);
  }
  
  // Update combo display
  updateComboDisplay();
  
  // Platform destruction effect
  this.tweens.add({
    targets: platform,
    alpha: 0,
    scaleX: 1.5,
    scaleY: 0.5,
    duration: 200,
    onComplete: () => {
      if (platform.particles) platform.particles.destroy();
      platform.destroy();
    }
  });
}

function createHitFeedback(x, y, type, color, points) {
  const feedback = document.createElement('div');
  feedback.className = 'hit-feedback';
  feedback.style.left = x + 'px';
  feedback.style.top = y + 'px';
  feedback.style.color = color;
  feedback.textContent = type.toUpperCase();
  
  const pointsElement = document.createElement('div');
  pointsElement.style.fontSize = '1rem';
  pointsElement.style.marginTop = '5px';
  pointsElement.textContent = `+${points}`;
  feedback.appendChild(pointsElement);
  
  document.body.appendChild(feedback);
  
  // Animate feedback
  feedback.style.animation = 'feedbackFloat 1s ease-out forwards';
  
  setTimeout(() => {
    feedback.remove();
  }, 1000);
}

function createHitParticleEffect(x, y, hitType) {
  const colors = {
    'perfect': [0x00ff00, 0x00ff88, 0x88ff00],
    'great': [0x4facfe, 0x00f2fe, 0x667eea],
    'good': [0xffff00, 0xffd700, 0xffeb3b],
    'ok': [0xff8800, 0xff6b00, 0xff9500]
  };
  
  const particleCount = hitType === 'perfect' ? 20 : hitType === 'great' ? 15 : 10;
  const emitter = this.add.particles(x, y, 'particle', {
    speed: { min: 100, max: 300 },
    scale: { start: 0.3, end: 0 },
    alpha: { start: 1, end: 0 },
    lifespan: 800,
    quantity: particleCount,
    tint: colors[hitType] || colors['ok']
  });
  
  particleEmitters.push(emitter);
  
  this.time.delayedCall(800, () => {
    emitter.destroy();
  });
}

function updateScoreDisplay() {
  const scoreElement = document.getElementById('current-score');
  if (scoreElement) {
    scoreElement.textContent = score.toLocaleString();
    
    // Animate score update
    scoreElement.style.transform = 'scale(1.2)';
    setTimeout(() => {
      scoreElement.style.transform = 'scale(1)';
    }, 200);
  }
}

function updateComboDisplay() {
  const comboElement = document.getElementById('combo-display');
  if (combo > 3) {
    comboElement.textContent = `${combo}x COMBO!`;
    comboElement.className = 'combo-display show';
    
    if (combo > maxCombo) maxCombo = combo;
  } else {
    comboElement.className = 'combo-display';
  }
}

function updateBackgroundPulse() {
  // Sync background pulse with music tempo
  if (beatData && beatData.tempo) {
    const beatInterval = (60 / beatData.tempo) * 1000;
    const currentTime = Date.now() % beatInterval;
    const pulsePhase = (currentTime / beatInterval) * Math.PI * 2;
    backgroundPulse = 0.8 + 0.2 * Math.sin(pulsePhase);
    
    // Update CSS custom property for background pulse
    document.documentElement.style.setProperty('--pulse-scale', backgroundPulse);
  }
}

// Enhanced Game Over
function endGame() {
  const gameTime = Date.now() - gameStartTime;
  const accuracy = totalHits > 0 ? Math.round((perfectHits + goodHits) / totalHits * 100) : 0;
  
  // Update game over stats
  document.getElementById('final-score').textContent = score.toLocaleString();
  document.getElementById('perfect-hits').textContent = perfectHits;
  document.getElementById('good-hits').textContent = goodHits;
  document.getElementById('accuracy').textContent = accuracy + '%';
  
  // Save enhanced score data
  saveEnhancedScore({
    score: score,
    perfectHits: perfectHits,
    goodHits: goodHits,
    maxCombo: maxCombo,
    accuracy: accuracy,
    gameTime: gameTime
  });
  
  logEvent(analytics, 'game_completed', {
    song_id: currentSong.id,
    score: score,
    difficulty: difficulty,
    accuracy: accuracy,
    max_combo: maxCombo,
    game_duration: gameTime
  });
  
  // Show game over with animation
  showScreen(screens.GAME_OVER);
  getLeaderboard();
}

// Enhanced score saving
async function saveEnhancedScore(gameStats) {
  try {
    await addDoc(collection(db, "scores"), {
      userId: currentUser.uid,
      userName: currentUser.displayName,
      songId: currentSong.id,
      songTitle: currentSong.title,
      songArtist: currentSong.artist,
      score: gameStats.score,
      perfectHits: gameStats.perfectHits,
      goodHits: gameStats.goodHits,
      maxCombo: gameStats.maxCombo,
      accuracy: gameStats.accuracy,
      gameTime: gameStats.gameTime,
      timestamp: new Date(),
      difficulty: difficulty
    });
  } catch (error) {
    console.error("Error saving score:", error);
  }
}

// Enhanced leaderboard
async function getLeaderboard() {
  try {
    const q = query(
      collection(db, "scores"),
      where("songId", "==", currentSong.id),
      orderBy("score", "desc"),
      limit(10)
    );
    
    const querySnapshot = await getDocs(q);
    const leaderboardElement = document.getElementById('leaderboard');
    leaderboardElement.innerHTML = '';
    
    if (querySnapshot.empty) {
      leaderboardElement.innerHTML = `
        <div class="no-scores">
          <p>Be the first to set a high score!</p>
        </div>
      `;
      return;
    }
    
    querySnapshot.forEach((doc, index) => {
      const data = doc.data();
      const entry = document.createElement('div');
      entry.className = 'leaderboard-entry';
      
      const rank = index + 1;
      const isCurrentUser = data.userId === currentUser?.uid;
      
      entry.innerHTML = `
        <div class="rank">#${rank}</div>
        <div class="player-info">
          <span class="player-name ${isCurrentUser ? 'current-user' : ''}">${data.userName}</span>
          <span class="accuracy">${data.accuracy || 'N/A'}% acc</span>
        </div>
        <div class="score">${data.score.toLocaleString()}</div>
      `;
      
      if (isCurrentUser) {
        entry.classList.add('current-user-entry');
      }
      
      leaderboardElement.appendChild(entry);
    });
  } catch (error) {
    console.error("Error getting leaderboard:", error);
  }
}

// Utility Functions
function showScreen(screenId) {
  // Hide all screens
  Object.values(screens).forEach(screen => {
    const element = document.getElementById(screen);
    if (element) element.style.display = 'none';
  });
  
  // Show target screen
  const targetScreen = document.getElementById(screenId);
  if (targetScreen) {
    targetScreen.style.display = 'flex';
    currentScreen = screenId;
  }
}

function updateLoadingMessage(title, detail) {
  const titleElement = document.getElementById('loading-message');
  const detailElement = document.getElementById('loading-detail');
  if (titleElement) titleElement.textContent = title;
  if (detailElement) detailElement.textContent = detail;
}

function showErrorMessage(message) {
  // You can implement a toast notification system here
  console.error(message);
  alert(message); // Simple fallback
}

function formatDuration(ms) {
  const minutes = Math.floor(ms / 60000);
  const seconds = Math.floor((ms % 60000) / 1000);
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

function getDifficultyLabel(level) {
  const labels = {
    easy: '⭐ Easy',
    medium: '⭐⭐ Medium', 
    hard: '⭐⭐⭐ Hard'
  };
  return labels[level] || labels.medium;
}

function setDifficulty(level) {
  difficulty = level;
  
  // Update UI
  document.querySelectorAll('.btn-difficulty').forEach(btn => {
    btn.classList.remove('active');
  });
  document.getElementById(`${level}-btn`)?.classList.add('active');
  
  // Update all song cards
  document.querySelectorAll('.difficulty-indicator').forEach(indicator => {
    indicator.className = `difficulty-indicator difficulty-${level}`;
    indicator.textContent = getDifficultyLabel(level);
  });
}

// Game control functions
function pauseGame() {
  if (game && game.scene.isActive('default')) {
    game.scene.pause();
    isPaused = true;
    if (game.sound.get('song')) {
      game.sound.get('song').pause();
    }
  }
}

function resumeGame() {
  if (game && game.scene.isPaused('default')) {
    game.scene.resume();
    isPaused = false;
    if (game.sound.get('song')) {
      game.sound.get('song').resume();
    }
  }
}

function resetGame() {
  if (game) {
    game.destroy(true);
    game = null;
  }
  
  score = 0;
  combo = 0;
  maxCombo = 0;
  perfectHits = 0;
  goodHits = 0;
  totalHits = 0;
  
  updateScoreDisplay();
  updateComboDisplay();
  
  showScreen(screens.GAME);
  initEnhancedGame();
}

// Initialize the application
document.addEventListener('DOMContentLoaded', () => {
  // Event listeners
  document.getElementById('sign-in-btn')?.addEventListener('click', signIn);
  document.getElementById('easy-btn')?.addEventListener('click', () => setDifficulty('easy'));
  document.getElementById('medium-btn')?.addEventListener('click', () => setDifficulty('medium'));
  document.getElementById('hard-btn')?.addEventListener('click', () => setDifficulty('hard'));
  
  document.getElementById('play-again-btn')?.addEventListener('click', () => {
    showScreen(screens.SONG_SELECTION);
  });
  
  document.getElementById('new-song-btn')?.addEventListener('click', () => {
    showScreen(screens.SONG_SELECTION);
  });
  
  document.getElementById('pause-btn')?.addEventListener('click', () => {
    if (isPaused) {
      resumeGame();
      document.getElementById('pause-btn').textContent = '⏸️';
    } else {
      pauseGame();
      document.getElementById('pause-btn').textContent = '▶️';
    }
  });
  
  document.getElementById('reset-game-btn')?.addEventListener('click', resetGame);
  
  document.getElementById('quit-btn')?.addEventListener('click', () => {
    if (game) {
      game.destroy(true);
      game = null;
    }
    showScreen(screens.SONG_SELECTION);
  });
  
  // Keyboard shortcuts
  document.addEventListener('keydown', (e) => {
    if (currentScreen === screens.GAME) {
      switch(e.code) {
        case 'Space':
          e.preventDefault();
          if (isPaused) resumeGame();
          else pauseGame();
          break;
        case 'KeyR':
          e.preventDefault();
          resetGame();
          break;
        case 'Escape':
          e.preventDefault();
          if (game) {
            game.destroy(true);
            game = null;
          }
          showScreen(screens.SONG_SELECTION);
          break;
      }
    }
  });
  
  // Initialize with auth screen
  showScreen(screens.AUTH);
  
  // Add CSS animations
  const style = document.createElement('style');
  style.textContent = `
    @keyframes feedbackFloat {
      0% {
        transform: translateY(0) scale(1);
        opacity: 1;
      }
      100% {
        transform: translateY(-50px) scale(1.5);
        opacity: 0;
      }
    }
    
    .song-item {
      opacity: 0;
      transform: translateY(20px);
      transition: all 0.3s ease;
    }
    
    .current-user {
      font-weight: bold;
      color: var(--accent-gradient);
    }
    
    .current-user-entry {
      background: rgba(79, 172, 254, 0.1);
      border: 1px solid rgba(79, 172, 254, 0.3);
    }
    
    .no-songs-message, .no-scores {
      text-align: center;
      padding: 40px 20px;
      color: var(--text-muted);
    }
    
    .no-songs-icon {
      font-size: 3rem;
      margin-bottom: 20px;
    }
  `;
  document.head.appendChild(style);
});