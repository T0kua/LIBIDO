const API_URL = "http://localhost:5000";

const token = localStorage.getItem("token");
const username = localStorage.getItem("username");
let privateKey = null;

let sentMessagesCache = {};

try {
    const savedCache = localStorage.getItem('sentMessagesCache');
    if (savedCache) {
        sentMessagesCache = JSON.parse(savedCache);
    }
} catch (e) {
    console.warn('Failed to load sent messages cache', e);
}

if (!token || !username) {
    window.location.href = "index.html";
}

// ============================
// HEARTBEAT
// ============================
async function sendHeartbeat() {
    try {
        await fetch(`${API_URL}/heartbeat`, {
            method: "POST",
            headers: { Authorization: "Bearer " + token }
        });
    } catch (error) {
        console.error("Heartbeat error:", error);
    }
}
setInterval(sendHeartbeat, 5000);
sendHeartbeat();

// ============================
// ЗАГРУЗКА ПРИВАТНОГО КЛЮЧА
// ============================
async function loadPrivateKey() {
    const privateKeyBase64 = localStorage.getItem('privateKey');
    if (!privateKeyBase64) return null;

    try {
        const privateKeyData = Uint8Array.from(atob(privateKeyBase64), c => c.charCodeAt(0));
        privateKey = await crypto.subtle.importKey(
            "pkcs8",
            privateKeyData,
            {
                name: "RSA-OAEP",
                hash: "SHA-256",
            },
            true,
            ["decrypt"]
        );
        return privateKey;
    } catch (error) {
        console.error("Ошибка загрузки приватного ключа:", error);
        return null;
    }
}

