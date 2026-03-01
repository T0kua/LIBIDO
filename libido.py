# libido.py
from flask import Flask, request, jsonify, send_from_directory
from flask_cors import CORS
from flask_jwt_extended import (
    JWTManager, create_access_token,
    jwt_required, get_jwt_identity
)
from sqlalchemy import (
    create_engine, Column, Integer, String,
    Boolean, DateTime, Text, Index
)
from sqlalchemy.orm import declarative_base, sessionmaker
from werkzeug.security import generate_password_hash, check_password_hash
from werkzeug.utils import secure_filename
import redis
import os
from datetime import datetime, timedelta
from dotenv import load_dotenv
import time
import threading

load_dotenv()

# ========================
# CONFIGURATION
# ========================

app = Flask(__name__)

app.config["JWT_SECRET_KEY"] = os.getenv("JWT_SECRET_KEY", "super-secret-key")

# Allow only frontend origin (from env or default)
FRONTEND_URL = os.getenv("FRONTEND_URL", "http://localhost:5500")
CORS(app, origins=[FRONTEND_URL], supports_credentials=True)

# PostgreSQL database URL (env)
DATABASE_URL = os.getenv(
    "DATABASE_URL",
    "postgresql://postgres:password@localhost:5432/libido_db"
)

engine = create_engine(
    DATABASE_URL,
    pool_size=20,
    max_overflow=0,
    pool_pre_ping=True
)

Base = declarative_base()
Session = sessionmaker(bind=engine)

jwt = JWTManager(app)

# Redis for online status and unread counters
redis_client = redis.Redis(
    host=os.getenv("REDIS_HOST", "localhost"),
    port=int(os.getenv("REDIS_PORT", "6379"))
)

# ========================
# FILE UPLOAD SETTINGS
# ========================

UPLOAD_FOLDER = 'uploads'
ALLOWED_EXTENSIONS = {'png', 'jpg', 'jpeg', 'gif', 'webp', 'mp4', 'mov', 'mp3', 'pdf', 'doc', 'docx', 'txt'}
MAX_CONTENT_LENGTH = 1024 * 1024 * 1024  # 1 GB

os.makedirs(UPLOAD_FOLDER, exist_ok=True)
app.config['UPLOAD_FOLDER'] = UPLOAD_FOLDER
app.config['MAX_CONTENT_LENGTH'] = MAX_CONTENT_LENGTH

def allowed_file(filename):
    return '.' in filename and filename.rsplit('.', 1)[1].lower() in ALLOWED_EXTENSIONS

def clean_old_files():
    """Удаляет файлы старше 20 дней из папки uploads."""
    now = time.time()
    cutoff = now - 20 * 24 * 3600  # 20 дней в секундах
    for filename in os.listdir(UPLOAD_FOLDER):
        filepath = os.path.join(UPLOAD_FOLDER, filename)
        if os.path.isfile(filepath):
            file_mtime = os.path.getmtime(filepath)
            if file_mtime < cutoff:
                try:
                    os.remove(filepath)
                    print(f"Удалён старый файл: {filename}")
                except Exception as e:
                    print(f"Ошибка удаления {filename}: {e}")

# Запускаем очистку при старте (можно также вызывать по расписанию)
clean_old_files()

# =========================
# DATABASE MODELS
# =========================

class User(Base):
    __tablename__ = "users"
    id = Column(Integer, primary_key=True)
    username = Column(String, unique=True)
    password = Column(String)
    public_key = Column(Text, nullable=True)
    last_seen = Column(DateTime, default=datetime.utcnow)


class Message(Base):
    __tablename__ = "messages"
    id = Column(Integer, primary_key=True)
    sender = Column(String)
    receiver = Column(String)
    ciphertext = Column(Text)
    timestamp = Column(DateTime)
    read = Column(Boolean, default=False)


Base.metadata.create_all(engine)

# Add indexes for performance
Index('idx_sender_receiver', Message.sender, Message.receiver)


# =========================
# UTILS
# =========================

def update_online(username: str):
    redis_client.set(f"online:{username}", "1", ex=15)


# =========================
# AUTH ROUTES
# =========================

@app.route("/register", methods=["POST"])
def register():
    with Session() as session:
        data = request.json
        if session.query(User).filter_by(username=data["username"]).first():
            return jsonify({"msg": "User exists"}), 400

        hashed = generate_password_hash(data["password"])
        user = User(
            username=data["username"],
            password=hashed,
            public_key=data.get("public_key")
        )
        session.add(user)
        session.commit()
        return jsonify({"msg": "Registered"})


