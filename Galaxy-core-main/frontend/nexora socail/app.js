"use strict";

/* ============================================
   NEXORA 4.3 — DIRECTSHARE
   FRONTEND APPLICATION
   MESSAGING + ATTACHMENTS + VOICE RECORDING
============================================ */


/* ============================================
   API CONFIGURATION
============================================ */

const CONFIG = {

  FRONTEND:
    "https://nexora.mehera1982.workers.dev",

  API:
    "https://nexoragc.mehera1982.workers.dev",

  AI:
    "https://galaxycoreai.mehera1982.workers.dev/",

  POLL_INTERVAL: 6000,

  REQUEST_TIMEOUT: 20000,

  MAX_AI_HISTORY: 24,

  MAX_ATTACHMENT_SIZE: 25 * 1024 * 1024,

  MAX_VOICE_SECONDS: 120,

  DIRECTSHARE_CHUNK_SIZE: 16 * 1024,

  SIGNAL_POLL_INTERVAL: 2500

};


/* ============================================
   DOM HELPER
============================================ */

const $ = id => document.getElementById(id);


/* ============================================
   APPLICATION STATE
============================================ */

const state = {

  token:
    sessionStorage.getItem("nexora_token") || "",

  username:
    sessionStorage.getItem("nexora_username") || "",

  inbox: [],

  activeChat: "",

  currentPage: "chats",

  aiHistory: [],

  videos: [],

  authBusy: false,

  messageBusy: false,

  aiBusy: false,

  refreshing: false,

  searchTimer: null,

  toastTimer: null,

  selectedAttachment: null,

  mediaRecorder: null,

  microphoneStream: null,

  recordedChunks: [],

  recordedVoice: null,

  recordingTimer: null,

  recordingStartedAt: 0,

  recordingDuration: 0,

  recordingObjectURL: null,

  recordingCancelled: false,

  directShare: null,

  signalPolling: false,

  receivedFiles: [],

  receivedDownloads: []

};


/* ============================================
   LOCAL STORAGE
============================================ */

function loadLocal(key, fallback) {

  try {

    const data = localStorage.getItem(key);

    if (!data) {
      return fallback;
    }

    return JSON.parse(data);

  } catch (error) {

    console.warn(
      "Local storage error:",
      error
    );

    return fallback;

  }

}


function saveLocal(key, value) {

  try {

    localStorage.setItem(
      key,
      JSON.stringify(value)
    );

  } catch (error) {

    console.warn(
      "Could not save local data:",
      error
    );

  }

}
/* ============================================
   UTILITY FUNCTIONS
============================================ */

function normalizeUsername(value) {

  return String(value || "")
    .trim()
    .toLowerCase();

}


function createElement(
  tag,
  className = "",
  text = ""
) {

  const element = document.createElement(tag);

  if (className) {

    element.className = className;

  }

  element.textContent = String(text);

  return element;

}


function clearElement(element) {

  element.replaceChildren();

}


function firstLetter(username) {

  return String(username || "?")
    .charAt(0)
    .toUpperCase();

}


function formatTime(value) {

  if (!value) {
    return "";
  }

  const text = String(value);

  const normalizedDate = text.includes("T")
    ? text
    : text.replace(" ", "T") + "Z";

  const date = new Date(normalizedDate);

  if (Number.isNaN(date.getTime())) {

    return "";

  }

  return date.toLocaleTimeString([], {

    hour: "numeric",

    minute: "2-digit"

  });

}


function formatDuration(seconds) {

  const total = Math.max(
    0,
    Math.floor(seconds)
  );

  const minutes = Math.floor(total / 60);

  const remaining = total % 60;

  return (
    String(minutes).padStart(2, "0") +
    ":" +
    String(remaining).padStart(2, "0")
  );

}


function formatFileSize(bytes) {

  if (bytes < 1024) {

    return bytes + " B";

  }

  if (bytes < 1024 * 1024) {

    return (
      (bytes / 1024).toFixed(1) +
      " KB"
    );

  }

  return (
    (bytes / (1024 * 1024)).toFixed(1) +
    " MB"
  );

}


/* ============================================
   TOAST NOTIFICATIONS
============================================ */

function showToast(message, duration = 4000) {

  const toast = $("toast");

  toast.textContent = String(message);

  toast.hidden = false;

  clearTimeout(state.toastTimer);

  state.toastTimer = setTimeout(() => {

    toast.hidden = true;

  }, duration);

}
/* ============================================
   NETWORK REQUESTS
============================================ */

async function fetchJSON(
  url,
  options = {}
) {

  const controller = new AbortController();

  const timeout = setTimeout(() => {

    controller.abort();

  }, CONFIG.REQUEST_TIMEOUT);

  try {

    const response = await fetch(url, {

      ...options,

      signal: controller.signal,

      headers: {

        "Content-Type": "application/json",

        ...(options.headers || {})

      }

    });

    const text = await response.text();

    let data = {};

    if (text) {

      try {

        data = JSON.parse(text);

      } catch {

        throw new Error(
          "Server returned invalid JSON"
        );

      }

    }

    if (!response.ok) {

      throw new Error(

        data.error ||
        data.message ||
        `Server error ${response.status}`

      );

    }

    return data;

  } catch (error) {

    if (error.name === "AbortError") {

      throw new Error(
        "Request timed out"
      );

    }

    throw error;

  } finally {

    clearTimeout(timeout);

  }

}


/* ============================================
   MESSAGING API
============================================ */

async function api(
  endpoint,
  options = {}
) {

  const headers = {

    ...(options.headers || {})

  };

  if (state.token) {

    headers.Authorization =
      "Bearer " + state.token;

  }

  try {

    return await fetchJSON(

      CONFIG.API + endpoint,

      {

        ...options,

        headers

      }

    );

  } catch (error) {

    if (
      /failed to fetch|networkerror/i.test(
        error.message
      )
    ) {

      throw new Error(

        "Cannot reach NEXORA backend. " +
        "Check the Worker's ALLOWED_ORIGIN " +
        "and CORS settings."

      );

    }

    throw error;

  }

}
/* ============================================
   AUTHENTICATION
============================================ */

function setAuthStatus(
  message,
  isError = false
) {

  const status = $("auth-status");

  status.textContent = message;

  status.style.color = isError
    ? "var(--danger)"
    : "var(--muted)";

}


/* ============================================
   AUTHENTICATION BUSY STATE
============================================ */

function setAuthBusy(busy) {

  state.authBusy = busy;

  $("login-btn").disabled = busy;

  $("register-btn").disabled = busy;

}


/* ============================================
   LOGIN AND REGISTRATION
============================================ */

