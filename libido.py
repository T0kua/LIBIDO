from flask import Flask, request, jsonify
from flask_cors import CORS
from flask_jwt_extended import (
    JWTManager, create_access_token,
    jwt_required, get_jwt_identity
)
from cryptography.fernet import Fernet
from sqlalchemy import create_engine, Column, Integer, String
from sqlalchemy.orm import declarative_base, sessionmaker
import hashlib

# ==========================================
# НАСТРОЙКИ
# ==========================================

SECRET_KEY = "super-secret-jwt-key"
ENCRYPTION_KEY = Fernet.generate_key()  # в проде хранить в env

app = Flask(__name__)
app.config["JWT_SECRET_KEY"] = SECRET_KEY

CORS(app)
jwt = JWTManager(app)

cipher = Fernet(ENCRYPTION_KEY)

# ==========================================
# БАЗА ДАННЫХ
# ==========================================

engine = create_engine("sqlite:///database.db")
Base = declarative_base()
Session = sessionmaker(bind=engine)


class User(Base):
    __tablename__ = "users"
    id = Column(Integer, primary_key=True)
    username = Column(String, unique=True)
    password = Column(String)


class Message(Base):
    __tablename__ = "messages"
    id = Column(Integer, primary_key=True)
    user = Column(String)
    text = Column(String)


Base.metadata.create_all(engine)

# ==========================================
# УТИЛИТЫ
# ==========================================

def hash_password(password):
    return hashlib.sha256(password.encode()).hexdigest()


# ==========================================
# РЕГИСТРАЦИЯ
# ==========================================

@app.route("/register", methods=["POST"])
def register():
    data = request.json
    session = Session()

    if session.query(User).filter_by(username=data["username"]).first():
        return jsonify({"msg": "User exists"}), 400

    user = User(
        username=data["username"],
        password=hash_password(data["password"])
    )

    session.add(user)
    session.commit()

    return jsonify({"msg": "Registered successfully"})


# ==========================================
# ЛОГИН
# ==========================================

@app.route("/login", methods=["POST"])
def login():
    data = request.json
    session = Session()

    user = session.query(User).filter_by(
        username=data["username"]
    ).first()

    if not user or user.password != hash_password(data["password"]):
        return jsonify({"msg": "Bad credentials"}), 401

    token = create_access_token(identity=user.username)

    return jsonify(access_token=token)


# ==========================================
# ОТПРАВКА СООБЩЕНИЯ
# ==========================================

@app.route("/message", methods=["POST"])
@jwt_required()
def send_message():
    current_user = get_jwt_identity()
    data = request.json
    session = Session()

    encrypted_text = cipher.encrypt(
        data["message"].encode()
    ).decode()

    message = Message(
        user=current_user,
        text=encrypted_text
    )

    session.add(message)
    session.commit()

    return jsonify({"msg": "Message stored"})


# ==========================================
# ПОЛУЧЕНИЕ СООБЩЕНИЙ
# ==========================================

@app.route("/messages", methods=["GET"])
@jwt_required()
def get_messages():
    session = Session()
    messages = session.query(Message).all()

    result = []

    for msg in messages:
        decrypted_text = cipher.decrypt(
            msg.text.encode()
        ).decode()

        result.append({
            "user": msg.user,
            "text": decrypted_text
        })

    return jsonify(result)


# ==========================================
# ЗАПУСК
# ==========================================

if __name__ == "__main__":
    app.run(debug=True, port=5000)