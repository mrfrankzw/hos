// Ensure user is logged in; if not, redirect to login.html
firebase.auth().onAuthStateChanged(user => {
  if (!user) {
    window.location.href = "login.html";
  }
});

// Navigation: Show only the specified section
function showSection(sectionId) {
  document.getElementById("deploySection").style.display = "none";
  document.getElementById("myBotsSection").style.display = "none";
  document.getElementById("logsSection").style.display = "none";
  document.getElementById(sectionId).style.display = "block";
}

// Logout function
function logout() {
  firebase.auth().signOut().then(() => {
    window.location.href = "index.html";
  });
}

// Add extra environment variable input fields
document.getElementById("addVarButton").addEventListener("click", () => {
  const container = document.getElementById("extraVarsContainer");
  const div = document.createElement("div");
  div.innerHTML = '<input type="text" placeholder="Variable Name" class="extraVarName" style="width:45%; margin-right:5%;">' +
                  '<input type="text" placeholder="Value" class="extraVarValue" style="width:45%;">';
  container.appendChild(div);
});

// Deploy Bot form submission
document.getElementById("deployForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const sessionId = document.getElementById("sessionId").value;
  const prefix = document.getElementById("prefix").value;
  let extraVars = {};
  document.querySelectorAll("#extraVarsContainer div").forEach(div => {
    const name = div.querySelector(".extraVarName").value;
    const value = div.querySelector(".extraVarValue").value;
    if (name) extraVars[name] = value;
  });
  const user = firebase.auth().currentUser;
  const idToken = await user.getIdToken();
  const response = await fetch("/deploy", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": "Bearer " + idToken
    },
    body: JSON.stringify({ sessionId, prefix, extraVars })
  });
  const data = await response.json();
  document.getElementById("deployMessage").innerText = data.message;
  loadMyBots();
});

// Load My Bots into the section and dropdown for logs
async function loadMyBots() {
  const user = firebase.auth().currentUser;
  const idToken = await user.getIdToken();
  const response = await fetch("/deploy/my-bots", {
    headers: { "Authorization": "Bearer " + idToken }
  });
  const bots = await response.json();
  const botsList = document.getElementById("botsList");
  botsList.innerHTML = "";
  const botSelect = document.getElementById("botSelect");
  botSelect.innerHTML = '<option value="">Select a bot</option>';
  bots.forEach(bot => {
    const div = document.createElement("div");
    div.innerHTML = `<strong>${bot.name}</strong> - Deployed on ${new Date(bot.createdAt).toLocaleString()}`;
    botsList.appendChild(div);
    const option = document.createElement("option");
    option.value = bot.name;
    option.text = bot.name;
    botSelect.appendChild(option);
  });
}

// Fetch logs for the selected bot
document.getElementById("fetchLogsButton").addEventListener("click", async () => {
  const botName = document.getElementById("botSelect").value;
  if (!botName) {
    alert("Please select a bot.");
    return;
  }
  const user = firebase.auth().currentUser;
  const idToken = await user.getIdToken();
  const response = await fetch(`/logs?bot=${botName}`, {
    headers: { "Authorization": "Bearer " + idToken }
  });
  const data = await response.json();
  document.getElementById("logsOutput").innerText = data.logs || "No logs available.";
});

// Load bots on page load
firebase.auth().onAuthStateChanged(() => loadMyBots());
