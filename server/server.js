import express from "express";
import fetch from "node-fetch";
import dotenv from "dotenv";
import path from "path";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;
const herokuApiKey = "HRKU-243b6c53-b708-440c-9ecf-8a433853511d";

app.use(express.json());
app.use(express.static("public"));

// Helper: Generate a random Heroku app name.
function generateRandomAppName() {
  return "subzero-" + Math.random().toString(36).substring(2, 10);
}

// Function to check build status before scaling dynos
async function waitForBuildCompletion(appName, buildId) {
  console.log(`Waiting for build ${buildId} to complete...`);
  let buildStatus = "pending";
  while (buildStatus === "pending") {
    await new Promise(resolve => setTimeout(resolve, 5000)); // Wait 5 seconds before checking again

    const buildResp = await fetch(`https://api.heroku.com/apps/${appName}/builds/${buildId}`, {
      method: "GET",
      headers: {
        "Authorization": `Bearer ${herokuApiKey}`,
        "Accept": "application/vnd.heroku+json; version=3"
      }
    });

    if (buildResp.ok) {
      const buildData = await buildResp.json();
      buildStatus = buildData.status;
      console.log(`Build status: ${buildStatus}`);
    } else {
      console.error(`Failed to fetch build status.`);
      break;
    }
  }

  return buildStatus === "succeeded";
}

// Function to scale web dynos after deployment
async function scaleDynos(appName) {
  console.log(`Scaling dynos for ${appName}...`);
  const scaleResp = await fetch(`https://api.heroku.com/apps/${appName}/formation`, {
    method: "PATCH",
    headers: {
      "Authorization": `Bearer ${herokuApiKey}`,
      "Accept": "application/vnd.heroku+json; version=3",
      "Content-Type": "application/json"
    },
    body: JSON.stringify([{ process: "web", quantity: 1, size: "standard-1X" }]) // Adjust dyno size if needed
  });

  if (scaleResp.ok) {
    console.log(`Dynos scaled successfully.`);
  } else {
    const txt = await scaleResp.text();
    console.error(`Error scaling dynos: ${txt}`);
  }
}

// Function to deploy and start the app
app.post("/deploy", async (req, res) => {
  const { envVars } = req.body;
  const botName = generateRandomAppName();

  try {
    // Create a Heroku app
    const createResp = await fetch("https://api.heroku.com/apps", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${herokuApiKey}`,
        "Accept": "application/vnd.heroku+json; version=3",
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ name: botName })
    });

    if (!createResp.ok) {
      const txt = await createResp.text();
      throw new Error(`Error creating app: ${txt}`);
    }
    await createResp.json();

    // Prepare and set config vars
    const configObj = {};
    envVars.forEach(v => { configObj[v.key] = v.value; });

    await fetch(`https://api.heroku.com/apps/${botName}/config-vars`, {
      method: "PATCH",
      headers: {
        "Authorization": `Bearer ${herokuApiKey}`,
        "Accept": "application/vnd.heroku+json; version=3",
        "Content-Type": "application/json"
      },
      body: JSON.stringify(configObj)
    });

    // Trigger build
    const buildResp = await fetch(`https://api.heroku.com/apps/${botName}/builds`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${herokuApiKey}`,
        "Accept": "application/vnd.heroku+json; version=3",
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        source_blob: {
          url: "https://github.com/mrfrank-ofc/SUBZERO-BOT/archive/main.tar.gz"
        }
      })
    });

    if (!buildResp.ok) {
      const txt = await buildResp.text();
      throw new Error(`Error triggering build: ${txt}`);
    }
    const buildData = await buildResp.json();

    // Wait for build to complete
    const buildSuccess = await waitForBuildCompletion(botName, buildData.id);
    if (buildSuccess) {
      await scaleDynos(botName);
      return res.json({ message: "Deployment complete", botName });
    } else {
      return res.status(500).json({ error: "Build failed" });
    }
  } catch (error) {
    console.error("Deploy Error:", error);
    return res.status(500).json({ error: error.toString() });
  }
});

// Get logs from a deployed app
app.get("/logs/:botName", async (req, res) => {
  const botName = req.params.botName;

  try {
    // Create a log session
    const logSessionResponse = await fetch(`https://api.heroku.com/apps/${botName}/log-sessions`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${herokuApiKey}`,
        "Accept": "application/vnd.heroku+json; version=3",
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        dyno: "",
        lines: 100,
        source: "app",
        tail: false
      })
    });

    const logSessionData = await logSessionResponse.json();
    if (!logSessionData.logplex_url) {
      return res.status(500).json({ error: "Failed to create log session" });
    }

    // Retrieve logs
    const logsResponse = await fetch(logSessionData.logplex_url);
    const logs = await logsResponse.text();
    res.json({ logs });
  } catch (error) {
    console.error("Logs error:", error);
    res.status(500).json({ error: "Failed to fetch logs" });
  }
});

// Serve index.html for unknown routes (for client-side routing)
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/index.html'));
});

// Start the server
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