// ============================
// ВСПОМОГАТЕЛЬНАЯ: ArrayBuffer → Base64 (без spread)
// ============================
function arrayBufferToBase64(buffer) {
    let binary = '';
    const bytes = new Uint8Array(buffer);
    const len = bytes.byteLength;
    for (let i = 0; i < len; i++) {
        binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
}

// ============================
// ШИФРОВАНИЕ/ДЕШИФРОВАНИЕ ТЕКСТА
// ============================
async function encryptMessage(text, recipientPublicKeyBase64) {
    try {
        const publicKeyData = Uint8Array.from(atob(recipientPublicKeyBase64), c => c.charCodeAt(0));
        const publicKey = await crypto.subtle.importKey(
            "spki",
            publicKeyData,
            {
                name: "RSA-OAEP",
                hash: "SHA-256",
            },
            true,
            ["encrypt"]
        );
        const encodedText = new TextEncoder().encode(text);
        const encryptedData = await crypto.subtle.encrypt(
            { name: "RSA-OAEP" },
            publicKey,
            encodedText
        );
        return arrayBufferToBase64(encryptedData);
    } catch (error) {
        console.error("Ошибка шифрования:", error);
        throw new Error("Не удалось зашифровать сообщение");
    }
}

async function decryptMessage(encryptedBase64) {
    if (!privateKey) return null;
    try {
        const encryptedData = Uint8Array.from(atob(encryptedBase64), c => c.charCodeAt(0));
        const decryptedData = await crypto.subtle.decrypt(
            { name: "RSA-OAEP" },
            privateKey,
            encryptedData
        );
        return new TextDecoder().decode(decryptedData);
    } catch (error) {
        console.error("Ошибка дешифрования:", error);
        return null;
    }
}

// ============================
// ГИБРИДНОЕ ШИФРОВАНИЕ ДЛЯ ФАЙЛОВ
// ============================

// Генерация AES ключа
async function generateAESKey() {
    return await crypto.subtle.generateKey(
        {
            name: "AES-GCM",
            length: 256
        },
        true,
        ["encrypt", "decrypt"]
    );
}

// Экспорт AES ключа в raw
async function exportAESKey(key) {
    const exported = await crypto.subtle.exportKey("raw", key);
    return new Uint8Array(exported);
}

// Импорт AES ключа из raw
async function importAESKey(rawKey) {
    return await crypto.subtle.importKey(
        "raw",
        rawKey,
        { name: "AES-GCM" },
        true,
        ["decrypt"]
    );
}

// Шифрование файла с помощью AES-GCM
async function encryptFile(fileBuffer, aesKey) {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const encrypted = await crypto.subtle.encrypt(
        {
            name: "AES-GCM",
            iv: iv
        },
        aesKey,
        fileBuffer
    );
    return {
        ciphertext: new Uint8Array(encrypted),
        iv: iv
    };
}

// Расшифровка файла
async function decryptFile(encryptedBuffer, aesKey, iv) {
    const decrypted = await crypto.subtle.decrypt(
        {
            name: "AES-GCM",
            iv: iv
        },
        aesKey,
        encryptedBuffer
    );
    return new Uint8Array(decrypted);
}

// ============================
// ПОЛУЧЕНИЕ ПУБЛИЧНОГО КЛЮЧА
// ============================
async function getPublicKey(username) {
    const response = await fetch(`${API_URL}/public_key/${username}`, {
        headers: { Authorization: "Bearer " + token }
    });
    const data = await response.json();
    if (!response.ok) {
        throw new Error(data.error || "Failed to get public key");
    }
    return data.public_key;
}

// ============================
// КЭШИРОВАНИЕ ОТПРАВЛЕННЫХ СООБЩЕНИЙ
// ============================
function saveSentMessage(chatUsername, messageId, plainText) {
    if (!sentMessagesCache[chatUsername]) {
        sentMessagesCache[chatUsername] = {};
    }
    sentMessagesCache[chatUsername][messageId] = plainText;
    localStorage.setItem('sentMessagesCache', JSON.stringify(sentMessagesCache));
}

function getSentMessage(chatUsername, messageId) {
    return sentMessagesCache[chatUsername]?.[messageId];
}

// ============================
// ЭЛЕМЕНТЫ DOM
// ============================
const chatList = document.getElementById("chatList");
const messagesContainer = document.getElementById("messages");
const userDisplay = document.getElementById("userDisplay");
const sendBtn = document.getElementById("sendBtn");
const messageInput = document.getElementById("messageInput");
const searchInput = document.getElementById("searchUser");
const fileInput = document.getElementById("fileInput");
const sendImageBtn = document.getElementById("sendImageBtn");

let currentChat = null;
let chatElements = new Map();

// ============================
// ИНИЦИАЛИЗАЦИЯ
// ============================
window.onload = async () => {
    await loadPrivateKey();

    const params = new URLSearchParams(window.location.search);
    currentChat = params.get("chat");

    setupUserPanel();
    await loadChats();
    loadMessages();

    setInterval(loadChats, 2000);
    setInterval(loadMessages, 2000);

    if (searchInput) {
        searchInput.addEventListener("keypress", (e) => {
            if (e.key === "Enter") {
                const searchUsername = searchInput.value.trim();
                if (searchUsername) {
                    window.location.href = `main.html?chat=${searchUsername}`;
                }
            }
        });
    }

    if (sendImageBtn) {
        sendImageBtn.addEventListener("click", () => {
            fileInput.click();
        });
    }

    if (fileInput) {
        fileInput.addEventListener("change", (e) => {
            const file = e.target.files[0];
            if (file) {
                sendImage(file);
                fileInput.value = "";
            }
        });
    }
};

function setupUserPanel() {
    userDisplay.innerHTML = "";

    const name = document.createElement("div");
    name.textContent = username;
    name.style.cursor = "pointer";
    name.onclick = () => {
        const link = `${window.location.protocol}//${window.location.host}/main.html?chat=${username}`;
        navigator.clipboard.writeText(link);
        alert("Ссылка скопирована:\n" + link);
    };

    const logout = document.createElement("button");
    logout.textContent = "Выйти";
    logout.style.marginTop = "10px";
    logout.onclick = () => {
        localStorage.removeItem('token');
        localStorage.removeItem('username');
        window.location.href = "index.html";
    };

    userDisplay.appendChild(name);
    userDisplay.appendChild(logout);
}

// ============================
// ЗАГРУЗКА СПИСКА ЧАТОВ
// ============================
async function loadChats() {
    try {
        const res = await fetch(`${API_URL}/chats`, {
            headers: { Authorization: "Bearer " + token }
        });

        if (!res.ok) throw new Error("Failed to load chats");

        const chats = await res.json();

        const statusPromises = chats.map(chat => getOnlineStatus(chat.user));
        const statuses = await Promise.all(statusPromises);

        const newChatsMap = new Map();
        chats.forEach((chat, index) => {
            newChatsMap.set(chat.user, {
                unread: chat.unread,
                online: statuses[index]
            });
        });

        for (let [username, element] of chatElements.entries()) {
            if (!newChatsMap.has(username) && username !== currentChat) {
                element.div.remove();
                chatElements.delete(username);
            }
        }

        for (let [username, data] of newChatsMap.entries()) {
            if (chatElements.has(username)) {
                updateChatItem(username, data.unread, data.online);
            } else {
                createChatItem(username, data.unread, data.online);
            }
        }
    } catch (error) {
        console.error("Error loading chats:", error);
    }
}

function getOnlineStatus(username) {
    return fetch(`${API_URL}/status/${username}`, {
        headers: { Authorization: "Bearer " + token }
    })
        .then(res => res.json())
        .then(data => data.online)
        .catch(() => false);
}

function createChatItem(username, unreadCount, online) {
    const div = document.createElement("div");
    div.className = "chat-item";
    div.dataset.username = username;

    const nameContainer = document.createElement("div");
    nameContainer.style.display = "flex";
    nameContainer.style.alignItems = "center";
    nameContainer.style.gap = "8px";

    const indicator = document.createElement("span");
    indicator.className = `online-indicator ${online ? "online" : "offline"}`;

    const name = document.createElement("span");
    name.textContent = username;

    nameContainer.appendChild(indicator);
    nameContainer.appendChild(name);

    div.appendChild(nameContainer);

    const badge = document.createElement("span");
    badge.className = "badge";
    badge.textContent = unreadCount;
    if (unreadCount === 0 || username === currentChat) {
        badge.style.display = "none";
    }
    div.appendChild(badge);

    div.onclick = () => {
        window.location.href = `main.html?chat=${username}`;
    };

    chatList.appendChild(div);

    chatElements.set(username, {
        div: div,
        badge: badge,
        indicator: indicator
    });
}

function updateChatItem(username, unreadCount, online) {
    const element = chatElements.get(username);
    if (!element) return;

    element.indicator.className = `online-indicator ${online ? "online" : "offline"}`;

    if (unreadCount > 0 && username !== currentChat) {
        element.badge.textContent = unreadCount;
        element.badge.style.display = "inline";
    } else {
        element.badge.style.display = "none";
    }
}

// ============================
// ЗАГРУЗКА СООБЩЕНИЙ
// ============================
let lastMessageCount = 0;

async function loadMessages() {
    if (!currentChat) return;

    try {
        const res = await fetch(`${API_URL}/messages/${currentChat}`, {
            headers: { Authorization: "Bearer " + token }
        });

        if (!res.ok) throw new Error("Failed to load messages");

        const messages = await res.json();

        if (currentChat !== username) {
            await fetch(`${API_URL}/read_all/${currentChat}`, {
                method: "POST",
                headers: { Authorization: "Bearer " + token }
            });
        }

        if (messages.length === lastMessageCount) return;

        const isAtBottom = messagesContainer.scrollHeight - messagesContainer.scrollTop <= messagesContainer.clientHeight + 50;

        messagesContainer.innerHTML = "";

        for (const msg of messages) {
            const div = document.createElement("div");
            div.className = "message";

            const isOwn = msg.sender === username;
            if (isOwn) {
                div.classList.add("own");
            }

            let displayContent = "";

            if (msg.type === "text") {
                let text = "[Ошибка дешифрации]";
                if (isOwn) {
                    const cachedText = getSentMessage(currentChat, msg.id);
                    if (cachedText) {
                        text = cachedText;
                    } else {
                        const decrypted = await decryptMessage(msg.ciphertext);
                        text = decrypted || "[Не удалось расшифровать своё сообщение]";
                    }
                } else {
                    const decrypted = await decryptMessage(msg.ciphertext);
                    text = decrypted || "[Не удалось расшифровать]";
                }
                displayContent = `<div>${text}</div>`;
            } else if (msg.type === "image") {
                // Для чужих сообщений расшифровываем и показываем изображение
                if (!isOwn) {
                    try {
                        const encryptedKey = Uint8Array.from(atob(msg.encrypted_key), c => c.charCodeAt(0));
                        const iv = Uint8Array.from(atob(msg.iv), c => c.charCodeAt(0));
                        const ciphertext = Uint8Array.from(atob(msg.ciphertext), c => c.charCodeAt(0));

                        const aesKeyRaw = await crypto.subtle.decrypt(
                            { name: "RSA-OAEP" },
                            privateKey,
                            encryptedKey
                        );
                        const aesKey = await importAESKey(new Uint8Array(aesKeyRaw));

                        const decryptedFile = await decryptFile(ciphertext, aesKey, iv);

                        const blob = new Blob([decryptedFile], { type: msg.mime_type });
                        const url = URL.createObjectURL(blob);
                        displayContent = `<img src="${url}" style="max-width: 200px; max-height: 200px;" onclick="window.open('${url}')">`;
                    } catch (e) {
                        console.error("Error decrypting image:", e);
                        displayContent = `<div>[Ошибка расшифровки изображения]</div>`;
                    }
                } else {
                    // Свои изображения: показываем заглушку, так как Blob URL уже был показан при отправке
                    displayContent = `<div>[Отправленное изображение]</div>`;
                }
            }

            div.innerHTML = `
                ${displayContent}
                <div class="time">${msg.time || ''}</div>
            `;

            messagesContainer.appendChild(div);
        }

        if (isAtBottom) {
            messagesContainer.scrollTop = messagesContainer.scrollHeight;
        }

        lastMessageCount = messages.length;
    } catch (error) {
        console.error("Error loading messages:", error);
    }
}

// ============================
// ОТПРАВКА ТЕКСТОВОГО СООБЩЕНИЯ
// ============================
async function sendMessage() {
    const text = messageInput.value.trim();
    if (!text || !currentChat) return;

    try {
        const publicKey = await getPublicKey(currentChat);
        const encryptedText = await encryptMessage(text, publicKey);

        const response = await fetch(`${API_URL}/message`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Authorization: "Bearer " + token
            },
            body: JSON.stringify({
                receiver: currentChat,
                type: "text",
                ciphertext: encryptedText
            })
        });

        if (!response.ok) {
            const error = await response.json();
            alert("Ошибка: " + (error.msg || error.error));
            return;
        }

        const data = await response.json();
        const messageId = data.id;

        saveSentMessage(currentChat, messageId, text);

        messageInput.value = "";
        loadMessages();
    } catch (error) {
        console.error("Ошибка отправки:", error);
        alert("Не удалось отправить сообщение: " + error.message);
    }
}

