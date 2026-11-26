import os

from sqlalchemy import create_engine, inspect
from sqlalchemy.orm import DeclarativeBase, sessionmaker


class Base(DeclarativeBase):
    pass


database_url = os.getenv("DATABASE_URL", "sqlite:///./interview_planner.db")
connect_args = {"check_same_thread": False} if database_url.startswith("sqlite") else {}
engine = create_engine(database_url, connect_args=connect_args)
SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False)


def initialize_database() -> None:
    Base.metadata.create_all(bind=engine)
    if engine.dialect.name != "sqlite":
        return

    user_columns = {column["name"] for column in inspect(engine).get_columns("users")}
    with engine.begin() as connection:
        if "google_sub" not in user_columns:
            connection.exec_driver_sql("ALTER TABLE users ADD COLUMN google_sub VARCHAR(255)")
        if "picture_url" not in user_columns:
            connection.exec_driver_sql("ALTER TABLE users ADD COLUMN picture_url VARCHAR(2048)")
        connection.exec_driver_sql(
            "CREATE UNIQUE INDEX IF NOT EXISTS uq_users_google_sub ON users (google_sub)"
        )


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