async function authenticate(mode) {

  if (state.authBusy) {

    return;

  }

  const username = normalizeUsername(
    $("auth-username").value
  );

  const password =
    $("auth-password").value;

  if (
    !/^[a-z0-9_]{3,24}$/.test(username)
  ) {

    setAuthStatus(

      "Username must contain 3–24 letters, " +
      "numbers or underscores.",

      true

    );

    return;

  }

  if (password.length < 12) {

    setAuthStatus(

      "Password must contain at least " +
      "12 characters.",

      true

    );

    return;

  }

  setAuthBusy(true);

  setAuthStatus(
    mode === "register"
      ? "Creating your account..."
      : "Logging in..."
  );

  try {

    if (mode === "register") {

      await api("/register", {

        method: "POST",

        body: JSON.stringify({

          username,

          password

        })

      });

    }

    const result = await api("/login", {

      method: "POST",

      body: JSON.stringify({

        username,

        password

      })

    });

    if (
      !result.token ||
      !result.user?.username
    ) {

      throw new Error(
        "Unexpected login response"
      );

    }

    saveSession(

      result.token,

      result.user.username

    );

    $("auth-password").value = "";

    setAuthStatus("");

    showApplication();

    await refreshInbox();

  } catch (error) {

    setAuthStatus(
      error.message,
      true
    );

  } finally {

    setAuthBusy(false);

  }

}
/* ============================================
   SESSION MANAGEMENT
============================================ */

function saveSession(token, username) {

  state.token = token;

  state.username =
    normalizeUsername(username);

  sessionStorage.setItem(
    "nexora_token",
    state.token
  );

  sessionStorage.setItem(
    "nexora_username",
    state.username
  );

}


/* ============================================
   CLEAR SESSION
============================================ */

function clearSession() {

  state.token = "";

  state.username = "";

  state.activeChat = "";

  state.inbox = [];

  sessionStorage.removeItem(
    "nexora_token"
  );

  sessionStorage.removeItem(
    "nexora_username"
  );

}


/* ============================================
   SHOW AUTHENTICATION SCREEN
============================================ */

function showAuthentication() {

  $("auth-screen").hidden = false;

  $("app").hidden = true;

  $("ai-screen").hidden = true;

}


/* ============================================
   SHOW APPLICATION
============================================ */

function showApplication() {

  $("auth-screen").hidden = true;

  $("app").hidden = false;

  $("profile-username").textContent =
    "@" + state.username;

  $("profile-avatar").textContent =
    firstLetter(state.username);

  navigate("chats");

}


/* ============================================
   RESTORE LOGIN SESSION
============================================ */

async function restoreSession() {

  if (
    !state.token ||
    !state.username
  ) {

    showAuthentication();

    return;

  }

  try {

    await api("/me");

    showApplication();

    await refreshInbox();

  } catch (error) {

    if (
      /unauthor|invalid|expired|token|401/i.test(
        error.message
      )
    ) {

      clearSession();

      showAuthentication();

    } else {

      showApplication();

      showToast(
        "Connection issue: " +
        error.message
      );

    }

  }

}


/* ============================================
   LOGOUT
============================================ */

async function logout() {

  cancelRecording();

  clearAttachment();

  try {

    await api("/logout", {
      method: "POST"
    });

  } catch (error) {

    console.warn(
      "Remote logout failed:",
      error
    );

  }

  clearSession();

  showAuthentication();

  showToast(
    "You have logged out."
  );

}


/* ============================================
   PAGE NAVIGATION
============================================ */

function navigate(page) {

  const allowed = [
    "chats",
    "discover",
    "conversation",
    "videos",
    "profile"
  ];

  if (!allowed.includes(page)) {

    return;

  }

  if (
    state.currentPage === "conversation" &&
    page !== "conversation"
  ) {

    cancelRecording();

    clearAttachment();

  }

  state.currentPage = page;

  document
    .querySelectorAll(".page")
    .forEach(element => {

      element.classList.toggle(
        "active",
        element.id === page + "-page"
      );

    });

  document
    .querySelectorAll("[data-page]")
    .forEach(button => {

      button.classList.toggle(
        "selected",
        button.dataset.page === page
      );

    });

  if (page === "chats") {

    renderChatList();

  }

  if (page === "conversation") {

    renderConversation();

  }

  if (page === "videos") {

    renderVideos();

  }

  if (page === "discover") {

    $("user-search").focus();

  }

}


/* ============================================
   CONVERSATION HELPERS
============================================ */

function otherParticipant(message) {

  const sender =
    normalizeUsername(message.sender);

  const receiver =
    normalizeUsername(message.receiver);

  if (sender === state.username) {

    return receiver;

  }

  if (receiver === state.username) {

    return sender;

  }

  return "";

}


/* ============================================
   GET CONVERSATIONS
============================================ */

function getConversations() {

  const latest = new Map();

  for (const message of state.inbox) {

    const person =
      otherParticipant(message);

    if (
      person &&
      !latest.has(person)
    ) {

      latest.set(
        person,
        message
      );

    }

  }

  if (
    state.activeChat &&
    !latest.has(state.activeChat)
  ) {

    latest.set(
      state.activeChat,
      null
    );

  }

  return [...latest.entries()];

}


/* ============================================
   CHAT LIST
============================================ */

function renderChatList() {

  const container = $("chat-list");

  clearElement(container);

  const filter =
    normalizeUsername(
      $("chat-filter").value
    );

  const conversations =
    getConversations().filter(

      ([username]) =>
        username.includes(filter)

    );

  if (!conversations.length) {

    container.append(

      createElement(
        "div",
        "empty",
        "No conversations yet. " +
        "Start a new chat!"
      )

    );

    return;

  }

  for (
    const [username, message]
    of conversations
  ) {

    const button =
      createElement(
        "button",
        "chat-item"
      );

    button.type = "button";

    const avatar =
      createElement(
        "div",
        "avatar",
        firstLetter(username)
      );

    const details =
      createElement(
        "div",
        "chat-details"
      );

    const name =
      createElement(
        "strong",
        "",
        "@" + username
      );

    const preview =
      createElement(
        "p",
        "",
        message?.content ||
        "Start a conversation"
      );

    details.append(
      name,
      preview
    );

    button.append(
      avatar,
      details
    );

    if (message?.created_at) {

      const time =
        createElement(
          "time",
          "",
          formatTime(
            message.created_at
          )
        );

      button.append(time);

    }

    button.addEventListener(
      "click",
      () => openConversation(username)
    );

    container.append(button);

  }

}


/* ============================================
   OPEN CONVERSATION
============================================ */

function openConversation(username) {

  const person =
    normalizeUsername(username);

  if (
    !person ||
    person === state.username
  ) {

    return;

  }

  if (
    state.activeChat !== person
  ) {

    cancelRecording();

    clearAttachment();

  }

  state.activeChat = person;

  $("peer-name").textContent =
    "@" + person;

  $("peer-avatar").textContent =
    firstLetter(person);

  navigate("conversation");

  $("message-input").focus();

}


/* ============================================
   MESSAGE BUBBLES
============================================ */

