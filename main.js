const API_URL = "http://localhost:5000";

const token = localStorage.getItem("token");
const username = localStorage.getItem("username");

if (!token) {
    // если не авторизован → назад
    window.location.href = "index.html";
}

// Отображаем логин вместо "настройки"
document.getElementById("userDisplay").textContent = username;

// DOM
const messagesContainer = document.getElementById("messages");
const messageInput = document.getElementById("messageInput");
const sendBtn = document.getElementById("sendBtn");

// ============================
// ОТПРАВКА
// ============================

async function sendMessage() {
    const text = messageInput.value.trim();
    if (!text) return;

    const response = await fetch(`${API_URL}/message`, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            "Authorization": "Bearer " + token
        },
        body: JSON.stringify({ message: text })
    });

    if (!response.ok) {
        alert("Ошибка отправки");
        return;
    }

    messageInput.value = "";
    loadMessages();
}

// ============================
// ЗАГРУЗКА
// ============================

async function loadMessages() {
    const response = await fetch(`${API_URL}/messages`, {
        headers: {
            "Authorization": "Bearer " + token
        }
    });

    if (!response.ok) return;

    const data = await response.json();
    renderMessages(data);
}

function renderMessages(messages) {
    messagesContainer.innerHTML = "";

    messages.forEach(msg => {
        const div = document.createElement("div");
        div.classList.add("message");

        const name = document.createElement("strong");
        name.textContent = msg.user + ": ";

        div.appendChild(name);
        div.appendChild(document.createTextNode(msg.text));

        messagesContainer.appendChild(div);
    });

    messagesContainer.scrollTop = messagesContainer.scrollHeight;
}

// ============================
// СОБЫТИЯ
// ============================

sendBtn.addEventListener("click", sendMessage);

messageInput.addEventListener("keydown", function (e) {
    if (e.key === "Enter") sendMessage();
});

// автообновление
setInterval(loadMessages, 2000);

// загрузка при старте
window.onload = loadMessages;