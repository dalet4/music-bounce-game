// Firebase Cloud Functions for Music Bounce Game
const functions = require('firebase-functions');
const admin = require('firebase-admin');
const axios = require('axios');
const SpotifyWebApi = require('spotify-web-api-node');
const cors = require('cors')({ origin: true });

admin.initializeApp();

// Spotify API credentials
const SPOTIFY_CLIENT_ID = '60b957e9a3604a4785de567b3e8aa840';
const SPOTIFY_CLIENT_SECRET = 'c2d70ccbbe3d4c45a7b9d8f20597a197';
const SPOTIFY_REDIRECT_URI = 'https://europe-west2-musicbouncegame.cloudfunctions.net/spotifyCallback';

// Initialize Spotify API for a user
function initSpotifyApi(userId) {
  return admin.firestore().collection('users').doc(userId).get()
    .then((doc) => {
      if (!doc.exists || !doc.data().spotifyTokens) {
        throw new Error('User not authenticated with Spotify');
      }
      
      const tokens = doc.data().spotifyTokens;
      const spotifyApi = new SpotifyWebApi({
        clientId: SPOTIFY_CLIENT_ID,
        clientSecret: SPOTIFY_CLIENT_SECRET,
        redirectUri: SPOTIFY_REDIRECT_URI
      });
      
      spotifyApi.setAccessToken(tokens.accessToken);
      spotifyApi.setRefreshToken(tokens.refreshToken);
      
      // Check if token is expired and refresh if needed
      if (tokens.expiresAt < Date.now()) {
        return spotifyApi.refreshAccessToken()
          .then(data => {
            const newTokens = {
              accessToken: data.body.access_token,
              refreshToken: tokens.refreshToken,
              expiresAt: Date.now() + (data.body.expires_in * 1000)
            };
            
            // Update tokens in Firestore
            return admin.firestore().collection('users').doc(userId).update({
              'spotifyTokens': newTokens
            }).then(() => {
              spotifyApi.setAccessToken(newTokens.accessToken);
              return spotifyApi;
            });
          });
      }
      
      return spotifyApi;
    });
}

// Spotify Authentication
exports.spotifyAuth = functions.https.onCall((data, context) => {
  if (!context.auth) {
    throw new functions.https.HttpsError('unauthenticated', 'User must be logged in');
  }
  
  const scopes = [
    'user-read-private',
    'user-read-email',
    'user-library-read',
    'streaming'
  ];
  
  const state = context.auth.uid;
  
  const spotifyApi = new SpotifyWebApi({
    clientId: SPOTIFY_CLIENT_ID,
    clientSecret: SPOTIFY_CLIENT_SECRET,
    redirectUri: SPOTIFY_REDIRECT_URI
  });
  
  const authorizeURL = spotifyApi.createAuthorizeURL(scopes, state);
  
  return { url: authorizeURL };
});

// Spotify Auth Callback
exports.spotifyCallback = functions.https.onRequest((req, res) => {
  cors(req, res, () => {
    const code = req.query.code;
    const state = req.query.state; // This should be the user's Firebase UID
    
    if (!code || !state) {
      return res.status(400).send('Missing required parameters');
    }
    
    const spotifyApi = new SpotifyWebApi({
      clientId: SPOTIFY_CLIENT_ID,
      clientSecret: SPOTIFY_CLIENT_SECRET,
      redirectUri: SPOTIFY_REDIRECT_URI
    });
    
    // Exchange authorization code for tokens
    spotifyApi.authorizationCodeGrant(code)
      .then(data => {
        const tokens = {
          accessToken: data.body.access_token,
          refreshToken: data.body.refresh_token,
          expiresAt: Date.now() + (data.body.expires_in * 1000)
        };
        
        // Store tokens in Firestore
        return admin.firestore().collection('users').doc(state).update({
          spotifyTokens: tokens
        }).then(() => {
          // Redirect back to the app
          res.redirect('/auth-success.html');
        });
      })
      .catch(error => {
        console.error('Error getting Spotify tokens:', error);
        res.status(500).send('Authentication failed');
      });
  });
});