function appendBubble(
  container,
  content,
  mine,
  time = ""
) {

  const bubble =
    createElement(
      "div",
      "bubble " +
      (mine ? "mine" : "theirs"),
      content
    );

  if (time) {

    const timestamp =
      createElement(
        "time",
        "",
        formatTime(time)
      );

    bubble.append(timestamp);

  }

  container.append(bubble);

}
/* ============================================
   NEXORA 4.3 — PART 6
   MESSAGING + ATTACHMENTS + VOICE
============================================ */


/* ============================================
   RENDER CONVERSATION
============================================ */

function renderConversation() {

  if (!state.activeChat) {
    return;
  }

  const container = $("messages");

  clearElement(container);

  const messages = state.inbox.filter(message => {

    const sender =
      normalizeUsername(message.sender);

    const receiver =
      normalizeUsername(message.receiver);

    return (
      (
        sender === state.username &&
        receiver === state.activeChat
      ) ||
      (
        sender === state.activeChat &&
        receiver === state.username
      )
    );

  }).slice().reverse();

  if (!messages.length) {

    container.append(
      createElement(
        "div",
        "empty",
        "Say hello to @" +
        state.activeChat +
        " 👋"
      )
    );

  }

  for (const message of messages) {

    appendBubble(
      container,
      message.content,
      normalizeUsername(message.sender) === state.username,
      message.created_at
    );

  }
  for (const file of state.receivedFiles) {
    if (file.peer !== state.activeChat) continue;

    const link = document.createElement("a");
    link.href = file.url;
    link.download = file.name;
    link.textContent = "Download " + file.name + " from @" + file.peer;
    link.style.display = "block";
    link.style.padding = "12px";
    link.style.margin = "8px";
    link.style.borderRadius = "10px";
    link.style.background = "var(--accent, #9d70ff)";
    link.style.color = "#fff";

    container.append(link);
  }


  container.scrollTop =
    container.scrollHeight;

}


/* ============================================
   FETCH INBOX
============================================ */

async function refreshInbox() {

  if (
    !state.token ||
    state.refreshing ||
    document.hidden
  ) {
    return;
  }

  state.refreshing = true;

  try {

    const result = await api("/inbox");

    if (!Array.isArray(result.messages)) {
      throw new Error(
        "Unexpected inbox response"
      );
    }

    state.inbox = result.messages;

    $("connection-status").textContent =
      "● Connected";

    renderChatList();

    if (
      state.currentPage === "conversation"
    ) {
      renderConversation();
    }

  } catch (error) {

    $("connection-status").textContent =
      "● Offline";

    console.warn(
      "Inbox refresh failed:",
      error
    );

  } finally {

    state.refreshing = false;

  }

}


/* ============================================
   SEND TEXT MESSAGE
============================================ */

async function sendMessage(event) {

  event.preventDefault();

  if (state.messageBusy) {
    return;
  }

  if (state.selectedAttachment) {

    await sendSelectedAttachment();
    return;

  }

  if (state.recordedVoice) {

    await sendVoiceMessage();
    return;

  }

  const input = $("message-input");

  const content = input.value.trim();

  if (
    !content ||
    !state.activeChat
  ) {
    return;
  }

  state.messageBusy = true;

  $("send-btn").disabled = true;

  try {

    await api("/send", {

      method: "POST",

      body: JSON.stringify({

        receiver: state.activeChat,

        content

      })

    });

    input.value = "";

    await refreshInbox();

    input.focus();

  } catch (error) {

    showToast(
      "Message failed: " +
      error.message,
      6000
    );

  } finally {

    state.messageBusy = false;

    $("send-btn").disabled = false;

  }

}


/* ============================================
   ATTACHMENT SELECTION
============================================ */

function openAttachmentPicker() {

  if (!state.activeChat) {

    showToast(
      "Open a conversation first."
    );

    return;

  }

  $("attachment-input").click();

}


/* ============================================
   HANDLE ATTACHMENT
============================================ */

function handleAttachmentSelection(event) {

  const file =
    event.target.files?.[0];

  if (!file) {
    return;
  }

  if (
    file.size >
    CONFIG.MAX_ATTACHMENT_SIZE
  ) {

    showToast(
      "Maximum attachment size is 25 MB."
    );

    event.target.value = "";

    return;

  }

  if (file.size === 0) {

    showToast(
      "Cannot attach an empty file."
    );

    event.target.value = "";

    return;

  }

  cancelRecording();

  state.selectedAttachment = file;

  $("attachment-name").textContent =
    "📎 " +
    file.name +
    " (" +
    formatFileSize(file.size) +
    ")";

  $("attachment-preview").hidden = false;

  showToast(
    "Attachment ready for DirectShare.",
    4000
  );

}


/* ============================================
   CLEAR ATTACHMENT
============================================ */

function clearAttachment() {

  state.selectedAttachment = null;

  $("attachment-input").value = "";

  $("attachment-name").textContent = "";

  $("attachment-preview").hidden = true;

}


/* ============================================
   SEND SELECTED ATTACHMENT
   WebRTC integration in Part 7
============================================ */

async function sendSelectedAttachment() {

  if (!state.selectedAttachment) {

    showToast(
      "Select a file first."
    );

    return;

  }

  if (!state.activeChat) {

    showToast(
      "Open a conversation first."
    );

    return;

  }

  if (
    typeof sendDirectShareFile !== "function"
  ) {

    showToast(
      "DirectShare is not initialized."
    );

    return;

  }

  const file = state.selectedAttachment;

  try {

    showToast(
      "Connecting to recipient...",
      4000
    );

    await sendDirectShareFile(
      state.activeChat,
      file
    );

    // Attachment retained until transfer confirmation.

  } catch (error) {

    showToast(
      "File transfer failed: " +
      error.message,
      6000
    );

  }

}


/* ============================================
   MICROPHONE HELPERS
============================================ */

function stopMicrophoneTracks() {

  if (state.microphoneStream) {

    for (
      const track of
      state.microphoneStream.getTracks()
    ) {

      track.stop();

    }

    state.microphoneStream = null;

  }

}


/* ============================================
   STOP RECORDING TIMER
============================================ */

function stopRecordingTimer() {

  if (state.recordingTimer) {

    clearInterval(
      state.recordingTimer
    );

    state.recordingTimer = null;

  }

}


/* ============================================
   CLEAR RECORDING PREVIEW
============================================ */

function clearRecordingPreview() {

  if (state.recordingObjectURL) {

    URL.revokeObjectURL(
      state.recordingObjectURL
    );

    state.recordingObjectURL = null;

  }

  const audio = $("voice-preview");

  audio.pause();

  audio.removeAttribute("src");

  audio.load();

  audio.hidden = true;

}


/* ============================================
   START VOICE RECORDING
============================================ */

