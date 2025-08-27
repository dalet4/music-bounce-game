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

// Game variables
let currentUser = null;
let currentSong = null;
let beatData = null;
let game = null;
let score = 0;
let difficulty = 'medium';

// Authentication
async function signIn() {
  try {
    const provider = new GoogleAuthProvider();
    const result = await signInWithPopup(auth, provider);
    currentUser = result.user;
    document.getElementById('user-display').textContent = `Welcome, ${currentUser.displayName}`;
    loadUserLibrary();
  } catch (error) {
    console.error("Authentication failed:", error);
  }
}

// Music Service Integration
async function loadUserLibrary() {
  try {
    const getUserLibrary = httpsCallable(functions, 'getUserLibrary');
    const result = await getUserLibrary({ service: 'spotify' });
    
    const songListElement = document.getElementById('song-list');
    songListElement.innerHTML = '';
    
    result.data.forEach(song => {
      const songElement = document.createElement('div');
      songElement.className = 'song-item';
      songElement.textContent = `${song.title} - ${song.artist}`;
      songElement.onclick = () => selectSong(song.id);
      songListElement.appendChild(songElement);
    });
  } catch (error) {
    console.error("Error loading library:", error);
  }
}

async function selectSong(songId) {
  try {
    const analyzeTrack = httpsCallable(functions, 'analyzeTrack');
    const result = await analyzeTrack({ trackId: songId, service: 'spotify' });
    
    beatData = result.data;
    currentSong = { id: songId };
    
    document.getElementById('game-container').style.display = 'block';
    document.getElementById('song-selection').style.display = 'none';
    
    initGame();
    logEvent(analytics, 'song_selected', { song_id: songId });
  } catch (error) {
    console.error("Error analyzing track:", error);
  }
}

// Game Implementation with Phaser
function initGame() {
  const config = {
    type: Phaser.AUTO,
    width: 800,
    height: 600,
    physics: {
      default: 'arcade',
      arcade: {
        gravity: { y: 300 },
        debug: false
      }
    },
    scene: {
      preload: preload,
      create: create,
      update: update
    }
  };
  
  game = new Phaser.Game(config);
}

function preload() {
  this.load.image('ball', 'assets/ball.png');
  this.load.image('platform', 'assets/platform.png');
  this.load.audio('song', `https://yourproxy.com/stream?id=${currentSong.id}`);
}

function create() {
  // Set up game elements
  this.platforms = this.physics.add.staticGroup();
  this.player = this.physics.add.sprite(400, 100, 'ball');
  this.player.setBounce(0.8);
  this.player.setCollideWorldBounds(true);
  
  // Add collision detection
  this.physics.add.collider(this.player, this.platforms, hitPlatform, null, this);
  
  // Controls
  this.cursors = this.input.keyboard.createCursorKeys();
  
  // Mobile controls
  this.input.on('pointerdown', (pointer) => {
    if (pointer.x < this.game.config.width / 2) {
      this.player.setVelocityX(-160);
    } else {
      this.player.setVelocityX(160);
    }
  });
  
  this.input.on('pointerup', () => {
    this.player.setVelocityX(0);
  });
  
  // Score display
  this.scoreText = this.add.text(16, 16, 'Score: 0', { fontSize: '32px', fill: '#fff' });
  
  // Start music and beat tracking
  this.music = this.sound.add('song');
  this.music.play();
  
  // Set up beat timing
  if (beatData && beatData.beats) {
    this.beatIndex = 0;
    this.time.addEvent({
      delay: 10,
      callback: this.checkBeats,
      callbackScope: this,
      loop: true
    });
  }
}

function update() {
  // Handle player movement
  if (this.cursors.left.isDown) {
    this.player.setVelocityX(-160);
  } else if (this.cursors.right.isDown) {
    this.player.setVelocityX(160);
  } else {
    this.player.setVelocityX(0);
  }
  
  // Remove platforms that have moved off screen
  this.platforms.getChildren().forEach(platform => {
    if (platform.y < -50) {
      platform.destroy();
    }
  });
}

function checkBeats() {
  if (!this.music.isPlaying) return;
  
  const currentTime = this.music.seek * 1000; // Convert to milliseconds
  
  // Check if we need to spawn platforms based on beat timing
  while (this.beatIndex < beatData.beats.length && 
         beatData.beats[this.beatIndex].start < currentTime + 2000) { // Look ahead 2 seconds
    
    const beatTime = beatData.beats[this.beatIndex].start;
    const timeUntilBeat = beatTime - currentTime;
    
    if (timeUntilBeat > 0) {
      // Schedule platform spawn
      this.time.delayedCall(timeUntilBeat, () => {
        spawnPlatform.call(this, beatData.beats[this.beatIndex]);
      }, [], this);
    } else {
      // Beat already passed, spawn immediately
      spawnPlatform.call(this, beatData.beats[this.beatIndex]);
    }
    
    this.beatIndex++;
  }
}