// Get user's music library
exports.getUserLibrary = functions.https.onCall(async (data, context) => {
  if (!context.auth) {
    throw new functions.https.HttpsError('unauthenticated', 'User must be logged in');
  }
  
  const userId = context.auth.uid;
  const service = data.service || 'spotify';
  
  try {
    if (service === 'spotify') {
      const spotifyApi = await initSpotifyApi(userId);
      
      // Get user's saved tracks
      const response = await spotifyApi.getMySavedTracks({ limit: 50 });
      
      // Format the response
      return response.body.items.map(item => ({
        id: item.track.id,
        title: item.track.name,
        artist: item.track.artists.map(artist => artist.name).join(', '),
        albumArt: item.track.album.images[0]?.url,
        duration: item.track.duration_ms
      }));
    } else if (service === 'youtube') {
      // Implement YouTube Music API logic
      throw new functions.https.HttpsError('unimplemented', 'YouTube Music API not implemented yet');
    } else if (service === 'apple') {
      // Implement Apple Music API logic
      throw new functions.https.HttpsError('unimplemented', 'Apple Music API not implemented yet');
    } else {
      throw new functions.https.HttpsError('invalid-argument', 'Invalid music service');
    }
  } catch (error) {
    console.error('Error getting music library:', error);
    throw new functions.https.HttpsError('internal', error.message);
  }
});

// Analyze track for beat information
exports.analyzeTrack = functions.https.onCall(async (data, context) => {
  if (!context.auth) {
    throw new functions.https.HttpsError('unauthenticated', 'User must be logged in');
  }
  
  const userId = context.auth.uid;
  const { trackId, service } = data;
  
  if (!trackId) {
    throw new functions.https.HttpsError('invalid-argument', 'Track ID is required');
  }
  
  try {
    // Check cache first
    const cacheRef = admin.firestore().collection('trackAnalysis').doc(trackId);
    const cacheDoc = await cacheRef.get();
    
    if (cacheDoc.exists) {
      return cacheDoc.data();
    }
    
    // No cached data, perform analysis
    if (service === 'spotify') {
      const spotifyApi = await initSpotifyApi(userId);
      
      // Get audio features and analysis
      const [featuresResponse, analysisResponse] = await Promise.all([
        spotifyApi.getAudioFeaturesForTrack(trackId),
        spotifyApi.getAudioAnalysisForTrack(trackId)
      ]);
      
      const features = featuresResponse.body;
      const analysis = analysisResponse.body;
      
      // Extract the relevant beat information
      const result = {
        tempo: features.tempo,
        key: features.key,
        timeSignature: features.time_signature,
        beats: analysis.beats.map(beat => ({
          start: beat.start * 1000, // Convert to milliseconds
          duration: beat.duration * 1000,
          confidence: beat.confidence
        })),
        sections: analysis.sections.map(section => ({
          start: section.start * 1000,
          duration: section.duration * 1000,
          loudness: section.loudness,
          tempo: section.tempo,
          key: section.key,
          mode: section.mode,
          timeSignature: section.time_signature
        })),
        segments: analysis.segments.slice(0, 100).map(segment => ({
          start: segment.start * 1000,
          duration: segment.duration * 1000,
          loudness: segment.loudness_max,
          pitches: segment.pitches
        }))
      };
      
      // Cache the analysis results
      await cacheRef.set(result);
      
      return result;
    } else if (service === 'youtube') {
      // Implement YouTube Music API logic for beat detection
      throw new functions.https.HttpsError('unimplemented', 'YouTube Music API not implemented yet');
    } else if (service === 'apple') {
      // Implement Apple Music API logic for beat detection
      throw new functions.https.HttpsError('unimplemented', 'Apple Music API not implemented yet');
    } else {
      throw new functions.https.HttpsError('invalid-argument', 'Invalid music service');
    }
  } catch (error) {
    console.error('Error analyzing track:', error);
    throw new functions.https.HttpsError('internal', error.message);
  }
});