async function startRecording() {

  if (!state.activeChat) {

    showToast(
      "Open a conversation first."
    );

    return;

  }

  if (
    !navigator.mediaDevices?.getUserMedia ||
    typeof MediaRecorder === "undefined"
  ) {

    showToast(
      "Voice recording is not supported " +
      "by this browser."
    );

    return;

  }

  if (
    state.mediaRecorder &&
    state.mediaRecorder.state === "recording"
  ) {

    showToast(
      "Recording is already in progress."
    );

    return;

  }

  clearAttachment();

  cancelRecording();

  state.recordingCancelled = false;

  try {

    const stream =
      await navigator.mediaDevices.getUserMedia({
        audio: true
      });

    state.microphoneStream = stream;

    let mimeType = "";

    const candidates = [
      "audio/webm;codecs=opus",
      "audio/webm",
      "audio/mp4"
    ];

    for (const candidate of candidates) {

      if (
        MediaRecorder.isTypeSupported(candidate)
      ) {

        mimeType = candidate;
        break;

      }

    }

    const recorder = mimeType
      ? new MediaRecorder(stream, {
          mimeType
        })
      : new MediaRecorder(stream);

    state.mediaRecorder = recorder;

    state.recordedChunks = [];

    state.recordedVoice = null;

    state.recordingDuration = 0;

    clearRecordingPreview();

    recorder.addEventListener(
      "dataavailable",
      event => {

        if (
          event.data &&
          event.data.size > 0
        ) {

          state.recordedChunks.push(
            event.data
          );

        }

      }
    );

    recorder.addEventListener(
      "stop",
      () => {

        stopRecordingTimer();

        stopMicrophoneTracks();

        if (state.recordingCancelled) {

          state.recordedChunks = [];
          return;

        }

        const blob = new Blob(
          state.recordedChunks,
          {
            type:
              recorder.mimeType ||
              "audio/webm"
          }
        );

        state.recordedChunks = [];

        if (!blob.size) {

          showToast(
            "No audio was recorded."
          );

          cancelRecording();

          return;

        }

        state.recordedVoice = blob;

        state.recordingObjectURL =
          URL.createObjectURL(blob);

        const audio =
          $("voice-preview");

        audio.src =
          state.recordingObjectURL;

        audio.hidden = false;

        $("recording-status").textContent =
          "✅ Recording ready";

        $("stop-recording-btn").disabled =
          true;

        $("send-voice-btn").disabled =
          false;

      }
    );

    recorder.start(250);

    state.recordingStartedAt =
      Date.now();

    $("voice-panel").hidden = false;

    $("recording-status").textContent =
      "🔴 Recording...";

    $("recording-timer").textContent =
      "00:00";

    $("stop-recording-btn").disabled =
      false;

    $("send-voice-btn").disabled =
      true;

    state.recordingTimer = setInterval(
      () => {

        const seconds = Math.floor(
          (
            Date.now() -
            state.recordingStartedAt
          ) / 1000
        );

        state.recordingDuration =
          seconds;

        $("recording-timer").textContent =
          formatDuration(seconds);

        if (
          seconds >=
          CONFIG.MAX_VOICE_SECONDS
        ) {

          stopRecording();

        }

      },
      250
    );

  } catch (error) {

    stopMicrophoneTracks();

    $("voice-panel").hidden = true;

    showToast(
      "Microphone unavailable: " +
      error.message,
      6000
    );

  }

}


/* ============================================
   STOP VOICE RECORDING
============================================ */

function stopRecording() {

  const recorder =
    state.mediaRecorder;

  if (
    !recorder ||
    recorder.state !== "recording"
  ) {
    return;
  }

  state.recordingDuration =
    Math.floor(
      (
        Date.now() -
        state.recordingStartedAt
      ) / 1000
    );

  $("recording-timer").textContent =
    formatDuration(
      state.recordingDuration
    );

  $("recording-status").textContent =
    "Processing recording...";

  $("stop-recording-btn").disabled =
    true;

  stopRecordingTimer();

  recorder.stop();

}


/* ============================================
   CANCEL VOICE RECORDING
============================================ */

function cancelRecording() {

  state.recordingCancelled = true;

  stopRecordingTimer();

  if (
    state.mediaRecorder &&
    state.mediaRecorder.state !== "inactive"
  ) {

    try {

      state.mediaRecorder.stop();

    } catch (error) {

      console.warn(
        "Recorder stop error:",
        error
      );

    }

  }

  stopMicrophoneTracks();

  state.mediaRecorder = null;

  state.recordedChunks = [];

  state.recordedVoice = null;

  state.recordingDuration = 0;

  clearRecordingPreview();

  $("voice-panel").hidden = true;

  $("recording-status").textContent =
    "🎤 Ready to record";

  $("recording-timer").textContent =
    "00:00";

  $("stop-recording-btn").disabled =
    false;

  $("send-voice-btn").disabled =
    true;

}


/* ============================================
   SEND VOICE MESSAGE
   USING WEBRTC DIRECTSHARE
============================================ */

async function sendVoiceMessage() {

  if (!state.recordedVoice) {

    showToast(
      "Record a voice message first."
    );

    return;

  }

  if (!state.activeChat) {

    showToast(
      "Open a conversation first."
    );

    return;

  }

  if (
    typeof sendDirectShareFile !== "function"
  ) {

    showToast(
      "DirectShare is not initialized."
    );

    return;

  }

  const blob = state.recordedVoice;

  const extension =
    blob.type.includes("mp4")
      ? "m4a"
      : "webm";

  const filename =
    "NEXORA-Voice-" +
    Date.now() +
    "." +
    extension;

  const file = new File(
    [blob],
    filename,
    {
      type:
        blob.type ||
        "audio/webm"
    }
  );

  try {

    $("send-voice-btn").disabled =
      true;

    showToast(
      "Sending voice message...",
      4000
    );

    await sendDirectShareFile(
      state.activeChat,
      file
    );

    showToast("Voice transfer started. Waiting for confirmation.", 6000);

  } catch (error) {

    $("send-voice-btn").disabled =
      false;

    showToast(
      "Voice message failed: " +
      error.message,
      6000
    );

  }

}


/* ============================================
   END OF PART 6
============================================ */
/* ============================================
   NEXORA 4.3 — PART 7
   WEBRTC DIRECTSHARE ENGINE
============================================ */


/* ============================================
   WEBRTC CONFIGURATION
============================================ */

const DIRECTSHARE_ICE = {

  iceServers: [

    {
      urls: "stun:stun.l.google.com:19302"
    },

    {
      urls: "stun:stun1.l.google.com:19302"
    }

  ]

};


/* ============================================
   CLOSE DIRECTSHARE CONNECTION
============================================ */

function closeDirectShare() {

  const share = state.directShare;

  if (!share) {
    return;
  }

  state.directShare = null;

  clearTimeout(share.timeout);
  if (share.voice) {
    const voiceButton = $("send-voice-btn");
    if (voiceButton) voiceButton.disabled = false;
  }

  try {
    share.channel?.close();
  } catch (error) {
    console.warn(error);
  }

  try {
    share.pc.close();
  } catch (error) {
    console.warn(error);
  }

}


/* ============================================
   SEND WEBRTC SIGNAL
============================================ */

async function sendSignal(
  receiver,
  type,
  payload
) {

  return api("/webrtc/signal", {

    method: "POST",

    body: JSON.stringify({

      receiver,

      type,

      payload

    })

  });

}


