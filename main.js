// main.js
const API_URL = "http://100.92.183.5:5000";

const token = localStorage.getItem("token");
const username = localStorage.getItem("username");

if (!token) window.location.href = "index.html";

const chatList = document.getElementById("chatList");
const messagesContainer = document.getElementById("messages");
const userDisplay = document.getElementById("userDisplay");
const sendBtn = document.getElementById("sendBtn");
const messageInput = document.getElementById("messageInput");
const searchInput = document.getElementById("searchUser");
const sendImageBtn = document.getElementById("sendImageBtn");
const fileInput = document.getElementById("fileInput");

let currentChat = null;
let lastMessageCount = 0;
let chatUsers = [];

// Функция определения мобильности (ширина < 768 ИЛИ есть touch)
function isMobileDevice() {
    return window.innerWidth <= 768 || ('ontouchstart' in window);
}

window.onload = () => {
    const params = new URLSearchParams(window.location.search);
    currentChat = params.get("chat");
    setupUserPanel();
    loadChats();
    if (currentChat) {
        loadMessages();
    }
    setInterval(sendHeartbeat, 5000);
    setInterval(pollNewMessages, 3000);
    setInterval(updateOnlineStatuses, 5000);
    updateViewForMobile();

    window.addEventListener('resize', updateViewForMobile);
};

async function fetchWithAuth(url, options = {}) {
    const res = await fetch(url, {
        ...options,
        headers: {
            ...options.headers,
            Authorization: "Bearer " + token
        }
    });
    if (res.status === 401) {
        localStorage.clear();
        window.location.href = "index.html";
        throw new Error("Unauthorized");
    }
    return res;
}

function copyTextToClipboard(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).catch(err => {
            console.error('Ошибка clipboard API:', err);
            fallbackCopy(text);
        });
    } else {
        fallbackCopy(text);
    }
}

function fallbackCopy(text) {
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    document.body.appendChild(textarea);
    textarea.select();
    try {
        document.execCommand('copy');
        alert('Ссылка скопирована');
    } catch (err) {
        console.error('Не удалось скопировать:', err);
        alert('Не удалось скопировать ссылку. Скопируйте вручную:\n' + text);
    }
    document.body.removeChild(textarea);
}

function copyChatLink() {
    const link = window.location.href.split("?")[0] + "?chat=" + username;
    copyTextToClipboard(link);
}

function setupUserPanel() {
    userDisplay.innerHTML = "";
    const icon = document.createElement("i");
    icon.className = "fas fa-user-circle";

    const nameSpan = document.createElement("span");
    nameSpan.textContent = username;
    nameSpan.style.cursor = "pointer";
    nameSpan.onclick = copyChatLink;

    const logoutBtn = document.createElement("button");
    logoutBtn.textContent = "Выйти";
    logoutBtn.onclick = () => {
        localStorage.clear();
        window.location.href = "index.html";
    };

    userDisplay.appendChild(icon);
    userDisplay.appendChild(nameSpan);
    userDisplay.appendChild(logoutBtn);
}

async function sendHeartbeat() {
    try {
        await fetchWithAuth(`${API_URL}/heartbeat`, { method: "POST" });
    } catch (e) {}
}

async function loadChats() {
    try {
        const res = await fetchWithAuth(`${API_URL}/chats`);
        const data = await res.json();

        if (!Array.isArray(data)) {
            console.error("Ответ /chats не массив:", data);
            return;
        }

        chatList.innerHTML = "";
        chatUsers = [];

        let currentChatExists = false;
        data.forEach(chat => {
            if (chat.user === currentChat) currentChatExists = true;
            renderChatItem(chat);
            chatUsers.push(chat.user);
        });

        if (currentChat && !currentChatExists) {
            renderChatItem({ user: currentChat, unread: 0 });
            chatUsers.push(currentChat);
        }

        updateOnlineStatuses();
    } catch (e) {
        console.error("Ошибка загрузки чатов:", e);
    }
}