// Stream audio proxy (to avoid CORS issues)
exports.streamAudio = functions.https.onRequest(async (req, res) => {
  cors(req, res, async () => {
    if (!req.query.id || !req.query.service) {
      return res.status(400).send('Missing track ID or service');
    }
    
    const trackId = req.query.id;
    const service = req.query.service;
    
    // Verify Firebase Authentication
    try {
      const authHeader = req.headers.authorization;
      if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(403).send('Unauthorized');
      }
      
      const idToken = authHeader.split('Bearer ')[1];
      await admin.auth().verifyIdToken(idToken);
      
      // Proxy the streaming request based on the service
      if (service === 'spotify') {
        // For Spotify, we'll redirect to their streaming URL
        // This requires premium subscription and proper authentication
        res.set('Access-Control-Allow-Origin', '*');
        res.redirect(`https://api.spotify.com/v1/tracks/${trackId}/preview`);
      } else {
        res.status(400).send('Unsupported music service');
      }
    } catch (error) {
      console.error('Authentication error:', error);
      res.status(403).send('Unauthorized');
    }
  });
});

// Alternative beat detection implementation
// Use this if Spotify's audio analysis is not sufficient
exports.detectBeats = functions.https.onCall(async (data, context) => {
  if (!context.auth) {
    throw new functions.https.HttpsError('unauthenticated', 'User must be logged in');
  }
  
  const { audioData } = data;
  
  if (!audioData) {
    throw new functions.https.HttpsError('invalid-argument', 'Audio data is required');
  }
  
  try {
    // This would use a beat detection algorithm
    // For example, you could use a Cloud Function to run BeatDetektor or similar
    // This is a simplified example
    const beats = [];
    
    // In a real implementation, you'd process the audio data
    // and extract beats using DSP techniques
    
    return { beats };
  } catch (error) {
    console.error('Error detecting beats:', error);
    throw new functions.https.HttpsError('internal', error.message);
  }
});

// Leaderboard functions
exports.getGlobalLeaderboard = functions.https.onCall(async (data, context) => {
  if (!context.auth) {
    throw new functions.https.HttpsError('unauthenticated', 'User must be logged in');
  }
  
  const { trackId, limit = 10 } = data;
  
  try {
    const leaderboardRef = admin.firestore().collection('scores');
    let query = leaderboardRef.orderBy('score', 'desc').limit(limit);
    
    if (trackId) {
      query = query.where('songId', '==', trackId);
    }
    
    const snapshot = await query.get();
    
    const leaderboard = [];
    snapshot.forEach(doc => {
      const data = doc.data();
      leaderboard.push({
        id: doc.id,
        userId: data.userId,
        userName: data.userName,
        score: data.score,
        songId: data.songId,
        difficulty: data.difficulty,
        timestamp: data.timestamp.toDate()
      });
    });
    
    return { leaderboard };
  } catch (error) {
    console.error('Error getting leaderboard:', error);
    throw new functions.https.HttpsError('internal', error.message);
  }
});

// User profile and statistics
exports.getUserStats = functions.https.onCall(async (data, context) => {
  if (!context.auth) {
    throw new functions.https.HttpsError('unauthenticated', 'User must be logged in');
  }
  
  const userId = context.auth.uid;
  
  try {
    // Get user's top scores
    const scoresRef = admin.firestore().collection('scores');
    const scoresSnapshot = await scoresRef
      .where('userId', '==', userId)
      .orderBy('score', 'desc')
      .limit(5)
      .get();
    
    const topScores = [];
    scoresSnapshot.forEach(doc => {
      const data = doc.data();
      topScores.push({
        id: doc.id,
        score: data.score,
        songId: data.songId,
        difficulty: data.difficulty,
        timestamp: data.timestamp.toDate()
      });
    });
    
    // Calculate total games played
    const countSnapshot = await scoresRef
      .where('userId', '==', userId)
      .count()
      .get();
    
    const totalGames = countSnapshot.data().count;
    
    // Get user profile data
    const userRef = admin.firestore().collection('users').doc(userId);
    const userDoc = await userRef.get();
    const userData = userDoc.data() || {};
    
    return {
      profile: {
        displayName: userData.displayName || '',
        photoURL: userData.photoURL || '',
        preferences: userData.preferences || {}
      },
      stats: {
        totalGames,
        topScores
      }
    };
  } catch (error) {
    console.error('Error getting user stats:', error);
    throw new functions.https.HttpsError('internal', error.message);
  }
});