/* ============================================
   ATTACH WEBRTC DATA CHANNEL
============================================ */

function attachDirectShareChannel(
  share,
  channel
) {

  share.channel = channel;

  channel.binaryType = "arraybuffer";

  channel.bufferedAmountLowThreshold =
    256 * 1024;

  channel.onopen = async () => {

    clearTimeout(share.timeout);

    showToast(
      "🔗 Connected to @" + share.peer
    );

    if (
      share.file &&
      state.directShare === share
    ) {

      try {

        await transmitDirectShare(share);

      } catch (error) {

        showToast(
          "Transfer failed: " +
          error.message,
          6000
        );

        closeDirectShare();

      }

    }

  };

  channel.onmessage = event => {

    if (state.directShare !== share) {
      return;
    }

    try {

      receiveDirectShare(
        share,
        event.data
      );

    } catch (error) {

      showToast(
        "Incoming file rejected: " +
        error.message,
        6000
      );

      closeDirectShare();

    }

  };

  channel.onclose = () => {

    if (state.directShare === share) {

      closeDirectShare();

    }

  };

}


/* ============================================
   CREATE WEBRTC CONNECTION
============================================ */

function createDirectShare(
  peer,
  file = null,
  voice = false
) {

  closeDirectShare();

  const pc = new RTCPeerConnection(
    DIRECTSHARE_ICE
  );

  const share = {

    peer,

    pc,

    channel: null,

    file,

    voice,

    candidates: [],

    receiving: null,

    timeout: null

  };

  share.timeout = setTimeout(() => {

    if (state.directShare === share) {

      showToast(
        "DirectShare timed out. " +
        "Both users must be online.",
        6000
      );

      closeDirectShare();

    }

  }, 90000);

  state.directShare = share;

  pc.onicecandidate = event => {

    if (
      event.candidate &&
      state.directShare === share
    ) {

      sendSignal(
        peer,
        "candidate",
        {
          candidate:
            event.candidate.toJSON()
        }
      ).catch(error => {

        console.warn(
          "ICE signal failed:",
          error
        );

      });

    }

  };

  pc.onconnectionstatechange = () => {

    if (state.directShare !== share) {
      return;
    }

    if (
      ["failed", "closed"].includes(
        pc.connectionState
      )
    ) {

      showToast(
        "DirectShare connection ended."
      );

      closeDirectShare();

    }

  };

  pc.ondatachannel = event => {

    attachDirectShareChannel(
      share,
      event.channel
    );

  };

  return share;

}


/* ============================================
   START DIRECTSHARE FILE TRANSFER
============================================ */

async function sendDirectShare(
  file,
  voice = false
) {

  if (
    !state.token ||
    !state.activeChat
  ) {

    throw new Error(
      "Open a conversation first."
    );

  }

  if (
    typeof RTCPeerConnection ===
    "undefined"
  ) {

    throw new Error(
      "WebRTC is not supported by this browser."
    );

  }

  if (
    !file ||
    !file.size ||
    file.size > CONFIG.MAX_ATTACHMENT_SIZE
  ) {

    throw new Error(
      "Files must be between 1 byte and 25 MB."
    );

  }

  if (state.directShare) {

    throw new Error(
      "Finish the current transfer first."
    );

  }

  try {

    const share = createDirectShare(
      state.activeChat,
      file,
      voice
    );

    const channel =
      share.pc.createDataChannel(
        "nexora-directshare",
        {
          ordered: true
        }
      );

    attachDirectShareChannel(
      share,
      channel
    );

    const offer =
      await share.pc.createOffer();

    await share.pc.setLocalDescription(
      offer
    );

    await sendSignal(
      share.peer,
      "offer",
      {

        sdp:
          share.pc.localDescription.sdp,

        type: "offer",

        purpose: "file"

      }
    );

    showToast(
      "📡 Connecting to @" +
      share.peer +
      "… Keep both apps open.",
      6000
    );

  } catch (error) {

    closeDirectShare();

    throw error;

  }

}


/* ============================================
   PART 6 COMPATIBILITY
============================================ */

async function sendDirectShareFile(
  recipient,
  file
) {

  if (
    normalizeUsername(recipient) !==
    state.activeChat
  ) {

    throw new Error(
      "Recipient does not match active chat."
    );

  }

  return sendDirectShare(
    file,
    file.type.startsWith("audio/")
  );

}


/* ============================================
   WAIT FOR DATA CHANNEL BUFFER
============================================ */

function waitForChannelBuffer(channel) {

  if (
    channel.readyState !== "open"
  ) {

    return Promise.reject(
      new Error("Connection closed")
    );

  }

  if (
    channel.bufferedAmount <=
    512 * 1024
  ) {

    return Promise.resolve();

  }

  return new Promise(
    (resolve, reject) => {

      const timer = setTimeout(() => {

        channel.removeEventListener(
          "bufferedamountlow",
          ready
        );

        reject(
          new Error("Transfer stalled")
        );

      }, 30000);

      function ready() {

        clearTimeout(timer);

        channel.removeEventListener(
          "bufferedamountlow",
          ready
        );

        resolve();

      }

      channel.addEventListener(
        "bufferedamountlow",
        ready
      );

    }
  );

}


/* ============================================
   TRANSMIT FILE OVER WEBRTC
============================================ */

async function transmitDirectShare(share) {

  const file = share.file;

  const channel = share.channel;

  channel.send(
    JSON.stringify({

      kind: "file-start",

      name:
        file.name.slice(0, 180),

      type:
        file.type ||
        "application/octet-stream",

      size: file.size

    })
  );

  let offset = 0;

  while (offset < file.size) {

    if (
      state.directShare !== share ||
      channel.readyState !== "open"
    ) {

      throw new Error(
        "Connection lost"
      );

    }

    await waitForChannelBuffer(
      channel
    );

    const bytes =
      await file.slice(
        offset,
        offset +
        CONFIG.DIRECTSHARE_CHUNK_SIZE
      ).arrayBuffer();

    channel.send(bytes);

    offset += bytes.byteLength;

  }

  await waitForChannelBuffer(
    channel
  );

  channel.send(
    JSON.stringify({
      kind: "file-end"
    })
  );

  share.timeout = setTimeout(() => {
    if (state.directShare !== share) return;
    showToast("Transfer unconfirmed: receiver did not acknowledge.", 6000);
    closeDirectShare();
  }, 30000);

  showToast("Waiting for receiver confirmation...", 6000);

}


/* ============================================
   RECEIVE DIRECTSHARE FILE
============================================ */