function renderChatItem(chat) {
    const div = document.createElement("div");
    div.className = "chat-item";
    div.dataset.username = chat.user;
    if (chat.user === currentChat) div.classList.add("active");

    const avatar = document.createElement("div");
    avatar.className = "chat-avatar";
    avatar.textContent = chat.user.charAt(0).toUpperCase();

    const indicator = document.createElement("span");
    indicator.className = "online-indicator";
    indicator.id = `status-${chat.user}`;
    avatar.appendChild(indicator);

    const info = document.createElement("div");
    info.className = "chat-info";
    info.innerHTML = `
        <div class="chat-name">${chat.user}</div>
        <div class="chat-preview">...</div>
    `;

    const meta = document.createElement("div");
    meta.className = "chat-meta";
    if (chat.unread > 0 && chat.user !== currentChat) {
        const badge = document.createElement("span");
        badge.className = "badge";
        badge.textContent = chat.unread;
        meta.appendChild(badge);
    }

    div.appendChild(avatar);
    div.appendChild(info);
    div.appendChild(meta);

    div.onclick = () => {
        console.log("Клик по чату:", chat.user);
        const url = new URL(window.location);
        url.searchParams.set('chat', chat.user);
        window.history.pushState({}, '', url);
        currentChat = chat.user;
        loadMessages();
        updateViewForMobile();
    };
    chatList.appendChild(div);
}

async function getUserStatus(targetUsername) {
    try {
        const res = await fetchWithAuth(`${API_URL}/status/${targetUsername}`);
        const data = await res.json();
        return data.online;
    } catch (e) {
        console.error("Ошибка получения статуса:", e);
        return false;
    }
}

async function updateOnlineStatuses() {
    for (const user of chatUsers) {
        const online = await getUserStatus(user);
        const indicator = document.getElementById(`status-${user}`);
        if (indicator) {
            if (online) {
                indicator.classList.add("online");
            } else {
                indicator.classList.remove("online");
            }
        }
    }
}

async function loadMessages() {
    if (!currentChat) return;
    try {
        const res = await fetchWithAuth(`${API_URL}/messages/${currentChat}`);
        const msgs = await res.json();

        if (!Array.isArray(msgs)) {
            console.error("Ответ /messages не массив:", msgs);
            return;
        }

        lastMessageCount = msgs.length;

        messagesContainer.innerHTML = "";
        msgs.forEach(msg => {
            let contentHtml = msg.ciphertext;
            let fileUrl = null;

            const imageMatch = msg.ciphertext.match(/^!\[image\]\((.*)\)$/);
            const fileMatch = msg.ciphertext.match(/^\[file\]\((.*)\)$/);

            if (imageMatch) {
                fileUrl = imageMatch[1];
                contentHtml = `<img src="${API_URL}${fileUrl}" style="max-width: 100%; max-height: 200px; border-radius: 10px;" onclick="window.open('${API_URL}${fileUrl}', '_blank')">`;
            } else if (fileMatch) {
                fileUrl = fileMatch[1];
                contentHtml = `<a href="${API_URL}${fileUrl}" target="_blank" style="color: #4a4cff;">������ Скачать файл</a>`;
            }

            const div = document.createElement("div");
            div.className = "message";
            if (msg.sender === username) div.classList.add("own");

            div.innerHTML = `
                <div>${msg.sender}: ${contentHtml}</div>
                <div class="time">${msg.time}</div>
            `;
            messagesContainer.appendChild(div);

            if (msg.sender !== username && !msg.read) {
                fetchWithAuth(`${API_URL}/read/${msg.id}`, { method: "POST" })
                    .catch(err => console.error("Ошибка отметки прочитанного:", err));
            }
        });
        messagesContainer.scrollTop = messagesContainer.scrollHeight;
    } catch (e) {
        console.error("Ошибка загрузки сообщений:", e);
    }
}

