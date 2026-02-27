from flask import Flask, request, jsonify
from flask_cors import CORS
from flask_jwt_extended import (
    JWTManager, create_access_token,
    jwt_required, get_jwt_identity
)
from sqlalchemy import create_engine, Column, Integer, String, Boolean, DateTime, Index, Text
from sqlalchemy.orm import declarative_base, sessionmaker
from datetime import datetime, timedelta
import hashlib
import redis
import os

app = Flask(__name__)
app.config["JWT_SECRET_KEY"] = "super-secret-key"

# Разрешаем запросы с вашего фронтенд-порта
CORS(app, origins=["http://localhost:5500", "http://127.0.0.1:5500"], supports_credentials=True)

jwt = JWTManager(app)

# PostgreSQL connection
engine = create_engine(
    "postgresql://postgres:darkenral@localhost/messenger_db",
    pool_size=20,
    max_overflow=0
)

Base = declarative_base()
Session = sessionmaker(bind=engine)

# Redis client (для онлайн-статусов и счётчиков)
redis_client = redis.Redis(host='localhost', port=6379, decode_responses=True)

# ======================
# MODELS
# ======================

class User(Base):
    __tablename__ = "users"
    id = Column(Integer, primary_key=True)
    username = Column(String, unique=True)
    password = Column(String)
    public_key = Column(String)
    last_seen = Column(DateTime)

class Message(Base):
    __tablename__ = "messages"
    id = Column(Integer, primary_key=True)
    dialog_id = Column(String, index=True)
    sender = Column(String)
    receiver = Column(String)
    type = Column(String, default='text')          # 'text' или 'image'
    ciphertext = Column(Text)                      # зашифрованный текст или данные изображения
    encrypted_key = Column(Text, nullable=True)    # зашифрованный AES-ключ (для изображений)
    iv = Column(String, nullable=True)              # IV для AES-GCM
    mime_type = Column(String, nullable=True)       # MIME-тип изображения
    timestamp = Column(DateTime, index=True)
    read = Column(Boolean, default=False)

    __table_args__ = (
        Index('ix_messages_dialog_time', 'dialog_id', 'timestamp'),
        Index('ix_messages_unread', 'receiver', 'read', postgresql_where=(read == False)),
    )

Base.metadata.create_all(engine)

# ======================
# UTILS
# ======================

def hash_password(password):
    return hashlib.sha256(password.encode()).hexdigest()

def get_dialog_id(user1, user2):
    return "_".join(sorted([user1, user2]))

# ======================
# AUTH (без изменений)
# ======================

@app.route("/register", methods=["POST"])
def register():
    session = Session()
    try:
        data = request.json
        if not data or "username" not in data or "password" not in data:
            return jsonify({"msg": "Username and password required"}), 400

        if session.query(User).filter_by(username=data["username"]).first():
            return jsonify({"msg": "User exists"}), 400

        public_key = data.get("public_key", f"temp_key_{data['username']}")
        user = User(
            username=data["username"],
            password=hash_password(data["password"]),
            public_key=public_key,
            last_seen=datetime.utcnow()
        )
        session.add(user)
        session.commit()
        return jsonify({"msg": "Registered"})
    finally:
        session.close()

@app.route("/login", methods=["POST"])
def login():
    session = Session()
    try:
        data = request.json
        user = session.query(User).filter_by(username=data["username"]).first()
        if not user or user.password != hash_password(data["password"]):
            return jsonify({"msg": "Bad credentials"}), 401

        token = create_access_token(identity=user.username)
        user.last_seen = datetime.utcnow()
        session.commit()

        return jsonify(access_token=token, public_key=user.public_key)
    finally:
        session.close()

# ======================
# ONLINE STATUS via Redis
# ======================

@app.route("/heartbeat", methods=["POST"])
@jwt_required()
def heartbeat():
    current_user = get_jwt_identity()
    redis_client.setex(f"online:{current_user}", 15, "1")
    return jsonify({"status": "ok"})

@app.route("/status/<username>", methods=["GET"])
@jwt_required()
def get_status(username):
    online = redis_client.exists(f"online:{username}")
    return jsonify({"online": bool(online)})

