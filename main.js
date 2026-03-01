// main.js
const API_URL = "http://localhost:5000";

const token = localStorage.getItem("token");
const username = localStorage.getItem("username");

if (!token) window.location.href = "index.html";

const chatList = document.getElementById("chatList");
const messagesContainer = document.getElementById("messages");
const userDisplay = document.getElementById("userDisplay");
const sendBtn = document.getElementById("sendBtn");
const messageInput = document.getElementById("messageInput");

let currentChat = null;

window.onload = () => {
    const params = new URLSearchParams(window.location.search);
    currentChat = params.get("chat");
    setupUserPanel();
    loadChats();
    loadMessages();
    setInterval(sendHeartbeat, 5000);   // online ping
};

function setupUserPanel() {
    userDisplay.innerHTML = "";
    const name = document.createElement("div");
    name.textContent = username;
    name.style.cursor = "pointer";
    name.onclick = copyChatLink;
    userDisplay.appendChild(name);

    const logout = document.createElement("button");
    logout.textContent = "Выйти";
    logout.onclick = () => {
        localStorage.clear();
        window.location.href = "index.html";
    };
    userDisplay.appendChild(logout);
}

function copyChatLink() {
    const link = window.location.href.split("?")[0] + "?chat=" + username;
    navigator.clipboard.writeText(link);
    alert("Скопировано:\n" + link);
}

async function sendHeartbeat() {
    await fetch(`${API_URL}/heartbeat`, {
        method: "POST",
        headers: {
            Authorization: "Bearer " + token
        }
    });
}

async function loadChats() {
    const res = await fetch(`${API_URL}/chats`, {
        headers: { Authorization: "Bearer " + token }
    });
    const data = await res.json();
    chatList.innerHTML = "";
    data.forEach(chat => {
        const div = document.createElement("div");
        div.className = "chat-item";
        div.textContent = chat.user;
        if (chat.unread > 0 && chat.user !== currentChat) {
            const badge = document.createElement("span");
            badge.className = "badge";
            badge.textContent = chat.unread;
            div.appendChild(badge);
        }
        div.onclick = () => {
            window.location.href = `main.html?chat=${chat.user}`;
        };
        chatList.appendChild(div);
    });
}

async function loadMessages() {
    if (!currentChat) return;
    const res = await fetch(`${API_URL}/messages/${currentChat}`, {
        headers: { Authorization: "Bearer " + token }
    });
    const msgs = await res.json();
    messagesContainer.innerHTML = "";
    msgs.forEach(msg => {
        const div = document.createElement("div");
        div.className = "message";
        if (msg.sender === username) div.classList.add("own");

        div.innerHTML = `
            <div>${msg.sender}: ${msg.ciphertext}</div>
            <div class="time">${msg.time}</div>
        `;
        messagesContainer.appendChild(div);
        // mark read for messages received
        if (msg.sender !== username && !msg.read) {
            fetch(`${API_URL}/read/${msg.id}`, {
                method: "POST",
                headers: { Authorization: "Bearer " + token }
            });
        }
    });
}

async function sendMessage() {
    const text = messageInput.value.trim();
    if (!text || !currentChat) return;

    // FRONTEND MUST ENCRYPT text here
    const ciphertext = await encryptForChat(currentChat, text);

    await fetch(`${API_URL}/message`, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            Authorization: "Bearer " + token
        },
        body: JSON.stringify({
            receiver: currentChat,
            ciphertext
        })
    });
    messageInput.value = "";
    loadMessages();
}

sendBtn.onclick = sendMessage;