function spawnPlatform(beat) {
  // Calculate platform position - randomize X position
  const x = Phaser.Math.Between(100, 700);
  
  // Create platform at bottom of screen
  const platform = this.platforms.create(x, 650, 'platform');
  
  // Set platform size based on difficulty
  let platformWidth = 120; // Default medium
  if (difficulty === 'easy') platformWidth = 180;
  if (difficulty === 'hard') platformWidth = 80;
  
  platform.displayWidth = platformWidth;
  platform.refreshBody();
  
  // Set platform movement
  platform.beatStrength = beat.confidence || 0.5;
  
  // Platforms move upward
  this.tweens.add({
    targets: platform,
    y: -50,
    duration: 4000, // 4 seconds to travel up
    ease: 'Linear'
  });
  
  // Store beat time for scoring
  platform.beatTime = beat.start;
}

function hitPlatform(player, platform) {
  // Bounce effect
  player.setVelocityY(-330);
  
  // Calculate accuracy based on music timing
  const currentTime = this.music.seek * 1000;
  const beatTime = platform.beatTime;
  const timeDiff = Math.abs(currentTime - beatTime);
  
  let points = 0;
  if (timeDiff < 100) { // Perfect hit
    points = 100;
    showFeedback(this, "Perfect!", 0x00ff00);
  } else if (timeDiff < 200) { // Good hit
    points = 50;
    showFeedback(this, "Good!", 0xffff00);
  } else { // OK hit
    points = 20;
    showFeedback(this, "OK", 0xff8800);
  }
  
  // Adjust points by beat confidence
  points = Math.round(points * (0.5 + platform.beatStrength / 2));
  
  // Update score
  score += points;
  this.scoreText.setText('Score: ' + score);
}

function showFeedback(scene, text, color) {
  const feedback = scene.add.text(
    scene.player.x,
    scene.player.y - 50,
    text,
    { fontSize: '24px', fill: '#fff' }
  );
  feedback.setOrigin(0.5);
  
  scene.tweens.add({
    targets: feedback,
    y: scene.player.y - 100,
    alpha: 0,
    duration: 800,
    onComplete: () => feedback.destroy()
  });
}

// Game over handling
function endGame() {
  saveScore(score);
  
  logEvent(analytics, 'game_completed', {
    song_id: currentSong.id,
    score: score,
    difficulty: difficulty
  });
  
  // Show game over screen
  document.getElementById('game-over').style.display = 'block';
  document.getElementById('final-score').textContent = score;
  
  // Get leaderboard
  getLeaderboard();
}

// Game reset handling
function resetGame() {
  // Reset game variables
  score = 0;
  
  // Destroy the existing Phaser game instance
  if (game) {
    game.destroy(true);
    game = null;
  }
  
  // Re-initialize the game
  initGame();
}

// Firebase interactions for scores
async function saveScore(finalScore) {
  try {
    await addDoc(collection(db, "scores"), {
      userId: currentUser.uid,
      userName: currentUser.displayName,
      songId: currentSong.id,
      score: finalScore,
      timestamp: new Date(),
      difficulty: difficulty
    });
  } catch (error) {
    console.error("Error saving score:", error);
  }
}

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
    
    querySnapshot.forEach((doc) => {
      const data = doc.data();
      const entry = document.createElement('div');
      entry.textContent = `${data.userName}: ${data.score}`;
      leaderboardElement.appendChild(entry);
    });
  } catch (error) {
    console.error("Error getting leaderboard:", error);
  }
}

// Settings
function setDifficulty(level) {
  difficulty = level;
  // Update UI to show selected difficulty
  document.querySelectorAll('.difficulty-btn').forEach(btn => {
    btn.classList.remove('active');
  });
  document.getElementById(`${level}-btn`).classList.add('active');
}

// Initialize the application
document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('sign-in-btn').addEventListener('click', signIn);
  document.getElementById('easy-btn').addEventListener('click', () => setDifficulty('easy'));
  document.getElementById('medium-btn').addEventListener('click', () => setDifficulty('medium'));
  document.getElementById('hard-btn').addEventListener('click', () => setDifficulty('hard'));
  document.getElementById('play-again-btn').addEventListener('click', () => {
    document.getElementById('game-over').style.display = 'none';
    document.getElementById('song-selection').style.display = 'block';
  });
  document.getElementById('reset-game-btn').addEventListener('click', () => {
    document.getElementById('game-over').style.display = 'none';
    resetGame();
  });
});