@app.route("/login", methods=["POST"])
def login():
    with Session() as session:
        data = request.json
        user = session.query(User).filter_by(username=data["username"]).first()

        if not user or not check_password_hash(user.password, data["password"]):
            return jsonify({"msg": "Bad credentials"}), 401

        # Токен на 7 дней
        token = create_access_token(identity=user.username, expires_delta=timedelta(days=7))
        update_online(user.username)

        return jsonify(access_token=token, public_key=user.public_key)


# =========================
# ONLINE STATUS
# =========================

@app.route("/heartbeat", methods=["POST"])
@jwt_required()
def heartbeat():
    current = get_jwt_identity()
    update_online(current)
    return jsonify({"status": "ok"})


@app.route("/status/<username>", methods=["GET"])
@jwt_required()
def get_status(username):
    online = redis_client.exists(f"online:{username}") == 1
    return jsonify({"online": bool(online)})


# =========================
# PUBLIC KEY
# =========================

@app.route("/public_key/<username>", methods=["GET"])
@jwt_required()
def get_public_key(username):
    with Session() as session:
        user = session.query(User).filter_by(username=username).first()
        if not user:
            return jsonify({"error": "Not found"}), 404
        return jsonify({"public_key": user.public_key})


# =========================
# E2E MESSAGING
# =========================

@app.route("/message", methods=["POST"])
@jwt_required()
def send_message():
    current = get_jwt_identity()
    data = request.json

    with Session() as session:
        msg = Message(
            sender=current,
            receiver=data["receiver"],
            ciphertext=data["ciphertext"],
            timestamp=datetime.utcnow(),
            read=False
        )
        session.add(msg)
        session.commit()

        redis_client.incr(f"unread:{data['receiver']}:{current}")

        return jsonify({"msg": "sent"})


@app.route("/messages/<username>", methods=["GET"])
@jwt_required()
def get_messages(username):
    current = get_jwt_identity()
    with Session() as session:
        msgs = session.query(Message).filter(
            ((Message.sender == current) & (Message.receiver == username)) |
            ((Message.sender == username) & (Message.receiver == current))
        ).order_by(Message.timestamp).all()

        result = [
            {
                "id": m.id,
                "sender": m.sender,
                "ciphertext": m.ciphertext,
                "time": m.timestamp.strftime("%H:%M"),
                "read": m.read
            }
            for m in msgs
        ]

        return jsonify(result)


@app.route("/read/<int:msg_id>", methods=["POST"])
@jwt_required()
def mark_read(msg_id):
    current = get_jwt_identity()
    with Session() as session:
        msg = session.query(Message).get(msg_id)
        if msg and msg.receiver == current:
            msg.read = True
            session.commit()
            redis_client.delete(f"unread:{current}:{msg.sender}")

        return jsonify({"status": "ok"})


@app.route("/chats", methods=["GET"])
@jwt_required()
def get_chats():
    current = get_jwt_identity()
    chats = {}

    for key in redis_client.scan_iter(f"unread:{current}:*"):
        parts = key.decode().split(":")
        sender = parts[-1]
        chats[sender] = int(redis_client.get(key) or 0)

    with Session() as session:
        msgs = session.query(Message).filter(
            (Message.sender == current) |
            (Message.receiver == current)
        ).all()
        for m in msgs:
            partner = m.receiver if m.sender == current else m.sender
            if partner not in chats:
                chats[partner] = 0

    result = [{"user": u, "unread": chats[u]} for u in chats]
    return jsonify(result)


# =========================
# FILE UPLOAD
# =========================

@app.route("/upload", methods=["POST"])
@jwt_required()
def upload_file():
    current_user = get_jwt_identity()
    if 'file' not in request.files:
        return jsonify({"error": "No file part"}), 400
    file = request.files['file']
    if file.filename == '':
        return jsonify({"error": "No selected file"}), 400

    # Проверка размера (дополнительно к глобальному ограничению)
    if request.content_length > MAX_CONTENT_LENGTH:
        return jsonify({"error": "File too large (max 1GB)"}), 400

    if file and allowed_file(file.filename):
        filename = secure_filename(file.filename)
        unique_name = f"{current_user}_{int(time.time())}_{filename}"
        save_path = os.path.join(app.config['UPLOAD_FOLDER'], unique_name)
        file.save(save_path)

        # Удаляем старые файлы после загрузки нового (опционально)
        # Запускаем в фоне, чтобы не задерживать ответ
        threading.Thread(target=clean_old_files).start()

        file_url = f"/uploads/{unique_name}"
        return jsonify({"url": file_url}), 200

    return jsonify({"error": "File type not allowed"}), 400


@app.route('/uploads/<filename>')
def uploaded_file(filename):
    return send_from_directory(app.config['UPLOAD_FOLDER'], filename)


# =========================
# RUN
# =========================

if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5000, debug=True)