function receiveDirectShare(
  share,
  data
) {

  if (typeof data === "string") {

    const message = JSON.parse(data);

    if (message.kind === "file-ack") {
      if (share.file) {
        clearTimeout(share.timeout);
        if (state.selectedAttachment === share.file) {
          clearAttachment();
        }
        if (share.voice) {
          if (state.recordedVoice && share.file && share.file.size === state.recordedVoice.size && share.file.type === state.recordedVoice.type) {
            cancelRecording();
          }
          $("send-voice-btn").disabled = false;
        }
        showToast((share.voice ? "Voice message" : "File") + " received by @" + share.peer, 6000);
        setTimeout(() => {
          if (state.directShare === share) closeDirectShare();
        }, 1000);
      }
      return;
    }

    if (
      message.kind === "file-start"
    ) {

      if (share.receiving) {

        throw new Error(
          "Another file is in progress"
        );

      }

      if (
        !Number.isSafeInteger(
          message.size
        ) ||
        message.size < 1 ||
        message.size >
        CONFIG.MAX_ATTACHMENT_SIZE
      ) {

        throw new Error(
          "Invalid file size"
        );

      }

      share.receiving = {

        name:
          String(
            message.name || "download"
          ).slice(0, 180),

        type:
          String(
            message.type ||
            "application/octet-stream"
          ).slice(0, 120),

        size: message.size,

        received: 0,

        chunks: []

      };

      showToast(
        "📥 Receiving " +
        share.receiving.name +
        "…"
      );

    } else if (
      message.kind === "file-end"
    ) {

      const item = share.receiving;

      if (
        !item ||
        item.received !== item.size
      ) {

        throw new Error(
          "Incomplete transfer"
        );

      }

      const blob = new Blob(
        item.chunks,
        {
          type: item.type
        }
      );

      const url =
        URL.createObjectURL(blob);

      state.receivedDownloads.push(url);

      state.receivedFiles.push({
        name: item.name,
        peer: share.peer,
        url: url
      });

      const anchor =
        document.createElement("a");

      anchor.href = url;

      anchor.download = item.name;

      anchor.textContent =
        "⬇ Download " +
        item.name +
        " from @" +
        share.peer;

      anchor.style.display = "block";

      anchor.style.padding = "12px";

      anchor.style.margin = "8px";

      anchor.style.borderRadius = "10px";

      anchor.style.background =
        "var(--accent, #9d70ff)";

      anchor.style.color = "#fff";

      const notice =
        document.createElement("div");

      notice.append(anchor);

      const messages = $("messages");

      if (
        state.activeChat === share.peer &&
        messages
      ) {

        messages.append(notice);

        messages.scrollTop =
          messages.scrollHeight;

      } else {

        anchor.click();

      }

      showToast(
        "✅ File received from @" +
        share.peer +
        ". Save it now!",
        6000
      );

      share.channel.send(JSON.stringify({ kind: "file-ack" }));

      share.receiving = null;

      setTimeout(() => {

        if (
          state.directShare === share
        ) {

          closeDirectShare();

        }

      }, 3000);

    }

    return;

  }

  const item = share.receiving;

  if (!item) {

    throw new Error(
      "Unexpected file data"
    );

  }

  const bytes =
    data instanceof ArrayBuffer
      ? data
      : null;

  if (
    !bytes ||
    item.received +
    bytes.byteLength >
    item.size
  ) {

    throw new Error(
      "File exceeds declared size"
    );

  }

  item.chunks.push(bytes);

  item.received += bytes.byteLength;

}


/* ============================================
   HANDLE INCOMING WEBRTC SIGNAL
============================================ */

async function handleDirectShareSignal(
  signal
) {

  const peer =
    normalizeUsername(
      signal.sender
    );

  const payload =
    signal.payload || {};

  if (
    !peer ||
    peer === state.username
  ) {

    return;

  }

  if (
    signal.type === "offer"
  ) {

    if (
      state.directShare ||
      typeof payload.sdp !== "string" ||
      payload.type !== "offer"
    ) {

      return;

    }

    if (
      !window.confirm(
        "@" +
        peer +
        " wants to share a file. Connect?"
      )
    ) {

      return;

    }

    const share =
      createDirectShare(peer);

    await share.pc.setRemoteDescription({

      type: "offer",

      sdp: payload.sdp

    });

    const answer =
      await share.pc.createAnswer();

    await share.pc.setLocalDescription(
      answer
    );

    await sendSignal(
      peer,
      "answer",
      {

        type: "answer",

        sdp:
          share.pc.localDescription.sdp

      }
    );

    await flushDirectShareCandidates(
      share
    );

    showToast(
      "Waiting for @" +
      peer +
      " to send the file…"
    );

  } else if (
    signal.type === "answer"
  ) {

    const share =
      state.directShare;

    if (
      !share ||
      share.peer !== peer ||
      share.pc.signalingState !==
      "have-local-offer"
    ) {

      return;

    }

    if (
      payload.type !== "answer" ||
      typeof payload.sdp !== "string"
    ) {

      return;

    }

    await share.pc.setRemoteDescription({

      type: "answer",

      sdp: payload.sdp

    });

    await flushDirectShareCandidates(
      share
    );

  } else if (
    signal.type === "candidate"
  ) {

    const share =
      state.directShare;

    if (
      !share ||
      share.peer !== peer ||
      !payload.candidate
    ) {

      return;

    }

    if (
      share.pc.remoteDescription
    ) {

      await share.pc.addIceCandidate(
        payload.candidate
      );

    } else {

      share.candidates.push(
        payload.candidate
      );

    }

  } else if (
    signal.type === "hangup"
  ) {

    if (
      state.directShare?.peer === peer
    ) {

      closeDirectShare();

    }

  }

}


/* ============================================
   APPLY PENDING ICE CANDIDATES
============================================ */

async function flushDirectShareCandidates(
  share
) {

  for (
    const candidate of
    share.candidates.splice(0)
  ) {

    await share.pc.addIceCandidate(
      candidate
    );

  }

}


/* ============================================
   POLL WEBRTC SIGNALS
============================================ */

async function pollDirectShareSignals() {

  if (
    !state.token ||
    state.signalPolling ||
    document.hidden
  ) {

    return;

  }

  state.signalPolling = true;

  try {

    const result =
      await api("/webrtc/signals");

    for (
      const signal of
      result.signals || []
    ) {

      try {

        await handleDirectShareSignal(
          signal
        );

      } catch (error) {

        console.warn(
          "DirectShare signal error:",
          error
        );

        if (
          signal.type === "offer"
        ) {

          closeDirectShare();

        }

      } finally {

        try {

          await api(
            "/webrtc/ack",
            {

              method: "POST",

              body: JSON.stringify({

                signal_id: signal.id

              })

            }
          );

        } catch (error) {

          console.warn(
            "Signal acknowledgement failed:",
            error
          );

        }

      }

    }

  } catch (error) {

    console.warn(
      "DirectShare polling failed:",
      error
    );

  } finally {

    state.signalPolling = false;

  }

}


/* ============================================
   START SIGNAL POLLING
============================================ */

setInterval(

  pollDirectShareSignals,

  CONFIG.SIGNAL_POLL_INTERVAL

);
/* ============================================
   NEXORA 4.3 — PART 8
   USER SEARCH + AI + VIDEOS + THEMES
============================================ */


