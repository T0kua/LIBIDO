const API_URL = "http://localhost:5000";

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
        alert("Ошибка входа");
        return;
    }

    localStorage.setItem("token", data.access_token);
    localStorage.setItem("username", username);

    // Переход в чат
    window.location.href = "main.html";
}

async function register() {
    const username = document.getElementById("usernameInput").value.trim();
    const password = document.getElementById("passwordInput").value.trim();

    const response = await fetch(`${API_URL}/register`, {
        method: "POST",
        headers: {
            "Content-Type": "application/json"
        },
        body: JSON.stringify({ username, password })
    });

    const data = await response.json();

    if (!response.ok) {
        alert(data.msg);
    } else {
        alert("Регистрация успешна");
    }
}

// ============================
// СОБЫТИЯ
// ============================

const loginBtn = document.getElementById("loginBtn");
const registerBtn = document.getElementById("registerBtn");

if (loginBtn) loginBtn.addEventListener("click", login);
if (registerBtn) registerBtn.addEventListener("click", register);