# ======================
# PUBLIC KEY
# ======================

@app.route("/public_key/<username>", methods=["GET"])
@jwt_required()
def get_public_key(username):
    session = Session()
    try:
        user = session.query(User).filter_by(username=username).first()
        if not user:
            return jsonify({"error": "Not found"}), 404
        return jsonify({"public_key": user.public_key})
    finally:
        session.close()

# ======================
# CHATS LIST with Redis unread counters
# ======================

@app.route("/chats", methods=["GET"])
@jwt_required()
def get_chats():
    session = Session()
    try:
        current_user = get_jwt_identity()
        messages = session.query(Message).filter(
            (Message.sender == current_user) | (Message.receiver == current_user)
        ).all()
        
        chat_users = set()
        for msg in messages:
            if msg.sender != current_user:
                chat_users.add(msg.sender)
            if msg.receiver != current_user:
                chat_users.add(msg.receiver)

        chats = []
        for user in chat_users:
            unread = redis_client.hget(f"unread:{current_user}", user) or 0
            chats.append({"user": user, "unread": int(unread)})
        
        return jsonify(chats)
    finally:
        session.close()

# ======================
# SEND MESSAGE (поддерживает текст и изображения)
# ======================

@app.route("/message", methods=["POST"])
@jwt_required()
def send_message():
    session = Session()
    try:
        current_user = get_jwt_identity()
        data = request.json

        if not data or "receiver" not in data:
            return jsonify({"msg": "Missing receiver"}), 400

        dialog_id = get_dialog_id(current_user, data["receiver"])

        msg_data = {
            "dialog_id": dialog_id,
            "sender": current_user,
            "receiver": data["receiver"],
            "timestamp": datetime.utcnow(),
            "read": False,
            "type": data.get("type", "text")
        }

        if msg_data["type"] == "text":
            if "ciphertext" not in data:
                return jsonify({"msg": "Missing ciphertext"}), 400
            msg_data["ciphertext"] = data["ciphertext"]
        elif msg_data["type"] == "image":
            required = ["ciphertext", "encrypted_key", "iv", "mime_type"]
            if not all(k in data for k in required):
                return jsonify({"msg": "Missing image fields"}), 400
            msg_data.update({
                "ciphertext": data["ciphertext"],
                "encrypted_key": data["encrypted_key"],
                "iv": data["iv"],
                "mime_type": data["mime_type"]
            })
        else:
            return jsonify({"msg": "Invalid message type"}), 400

        msg = Message(**msg_data)
        session.add(msg)
        session.commit()

        # Увеличиваем счётчик непрочитанных в Redis
        redis_client.hincrby(f"unread:{data['receiver']}", current_user, 1)

        return jsonify({"msg": "sent", "id": msg.id})
    finally:
        session.close()

# ======================
# GET MESSAGES
# ======================

@app.route("/messages/<username>", methods=["GET"])
@jwt_required()
def get_messages(username):
    session = Session()
    try:
        current_user = get_jwt_identity()
        dialog_id = get_dialog_id(current_user, username)
        
        messages = session.query(Message).filter(
            Message.dialog_id == dialog_id
        ).order_by(Message.timestamp).all()

        return jsonify([
            {
                "id": m.id,
                "sender": m.sender,
                "type": m.type,
                "ciphertext": m.ciphertext,
                "encrypted_key": m.encrypted_key,
                "iv": m.iv,
                "mime_type": m.mime_type,
                "time": m.timestamp.strftime("%H:%M"),
                "read": m.read
            }
            for m in messages
        ])
    finally:
        session.close()

# ======================
# MARK ALL READ
# ======================

@app.route("/read_all/<sender>", methods=["POST"])
@jwt_required()
def mark_all_read(sender):
    session = Session()
    try:
        current_user = get_jwt_identity()
        session.query(Message).filter_by(
            sender=sender,
            receiver=current_user,
            read=False
        ).update({"read": True})
        session.commit()

        redis_client.hdel(f"unread:{current_user}", sender)

        return jsonify({"status": "ok"})
    finally:
        session.close()

if __name__ == "__main__":
    app.run(debug=True, port=5000)