// ============================
// ОТПРАВКА ИЗОБРАЖЕНИЯ (с проверкой размера и безопасным base64)
// ============================
async function sendImage(file) {
    if (!currentChat) {
        alert("Выберите чат");
        return;
    }

    const maxSize = 10 * 1024 * 1024; // 10 MB
    if (file.size > maxSize) {
        alert("Файл слишком большой. Максимальный размер: 10 МБ");
        return;
    }

    try {
        const publicKeyBase64 = await getPublicKey(currentChat);
        const publicKeyData = Uint8Array.from(atob(publicKeyBase64), c => c.charCodeAt(0));
        const publicKey = await crypto.subtle.importKey(
            "spki",
            publicKeyData,
            { name: "RSA-OAEP", hash: "SHA-256" },
            true,
            ["encrypt"]
        );

        const aesKey = await generateAESKey();
        const fileBuffer = await file.arrayBuffer();
        const { ciphertext, iv } = await encryptFile(fileBuffer, aesKey);

        const aesRaw = await exportAESKey(aesKey);
        const encryptedAesKey = await crypto.subtle.encrypt(
            { name: "RSA-OAEP" },
            publicKey,
            aesRaw
        );

        // Безопасное преобразование в base64
        const ciphertextBase64 = arrayBufferToBase64(ciphertext);
        const encryptedKeyBase64 = arrayBufferToBase64(new Uint8Array(encryptedAesKey));
        const ivBase64 = arrayBufferToBase64(iv);

        const payload = {
            receiver: currentChat,
            type: "image",
            ciphertext: ciphertextBase64,
            encrypted_key: encryptedKeyBase64,
            iv: ivBase64,
            mime_type: file.type || "application/octet-stream"
        };

        const response = await fetch(`${API_URL}/message`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Authorization: "Bearer " + token
            },
            body: JSON.stringify(payload)
        });

        if (!response.ok) {
            const error = await response.json();
            alert("Ошибка: " + (error.msg || error.error));
            return;
        }

        const data = await response.json();
        const messageId = data.id;

        // Создаём Blob URL для мгновенного отображения
        const blobUrl = URL.createObjectURL(file);
        saveSentMessage(currentChat, messageId, blobUrl); // сохраняем для возможного использования (не обязательно)

        // Создаём элемент сообщения и вставляем
        const messageDiv = document.createElement("div");
        messageDiv.className = "message own";
        messageDiv.innerHTML = `
            <img src="${blobUrl}" style="max-width: 200px; max-height: 200px;">
            <div class="time">${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</div>
        `;
        messagesContainer.appendChild(messageDiv);
        messagesContainer.scrollTop = messagesContainer.scrollHeight;

    } catch (error) {
        console.error("Ошибка отправки изображения:", error);
        alert("Не удалось отправить изображение: " + error.message);
    }
}

// ============================
// ОБРАБОТЧИКИ
// ============================
sendBtn.onclick = sendMessage;
messageInput.addEventListener("keypress", e => {
    if (e.key === "Enter") sendMessage();
});