async function pollNewMessages() {
    if (!currentChat) return;
    try {
        const res = await fetchWithAuth(`${API_URL}/messages/${currentChat}`);
        const msgs = await res.json();
        if (Array.isArray(msgs) && msgs.length > lastMessageCount) {
            loadMessages();
        }
    } catch (e) {}
}

async function encryptForChat(chat, text) {
    // временно
    return text;
}

async function sendMessage() {
    const text = messageInput.value.trim();
    if (!text || !currentChat) return;

    const ciphertext = await encryptForChat(currentChat, text);

    try {
        await fetchWithAuth(`${API_URL}/message`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ receiver: currentChat, ciphertext })
        });
        messageInput.value = "";
        loadMessages();
    } catch (e) {
        console.error("Ошибка отправки:", e);
    }
}

sendBtn.onclick = sendMessage;

messageInput.addEventListener("keypress", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        sendMessage();
    }
});

if (sendImageBtn && fileInput) {
    sendImageBtn.addEventListener("click", () => {
        fileInput.click();
    });

    fileInput.addEventListener("change", async (e) => {
        const file = fileInput.files[0];
        if (!file || !currentChat) return;

        const MAX_SIZE = 1024 * 1024 * 1024; // 1 ГБ
        if (file.size > MAX_SIZE) {
            alert("Файл слишком большой. Максимальный размер 1 ГБ.");
            fileInput.value = "";
            return;
        }

        sendImageBtn.disabled = true;
        sendImageBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i>';

        const formData = new FormData();
        formData.append('file', file);

        try {
            const uploadRes = await fetchWithAuth(`${API_URL}/upload`, {
                method: 'POST',
                body: formData
            });

            if (!uploadRes.ok) {
                const err = await uploadRes.json();
                throw new Error(err.error || 'Ошибка загрузки');
            }

            const uploadData = await uploadRes.json();
            const fileUrl = uploadData.url;

            let messageText;
            if (file.type.startsWith('image/')) {
                messageText = `![image](${fileUrl})`;
            } else {
                messageText = `[file](${fileUrl})`;
            }

            const ciphertext = await encryptForChat(currentChat, messageText);
            await fetchWithAuth(`${API_URL}/message`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ receiver: currentChat, ciphertext })
            });

            loadMessages();
        } catch (error) {
            console.error("Ошибка при загрузке файла:", error);
            alert("Не удалось загрузить файл: " + error.message);
        } finally {
            fileInput.value = "";
            sendImageBtn.disabled = false;
            sendImageBtn.innerHTML = '<i class="fas fa-paperclip"></i>';
        }
    });
}

if (searchInput) {
    searchInput.addEventListener("keypress", (e) => {
        if (e.key === "Enter") {
            const query = searchInput.value.trim();
            if (query) {
                const url = new URL(window.location);
                url.searchParams.set('chat', query);
                window.history.pushState({}, '', url);
                currentChat = query;
                loadMessages();
                updateViewForMobile();
            }
        }
    });
}

function updateViewForMobile() {
    const mobile = isMobileDevice();
    console.log("updateViewForMobile, mobile:", mobile, "width:", window.innerWidth, "currentChat:", currentChat);

    if (!mobile) {
        document.body.classList.remove('chat-open');
        return;
    }

    if (currentChat) {
        document.body.classList.add('chat-open');
    } else {
        document.body.classList.remove('chat-open');
    }
}

window.addEventListener('resize', updateViewForMobile);

window.addEventListener('popstate', (event) => {
    console.log("popstate");
    const params = new URLSearchParams(window.location.search);
    currentChat = params.get('chat');
    if (!currentChat) {
        document.body.classList.remove('chat-open');
        messagesContainer.innerHTML = '';
    } else {
        loadMessages();
        updateViewForMobile();
    }
});

document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && currentChat) {
        e.preventDefault();
        console.log("Escape pressed");
        const url = new URL(window.location);
        url.searchParams.delete('chat');
        window.history.pushState({}, '', url);
        currentChat = null;
        updateViewForMobile();
        messagesContainer.innerHTML = '';
    }
});

setInterval(loadChats, 10000);