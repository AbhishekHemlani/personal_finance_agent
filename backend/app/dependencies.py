from typing import Annotated

from fastapi import Header


def get_user_id(x_user_id: Annotated[str | None, Header()] = None) -> str:
    return x_user_id or "demo-user"