/* ============================================
   SEARCH USERS
============================================ */

async function searchUsers() {

  const query =
    normalizeUsername(
      $("user-search").value
    );

  const container =
    $("search-results");

  clearElement(container);

  if (query.length < 2) {

    container.append(
      createElement(
        "div",
        "empty",
        "Enter at least two characters."
      )
    );

    return;

  }

  container.append(
    createElement(
      "div",
      "empty",
      "Searching..."
    )
  );

  try {

    const result = await api(
      "/users?q=" +
      encodeURIComponent(query)
    );

    if (
      normalizeUsername(
        $("user-search").value
      ) !== query
    ) {

      return;

    }

    clearElement(container);

    const users =
      Array.isArray(result.users)
        ? result.users
        : [];

    const names = users
      .map(user =>
        normalizeUsername(
          typeof user === "string"
            ? user
            : user.username
        )
      )
      .filter(username =>
        username &&
        username !== state.username
      );

    if (!names.length) {

      container.append(
        createElement(
          "div",
          "empty",
          "No matching users found."
        )
      );

      return;

    }

    for (const username of names) {

      const button =
        createElement(
          "button",
          "chat-item"
        );

      button.type = "button";

      const avatar =
        createElement(
          "div",
          "avatar",
          firstLetter(username)
        );

      const label =
        createElement(
          "strong",
          "",
          "@" + username
        );

      button.append(
        avatar,
        label
      );

      button.addEventListener(
        "click",
        () => openConversation(username)
      );

      container.append(button);

    }

  } catch (error) {

    clearElement(container);

    container.append(
      createElement(
        "div",
        "empty",
        error.message
      )
    );

  }

}


/* ============================================
   RESTORE GALAXY AI HISTORY
============================================ */

function restoreAIHistory() {

  const saved =
    loadLocal(
      "nexora_ai_history",
      []
    );

  if (!Array.isArray(saved)) {

    state.aiHistory = [];

    return;

  }

  state.aiHistory = saved
    .filter(message =>
      message &&
      (
        message.role === "user" ||
        message.role === "assistant"
      ) &&
      typeof message.content === "string"
    )
    .slice(
      -CONFIG.MAX_AI_HISTORY
    );

}


/* ============================================
   RENDER GALAXY AI
============================================ */

function renderAI() {

  const container =
    $("ai-messages");

  clearElement(container);

  if (!state.aiHistory.length) {

    container.append(
      createElement(
        "div",
        "empty",
        "🌌 Welcome to Galaxy AI! " +
        "Ask me anything."
      )
    );

  }

  for (const message of state.aiHistory) {

    appendBubble(
      container,
      message.content,
      message.role === "user"
    );

  }

  container.scrollTop =
    container.scrollHeight;

}


/* ============================================
   EXTRACT AI RESPONSE
============================================ */

function extractAIResponse(data) {

  if (typeof data === "string") {

    return data;

  }

  if (
    !data ||
    typeof data !== "object"
  ) {

    return "";

  }

  const possibleReplies = [

    data.reply,

    data.response,

    data.answer,

    data.text,

    data.output,

    data.message,

    data.result?.reply,

    data.result?.response,

    data.choices?.[0]?.message?.content

  ];

  return possibleReplies.find(
    value =>
      typeof value === "string" &&
      value.trim()
  ) || "";

}


/* ============================================
   SEND GALAXY AI MESSAGE
============================================ */

async function sendAIMessage(event) {

  event.preventDefault();

  if (state.aiBusy) {

    return;

  }

  const input =
    $("ai-input");

  const content =
    input.value.trim();

  if (!content) {

    return;

  }

  state.aiHistory.push({

    role: "user",

    content

  });

  state.aiHistory =
    state.aiHistory.slice(
      -CONFIG.MAX_AI_HISTORY
    );

  saveLocal(
    "nexora_ai_history",
    state.aiHistory
  );

  input.value = "";

  renderAI();

  state.aiBusy = true;

  $("ai-send-btn").disabled = true;

  try {

    const result =
      await fetchJSON(
        CONFIG.AI,
        {
          method: "POST",

          body: JSON.stringify({
            messages:
              state.aiHistory
          })
        }
      );

    const reply =
      extractAIResponse(result);

    if (!reply) {

      throw new Error(
        "AI returned an unrecognized " +
        "response format."
      );

    }

    state.aiHistory.push({

      role: "assistant",

      content: reply

    });

    state.aiHistory =
      state.aiHistory.slice(
        -CONFIG.MAX_AI_HISTORY
      );

    saveLocal(
      "nexora_ai_history",
      state.aiHistory
    );

    renderAI();

  } catch (error) {

    appendBubble(
      $("ai-messages"),
      "Galaxy AI connection error: " +
      error.message,
      false
    );

  } finally {

    state.aiBusy = false;

    $("ai-send-btn").disabled = false;

    input.focus();

  }

}


/* ============================================
   OPEN GALAXY AI
============================================ */

function openAI() {

  $("ai-screen").hidden = false;

  renderAI();

  $("ai-input").focus();

}


/* ============================================
   CLOSE GALAXY AI
============================================ */

function closeAI() {

  $("ai-screen").hidden = true;

}


/* ============================================
   CLEAR GALAXY AI HISTORY
============================================ */

function clearAI() {

  state.aiHistory = [];

  saveLocal(
    "nexora_ai_history",
    []
  );

  renderAI();

  showToast(
    "AI conversation cleared."
  );

}


/* ============================================
   EXTRACT YOUTUBE VIDEO ID
============================================ */

function getYouTubeID(text) {

  try {

    const url = new URL(text);

    const hostname =
      url.hostname.toLowerCase();

    let id = "";

    if (
      hostname === "youtu.be"
    ) {

      id =
        url.pathname.split("/")[1] || "";

    } else if (

      [
        "youtube.com",
        "www.youtube.com",
        "m.youtube.com"
      ].includes(hostname)

    ) {

      id =
        url.searchParams.get("v") || "";

      if (!id) {

        const parts =
          url.pathname.split("/");

        if (
          [
            "shorts",
            "embed",
            "live"
          ].includes(parts[1])
        ) {

          id = parts[2] || "";

        }

      }

    }

    return /^[a-zA-Z0-9_-]{11}$/.test(id)
      ? id
      : "";

  } catch {

    return "";

  }

}


/* ============================================
   ADD VIDEO
============================================ */

function addVideo(event) {

  event.preventDefault();

  const input =
    $("video-url");

  const id =
    getYouTubeID(
      input.value.trim()
    );

  if (!id) {

    showToast(
      "Enter a valid YouTube URL."
    );

    return;

  }

  state.videos = [

    id,

    ...state.videos.filter(
      video => video !== id
    )

  ].slice(0, 30);

  saveLocal(
    "nexora_videos",
    state.videos
  );

  input.value = "";

  renderVideos();

}


/* ============================================
   RENDER VIDEOS
============================================ */

