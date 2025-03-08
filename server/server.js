const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const fetch = require('node-fetch');
const mongoose = require('mongoose');
const admin = require('firebase-admin');
const path = require('path');

// Initialize Firebase Admin (supply your own serviceAccountKey.json)
const serviceAccount = require('./serviceAccountKey.json');
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

// Initialize Express app
const app = express();
app.use(cors());
app.use(bodyParser.json());

// Serve static files from ../public
app.use(express.static(path.join(__dirname, '../public')));

// Connect to MongoDB
mongoose.connect("mongodb+srv://darexmucheri:cMd7EoTwGglJGXwR@cluster0.uwf6z.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0", 
  { useNewUrlParser: true, useUnifiedTopology: true }
)
.then(() => console.log("Connected to MongoDB"))
.catch(err => console.error("MongoDB connection error:", err));

// Bot Schema & Model
const BotSchema = new mongoose.Schema({
  name: String,
  owner: String,       // Firebase uid
  createdAt: { type: Date, default: Date.now },
  envVariables: Object,
});
const Bot = mongoose.model("Bot", BotSchema);

// Middleware: Verify Firebase ID Token
async function verifyFirebaseToken(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  const idToken = authHeader.split("Bearer ")[1];
  try {
    const decodedToken = await admin.auth().verifyIdToken(idToken);
    req.user = decodedToken;
    next();
  } catch (error) {
    console.error("Token verification error:", error);
    return res.status(401).json({ error: "Unauthorized" });
  }
}

// Route: Deploy Bot using Docker-based build from GitHub
app.post('/deploy', verifyFirebaseToken, async (req, res) => {
  const { sessionId, prefix, extraVars } = req.body;
  const herokuApiKey = "HRKU-243b6c53-b708-440c-9ecf-8a433853511d";
  const repoTarballUrl = "https://github.com/mrfrank-ofc/SUBZERO-BOT/tarball/main";
  
  // Combine default and extra environment variables
  let envVars = { SESSION_ID: sessionId, PREFIX: prefix, ...extraVars };

  try {
    // Create a new Heroku app
    const appResponse = await fetch(`https://api.heroku.com/apps`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${herokuApiKey}`,
        "Accept": "application/vnd.heroku+json; version=3",
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        name: "subzero-bot-" + Date.now(),
        stack: "container"
      })
    });
    const appData = await appResponse.json();
    
    // Trigger a build using the source blob (which points to the GitHub tarball)
    const buildResponse = await fetch(`https://api.heroku.com/apps/${appData.name}/builds`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${herokuApiKey}`,
        "Accept": "application/vnd.heroku+json; version=3",
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        source_blob: {
          url: repoTarballUrl,
          version: "main"
        }
      })
    });
    const buildData = await buildResponse.json();
    
    // Save bot info to MongoDB (linking it to the Firebase user uid)
    const newBot = new Bot({
      name: appData.name,
      owner: req.user.uid,
      envVariables: envVars,
    });
    await newBot.save();

    res.json({ message: "Bot deployed and build triggered!", bot: appData, build: buildData });
  } catch (error) {
    console.error("Deployment error:", error);
    res.status(500).json({ error: "Deployment failed" });
  }
});

// Route: Get User's Bots
app.get('/deploy/my-bots', verifyFirebaseToken, async (req, res) => {
  try {
    const bots = await Bot.find({ owner: req.user.uid });
    res.json(bots);
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch bots" });
  }
});

// Route: Get Logs for a Specific Bot using Log Sessions
app.get('/logs', verifyFirebaseToken, async (req, res) => {
  const botName = req.query.bot;
  if (!botName) return res.status(400).json({ error: "Bot name required" });

  const herokuApiKey = "HRKU-243b6c53-b708-440c-9ecf-8a433853511d";
  
  try {
    // Create a log session to get a logplex URL
    const logSessionResponse = await fetch(`https://api.heroku.com/apps/${botName}/log-sessions`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${herokuApiKey}`,
        "Accept": "application/vnd.heroku+json; version=3",
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        dyno: "",         // Optionally specify a dyno
        lines: 100,       // Number of log lines to retrieve
        source: "app",    // Log source (can be "app", "heroku", etc.)
        tail: false       // For continuous streaming, a different approach is needed
      })
    });
    const logSessionData = await logSessionResponse.json();
    
    if (!logSessionData.logplex_url) {
      return res.status(500).json({ error: "Failed to create log session" });
    }
    
    // Retrieve the logs from the logplex URL
    const logsResponse = await fetch(logSessionData.logplex_url);
    const logs = await logsResponse.text();
    res.json({ logs });
  } catch (error) {
    console.error("Logs error:", error);
    res.status(500).json({ error: "Failed to fetch logs" });
  }
});

// Fallback: Serve index.html for unknown routes (for client-side routing)
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/index.html'));
});

// Start the server (Heroku provides process.env.PORT)
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
