const API_URL = "http://localhost:5000";

// ============================
// ГЕНЕРАЦИЯ КЛЮЧЕЙ
// ============================

async function generateKeyPair() {
    try {
        const keyPair = await crypto.subtle.generateKey(
            {
                name: "RSA-OAEP",
                modulusLength: 2048,
                publicExponent: new Uint8Array([1, 0, 1]),
                hash: "SHA-256",
            },
            true,
            ["encrypt", "decrypt"]
        );
        
        const exportedPublicKey = await crypto.subtle.exportKey(
            "spki",
            keyPair.publicKey
        );
        
        const publicKeyBase64 = btoa(
            String.fromCharCode(...new Uint8Array(exportedPublicKey))
        );
        
        const exportedPrivateKey = await crypto.subtle.exportKey(
            "pkcs8",
            keyPair.privateKey
        );
        
        const privateKeyBase64 = btoa(
            String.fromCharCode(...new Uint8Array(exportedPrivateKey))
        );
        
        localStorage.setItem('privateKey', privateKeyBase64);
        
        return publicKeyBase64;
    } catch (error) {
        console.error("Ошибка генерации ключей:", error);
        return "temp_public_key_" + Date.now();
    }
}

// ============================
// АВТОРИЗАЦИЯ
// ============================

async function login() {
    const username = document.getElementById("usernameInput").value.trim();
    const password = document.getElementById("passwordInput").value.trim();

    if (!username || !password) {
        alert("Введите данные");
        return;
    }

    const response = await fetch(`${API_URL}/login`, {
        method: "POST",
        headers: {
            "Content-Type": "application/json"
        },
        body: JSON.stringify({ username, password })
    });

    const data = await response.json();

    if (!response.ok) {
        alert("Ошибка входа: " + (data.msg || "Неизвестная ошибка"));
        return;
    }

    localStorage.setItem("token", data.access_token);
    localStorage.setItem("username", username);
    
    if (data.public_key) {
        localStorage.setItem("publicKey", data.public_key);
    }

    window.location.href = "main.html";
}

async function register() {
    const username = document.getElementById("usernameInput").value.trim();
    const password = document.getElementById("passwordInput").value.trim();

    if (!username || !password) {
        alert("Введите данные");
        return;
    }

    const publicKey = await generateKeyPair();

    const response = await fetch(`${API_URL}/register`, {
        method: "POST",
        headers: {
            "Content-Type": "application/json"
        },
        body: JSON.stringify({ 
            username, 
            password,
            public_key: publicKey 
        })
    });

    const data = await response.json();

    if (!response.ok) {
        alert(data.msg || "Ошибка регистрации");
    } else {
        alert("Регистрация успешна");
        await login();
    }
}

// ============================
// ВЫХОД (ключи и кэш сохраняются)
// ============================

function logout() {
    // Удаляем только аутентификационные данные
    localStorage.removeItem('token');
    localStorage.removeItem('username');
    // Приватный ключ и кэш сообщений остаются для расшифровки истории
    window.location.href = "index.html";
}

// ============================
// СОБЫТИЯ
// ============================

const loginBtn = document.getElementById("loginBtn");
const registerBtn = document.getElementById("registerBtn");
const logoutBtn = document.getElementById("logoutBtn");

if (loginBtn) loginBtn.addEventListener("click", login);
if (registerBtn) registerBtn.addEventListener("click", register);
if (logoutBtn) logoutBtn.addEventListener("click", logout);