function renderVideos() {

  const container =
    $("video-list");

  clearElement(container);

  if (!state.videos.length) {

    container.append(
      createElement(
        "div",
        "empty",
        "No videos saved yet."
      )
    );

    return;

  }

  for (const id of state.videos) {

    if (
      !/^[a-zA-Z0-9_-]{11}$/.test(id)
    ) {

      continue;

    }

    const card =
      createElement(
        "div",
        "video-card"
      );

    const iframe =
      document.createElement("iframe");

    iframe.src =
      "https://www.youtube-nocookie.com/embed/" +
      id;

    iframe.title =
      "YouTube video";

    iframe.loading =
      "lazy";

    iframe.allowFullscreen =
      true;

    const remove =
      createElement(
        "button",
        "btn secondary",
        "Remove"
      );

    remove.type = "button";

    remove.addEventListener(
      "click",
      () => {

        state.videos =
          state.videos.filter(
            video => video !== id
          );

        saveLocal(
          "nexora_videos",
          state.videos
        );

        renderVideos();

      }
    );

    card.append(
      iframe,
      remove
    );

    container.append(card);

  }

}


/* ============================================
   THEME SETTINGS
============================================ */

function setTheme(theme) {

  const themes = {

    purple: [
      "#9d70ff",
      "#38dbea"
    ],

    cyan: [
      "#38dbea",
      "#9d70ff"
    ],

    pink: [
      "#ff7ec9",
      "#87bfff"
    ]

  };

  const colors =
    themes[theme] ||
    themes.purple;

  document.documentElement.style.setProperty(
    "--accent",
    colors[0]
  );

  document.documentElement.style.setProperty(
    "--accent-secondary",
    colors[1]
  );

  localStorage.setItem(
    "nexora_theme",
    theme
  );

}
/* ============================================
   NEXORA 4.3 — PART 9
   EVENTS + INITIALIZATION
============================================ */


/* ============================================
   REGISTER EVENT LISTENERS
============================================ */

function registerEvents() {

  /* AUTHENTICATION */

  $("login-btn").addEventListener(
    "click",
    () => authenticate("login")
  );

  $("register-btn").addEventListener(
    "click",
    () => authenticate("register")
  );

  $("auth-password").addEventListener(
    "keydown",
    event => {

      if (event.key === "Enter") {
        authenticate("login");
      }

    }
  );


  /* NAVIGATION */

  $("home-btn").addEventListener(
    "click",
    () => navigate("chats")
  );

  $("refresh-btn").addEventListener(
    "click",
    refreshInbox
  );

  $("new-chat-btn").addEventListener(
    "click",
    () => navigate("discover")
  );

  $("start-chat-btn").addEventListener(
    "click",
    () => navigate("discover")
  );

  $("back-btn").addEventListener(
    "click",
    () => navigate("chats")
  );

  $("chat-refresh-btn").addEventListener(
    "click",
    refreshInbox
  );


  /* CHAT FILTER */

  $("chat-filter").addEventListener(
    "input",
    renderChatList
  );


  /* USER SEARCH */

  $("user-search").addEventListener(
    "input",
    () => {

      clearTimeout(state.searchTimer);

      state.searchTimer = setTimeout(
        searchUsers,
        300
      );

    }
  );


  /* TEXT MESSAGING */

  $("message-form").addEventListener(
    "submit",
    sendMessage
  );


  /* ATTACHMENTS */

  $("attach-btn").addEventListener(
    "click",
    openAttachmentPicker
  );

  $("attachment-input").addEventListener(
    "change",
    handleAttachmentSelection
  );

  $("remove-attachment-btn").addEventListener(
    "click",
    clearAttachment
  );


  /* VOICE RECORDING */

  $("voice-btn").addEventListener(
    "click",
    startRecording
  );

  $("stop-recording-btn").addEventListener(
    "click",
    stopRecording
  );

  $("cancel-recording-btn").addEventListener(
    "click",
    cancelRecording
  );

  $("send-voice-btn").addEventListener(
    "click",
    sendVoiceMessage
  );


  /* VIDEOS */

  $("video-form").addEventListener(
    "submit",
    addVideo
  );


  /* PROFILE */

  $("logout-btn").addEventListener(
    "click",
    logout
  );


  /* GALAXY AI */

  $("open-ai-btn").addEventListener(
    "click",
    openAI
  );

  $("close-ai-btn").addEventListener(
    "click",
    closeAI
  );

  $("clear-ai-btn").addEventListener(
    "click",
    clearAI
  );

  $("ai-form").addEventListener(
    "submit",
    sendAIMessage
  );


  /* THEME SETTINGS */

  $("theme-select").addEventListener(
    "change",
    event => {

      setTheme(
        event.target.value
      );

    }
  );


  /* PAGE NAVIGATION BUTTONS */

  document
    .querySelectorAll("[data-page]")
    .forEach(button => {

      button.addEventListener(
        "click",
        () => navigate(
          button.dataset.page
        )
      );

    });


  /* KEYBOARD SHORTCUTS */

  document.addEventListener(
    "keydown",
    event => {

      if (event.key === "Escape") {

        if (!$("ai-screen").hidden) {

          closeAI();

        } else if (
          state.currentPage ===
          "conversation"
        ) {

          navigate("chats");

        }

      }

    }
  );


  /* RESTORE CONNECTION WHEN TAB REOPENS */

  document.addEventListener(
    "visibilitychange",
    () => {

      if (
        !document.hidden &&
        state.token
      ) {

        refreshInbox();

        pollDirectShareSignals();

      }

    }
  );


  /* CLEAN UP ON PAGE EXIT */

  window.addEventListener(
    "pagehide",
    () => {

      closeDirectShare();

      stopMicrophoneTracks();

    }
  );

}


/* ============================================
   SERVICE WORKER REGISTRATION
============================================ */

function registerServiceWorker() {

  if (!("serviceWorker" in navigator)) {
    return;
  }

  window.addEventListener(
    "load",
    async () => {

      try {

        await navigator.serviceWorker.register(
          "./service-worker.js"
        );

      } catch (error) {

        console.warn(
          "Service worker error:",
          error
        );

      }

    }
  );

}


/* ============================================
   INITIALIZE APPLICATION
============================================ */

async function initialize() {

  restoreAIHistory();

  const savedVideos =
    loadLocal(
      "nexora_videos",
      []
    );

  state.videos =
    Array.isArray(savedVideos)
      ? savedVideos
      : [];

  const savedTheme =
    localStorage.getItem(
      "nexora_theme"
    ) || "purple";

  $("theme-select").value =
    savedTheme;

  setTheme(savedTheme);

  registerEvents();

  registerServiceWorker();

  renderAI();

  renderVideos();

  await restoreSession();

  if (state.token) {

    pollDirectShareSignals();

  }

}


/* ============================================
   MESSAGE POLLING
============================================ */

setInterval(
  () => {

    if (state.token) {

      refreshInbox();

    }

  },
  CONFIG.POLL_INTERVAL
);


/* ============================================
   START NEXORA
============================================ */

initialize();
